import { SPHttpClient, SPHttpClientResponse, ISPHttpClientOptions } from '@microsoft/sp-http';
import { CheckStatus, IDailyCheck, IPerson, IReportFile, ISystem, itemTitle, Stage, dayKey } from './model';

export const LIST_SYSTEMS = 'MC_Systems';
export const LIST_CHECKS = 'MC_DailyChecks';
export const LIB_REPORTS = 'MC_Reports';

const VERBOSE = 'application/json;odata=verbose';
const NOMETA = 'application/json;odata=nometadata';

/** Thrown when someone else saved the same item first (HTTP 412). */
export class ConflictError extends Error {
  constructor() {
    super('Someone else changed this check after you loaded it. The page was reloaded; apply your change again.');
  }
}

const q = (s: string): string => encodeURIComponent(s.replace(/'/g, "''"));

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const person = (p: Row | undefined): IPerson | undefined =>
  p && p.Id ? { id: p.Id, title: p.Title || '', email: p.EMail || '' } : undefined;

interface IFieldDef { name: string; xml: string }

const SYSTEM_FIELDS: IFieldDef[] = [
  { name: 'SystemKey', xml: '<Field Type="Text" Name="SystemKey" StaticName="SystemKey" DisplayName="System key (folder name)" Required="TRUE" Indexed="TRUE" EnforceUniqueValues="TRUE" MaxLength="60"/>' },
  { name: 'SystemGroup', xml: '<Field Type="Text" Name="SystemGroup" StaticName="SystemGroup" DisplayName="Group"/>' },
  { name: 'Critical', xml: '<Field Type="Boolean" Name="Critical" StaticName="Critical" DisplayName="Critical"><Default>0</Default></Field>' },
  { name: 'Active', xml: '<Field Type="Boolean" Name="Active" StaticName="Active" DisplayName="Active"><Default>1</Default></Field>' },
  { name: 'SortOrder', xml: '<Field Type="Number" Name="SortOrder" StaticName="SortOrder" DisplayName="Sort order"><Default>100</Default></Field>' },
  { name: 'Instructions', xml: '<Field Type="Note" Name="Instructions" StaticName="Instructions" DisplayName="What to check" NumLines="6" RichText="FALSE"/>' },
  { name: 'SystemOwner', xml: '<Field Type="User" Name="SystemOwner" StaticName="SystemOwner" DisplayName="System owner" UserSelectionMode="PeopleOnly" List="UserInfo" ShowField="ImnName"/>' },
  { name: 'SystemAdmin', xml: '<Field Type="User" Name="SystemAdmin" StaticName="SystemAdmin" DisplayName="System admin" UserSelectionMode="PeopleOnly" List="UserInfo" ShowField="ImnName"/>' }
];

const choice = (name: string, display: string, values: string[], def: string): string =>
  `<Field Type="Choice" Name="${name}" StaticName="${name}" DisplayName="${display}" Format="Dropdown"><Default>${def}</Default><CHOICES>${values.map(v => `<CHOICE>${v}</CHOICE>`).join('')}</CHOICES></Field>`;

const CHECK_FIELDS: IFieldDef[] = [
  { name: 'CheckDate', xml: '<Field Type="Text" Name="CheckDate" StaticName="CheckDate" DisplayName="Check date" Indexed="TRUE" MaxLength="10"/>' },
  { name: 'SystemKey', xml: '<Field Type="Text" Name="SystemKey" StaticName="SystemKey" DisplayName="System key" MaxLength="60"/>' },
  { name: 'CheckStatus', xml: choice('CheckStatus', 'Status', ['Pending', 'OK', 'Warning', 'Fail', 'N/A'], 'Pending') },
  { name: 'Stage', xml: choice('Stage', 'Stage', ['NOC', 'System', 'Admin', 'Closed'], 'NOC') },
  { name: 'AssignedTo', xml: '<Field Type="User" Name="AssignedTo" StaticName="AssignedTo" DisplayName="Assigned to" UserSelectionMode="PeopleOnly" List="UserInfo" ShowField="ImnName"/>' },
  { name: 'Notes', xml: '<Field Type="Note" Name="Notes" StaticName="Notes" DisplayName="Notes" NumLines="6" RichText="FALSE"/>' },
  { name: 'History', xml: '<Field Type="Note" Name="History" StaticName="History" DisplayName="History" NumLines="10" RichText="FALSE"/>' }
];

export class SharePointService {
  private readonly api: string;

  constructor(private readonly http: SPHttpClient, private readonly webUrl: string) {
    this.api = `${webUrl}/_api/web`;
  }

  /* ---------- low level ---------- */

  private async call(url: string, method: 'GET' | 'POST', opts: ISPHttpClientOptions = {}): Promise<SPHttpClientResponse> {
    const res = method === 'GET'
      ? await this.http.get(url, SPHttpClient.configurations.v1, opts)
      : await this.http.post(url, SPHttpClient.configurations.v1, opts);
    if (res.status === 412) throw new ConflictError();
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 400); } catch { /* ignore */ }
      throw new Error(`SharePoint ${res.status} on ${url.replace(this.webUrl, '')}: ${detail}`);
    }
    return res;
  }

  private async json(url: string): Promise<Row> {
    const res = await this.call(url, 'GET', { headers: { Accept: NOMETA } });
    return res.json();
  }

  private async verbosePost(url: string, body: unknown, extra: Record<string, string> = {}): Promise<void> {
    await this.call(url, 'POST', {
      headers: { Accept: VERBOSE, 'Content-Type': VERBOSE, 'odata-version': '', ...extra },
      body: JSON.stringify(body)
    });
  }

  private list(title: string): string {
    return `${this.api}/lists/getbytitle('${q(title)}')`;
  }

  /* ---------- setup ---------- */

  async isProvisioned(): Promise<boolean> {
    try {
      await Promise.all([LIST_SYSTEMS, LIST_CHECKS, LIB_REPORTS].map(t => this.json(`${this.list(t)}?$select=Id`)));
      return true;
    } catch {
      return false;
    }
  }

  /** Creates any missing list, library, or column. Safe to run more than once. */
  async provision(log: (msg: string) => void): Promise<void> {
    await this.ensureList(LIST_SYSTEMS, 100, SYSTEM_FIELDS, log);
    await this.ensureList(LIST_CHECKS, 100, CHECK_FIELDS, log);
    await this.ensureList(LIB_REPORTS, 101, [], log);

    // One item per system per day: make Title unique so a second "start day" can't duplicate it.
    await this.verbosePost(`${this.list(LIST_CHECKS)}/fields/getbyinternalnameortitle('Title')`,
      { __metadata: { type: 'SP.Field' }, Indexed: true, EnforceUniqueValues: true },
      { 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' });
    // Version history is the audit trail of every change.
    for (const t of [LIST_SYSTEMS, LIST_CHECKS, LIB_REPORTS]) {
      await this.verbosePost(this.list(t), { __metadata: { type: 'SP.List' }, EnableVersioning: true },
        { 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' });
    }
    log('Unique daily key and version history enabled.');

    const systems = await this.getSystems(true);
    for (const s of systems) await this.ensureFolder(s.key);
    log(`Report folders checked for ${systems.length} systems.`);
  }

  private async ensureList(title: string, template: number, fields: IFieldDef[], log: (m: string) => void): Promise<void> {
    try {
      await this.json(`${this.list(title)}?$select=Id`);
    } catch {
      await this.verbosePost(`${this.api}/lists`, {
        __metadata: { type: 'SP.List' }, Title: title, BaseTemplate: template, AllowContentTypes: true, ContentTypesEnabled: false
      });
      log(`Created ${title}.`);
    }
    const existing = await this.json(`${this.list(title)}/fields?$select=InternalName&$top=500`);
    const have = new Set<string>((existing.value as Row[]).map(f => f.InternalName));
    for (const f of fields) {
      if (have.has(f.name)) continue;
      await this.verbosePost(`${this.list(title)}/fields/CreateFieldAsXml`, {
        parameters: { __metadata: { type: 'SP.XmlSchemaFieldCreationInformation' }, SchemaXml: f.xml, Options: 8 | 16 }
      });
      log(`Added column ${title}.${f.name}.`);
    }
  }

  /* ---------- systems ---------- */

  async getSystems(includeInactive: boolean = false): Promise<ISystem[]> {
    const sel = 'Id,Title,SystemKey,SystemGroup,Critical,Active,SortOrder,Instructions,' +
      'SystemOwner/Id,SystemOwner/Title,SystemOwner/EMail,SystemAdmin/Id,SystemAdmin/Title,SystemAdmin/EMail';
    const filter = includeInactive ? '' : '&$filter=Active eq 1';
    const data = await this.json(`${this.list(LIST_SYSTEMS)}/items?$select=${sel}&$expand=SystemOwner,SystemAdmin${filter}&$orderby=SortOrder,Title&$top=500`);
    return (data.value as Row[]).filter(r => r.SystemKey).map(r => ({
      id: r.Id, key: String(r.SystemKey).trim(), name: r.Title || r.SystemKey, group: r.SystemGroup || '',
      critical: !!r.Critical, instructions: r.Instructions || '',
      owner: person(r.SystemOwner), admin: person(r.SystemAdmin)
    }));
  }

  systemsListUrl(): string {
    return `${this.webUrl}/Lists/${LIST_SYSTEMS}`;
  }

  /* ---------- daily checks ---------- */

  async getChecks(date: string): Promise<IDailyCheck[]> {
    const sel = 'Id,Title,CheckDate,SystemKey,CheckStatus,Stage,Notes,History,Modified,owshiddenversion,' +
      'Editor/Title,AssignedTo/Id,AssignedTo/Title,AssignedTo/EMail';
    const data = await this.json(`${this.list(LIST_CHECKS)}/items?$select=${sel}&$expand=Editor,AssignedTo&$filter=CheckDate eq '${q(date)}'&$top=500`);
    return (data.value as Row[]).map(r => ({
      id: r.Id,
      // A list item's ETag is its hidden version number in quotes.
      etag: `"${r.owshiddenversion}"`,
      title: r.Title, date: r.CheckDate, systemKey: r.SystemKey,
      status: (r.CheckStatus || 'Pending') as CheckStatus, stage: (r.Stage || 'NOC') as Stage,
      assignedTo: person(r.AssignedTo), notes: r.Notes || '', history: r.History || '',
      modified: r.Modified, editor: r.Editor ? r.Editor.Title : ''
    }));
  }

  /** Creates the missing daily items. A duplicate from a parallel user fails on the unique Title and is ignored. */
  async startDay(date: string, systems: ISystem[], existing: IDailyCheck[]): Promise<number> {
    const have = new Set(existing.map(c => c.systemKey));
    let created = 0;
    for (const s of systems) {
      if (have.has(s.key)) continue;
      try {
        await this.call(`${this.list(LIST_CHECKS)}/items`, 'POST', {
          headers: { Accept: NOMETA, 'Content-Type': NOMETA },
          body: JSON.stringify({ Title: itemTitle(date, s.key), CheckDate: date, SystemKey: s.key, CheckStatus: 'Pending', Stage: 'NOC' })
        });
        created++;
      } catch (e) {
        // Another user may have created it a moment ago (unique Title). Only fail if it really is missing.
        const found = await this.json(`${this.list(LIST_CHECKS)}/items?$select=Id&$filter=Title eq '${q(itemTitle(date, s.key))}'`);
        if ((found.value as Row[]).length === 0) throw e;
      }
    }
    return created;
  }

  /** Saves only the given fields, and only if nobody saved the item since it was loaded. */
  async updateCheck(check: IDailyCheck, fields: {
    // null clears the person field in SharePoint's REST API.
    // eslint-disable-next-line @rushstack/no-new-null
    status?: CheckStatus; stage?: Stage; assignedToId?: number | null; notes?: string; history?: string;
  }): Promise<void> {
    const body: Row = {};
    if (fields.status !== undefined) body.CheckStatus = fields.status;
    if (fields.stage !== undefined) body.Stage = fields.stage;
    if (fields.assignedToId !== undefined) body.AssignedToId = fields.assignedToId;
    if (fields.notes !== undefined) body.Notes = fields.notes;
    if (fields.history !== undefined) body.History = fields.history;
    await this.call(`${this.list(LIST_CHECKS)}/items(${check.id})`, 'POST', {
      headers: { Accept: NOMETA, 'Content-Type': NOMETA, 'IF-MATCH': check.etag, 'X-HTTP-Method': 'MERGE' },
      body: JSON.stringify(body)
    });
  }

  /* ---------- report files ---------- */

  private root: string | undefined;

  private async libRoot(): Promise<string> {
    if (!this.root) {
      const r = await this.json(`${this.list(LIB_REPORTS)}/RootFolder?$select=ServerRelativeUrl`);
      this.root = r.ServerRelativeUrl as string;
    }
    return this.root;
  }

  async ensureFolder(key: string): Promise<string> {
    const path = `${await this.libRoot()}/${key}`;
    const info = await this.json(`${this.api}/GetFolderByServerRelativePath(decodedurl='${q(path)}')?$select=Exists`).catch(() => ({ Exists: false }));
    if (!info.Exists) {
      await this.call(`${this.api}/folders/addusingpath(decodedurl='${q(path)}',overwrite=false)`, 'POST', { headers: { Accept: NOMETA } });
    }
    return path;
  }

  /** Files added to each system folder on the given day, grouped by system key. One request for all systems. */
  async getFiles(date: string): Promise<Record<string, IReportFile[]>> {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start.getTime() + 24 * 3600 * 1000);
    const data = await this.json(`${this.list(LIB_REPORTS)}/items?$select=FileLeafRef,FileRef,FileDirRef,Created,Author/Title` +
      `&$expand=Author&$filter=FSObjType eq 0 and Created ge datetime'${start.toISOString()}' and Created lt datetime'${end.toISOString()}'` +
      `&$orderby=Created desc&$top=2000`);
    const out: Record<string, IReportFile[]> = {};
    for (const r of data.value as Row[]) {
      const key = String(r.FileDirRef).split('/').pop() || '';
      (out[key] = out[key] || []).push({ name: r.FileLeafRef, url: r.FileRef, created: r.Created, author: r.Author ? r.Author.Title : '' });
    }
    return out;
  }

  async readText(serverRelativeUrl: string): Promise<string> {
    const res = await this.call(`${this.api}/GetFileByServerRelativePath(decodedurl='${q(serverRelativeUrl)}')/$value`, 'GET');
    return res.text();
  }

  async upload(key: string, file: File): Promise<void> {
    const folder = await this.ensureFolder(key);
    const now = new Date();
    const stamp = `${dayKey(now)}_${now.toTimeString().slice(0, 8).replace(/:/g, '')}`;
    const name = `${stamp}_${file.name.replace(/[#%*:<>?/\\|"]/g, '_')}`;
    await this.call(`${this.api}/GetFolderByServerRelativePath(decodedurl='${q(folder)}')/Files/AddUsingPath(decodedurl='${q(name)}',overwrite=false)`, 'POST', {
      headers: { Accept: NOMETA },
      body: await file.arrayBuffer()
    });
  }

  /* ---------- summary email ---------- */

  /** Sends through SharePoint. Recipients must be users in this organization. */
  async sendEmail(to: string[], subject: string, html: string): Promise<void> {
    await this.verbosePost(`${this.webUrl}/_api/SP.Utilities.Utility.SendEmail`, {
      properties: { __metadata: { type: 'SP.Utilities.EmailProperties' }, To: { results: to }, Subject: subject, Body: html }
    });
  }
}
