// Pure logic for Morning Checks. No SharePoint calls here, so it can be unit-tested.

export type CheckStatus = 'Pending' | 'OK' | 'Warning' | 'Fail' | 'N/A';
export type Stage = 'NOC' | 'System' | 'Admin' | 'Closed';

export const STATUSES: CheckStatus[] = ['OK', 'Warning', 'Fail', 'N/A'];

export interface IPerson {
  id: number;
  title: string;
  email: string;
}

export interface ISystem {
  id: number;
  key: string;          // folder name and part of the daily item key
  name: string;
  group: string;
  critical: boolean;
  instructions: string;
  owner?: IPerson;      // system team member (stage "System")
  admin?: IPerson;      // main system admin (stage "Admin")
}

export interface IDailyCheck {
  id: number;
  etag: string;
  title: string;        // "<date>|<systemKey>", unique per list
  date: string;         // yyyy-mm-dd
  systemKey: string;
  status: CheckStatus;
  stage: Stage;
  assignedTo?: IPerson;
  notes: string;
  history: string;
  modified: string;
  editor: string;
}

export interface IReportFile {
  name: string;
  url: string;
  created: string;      // ISO
  author: string;
}

export interface IInsight {
  errors: number;
  warnings: number;
  lines: string[];      // first few matching lines, for display
  readable: boolean;    // false when the file type can't be scanned as text
}

/** Status shown on the page. A check with no decision and no report is "Missing", never healthy. */
export type DisplayStatus = CheckStatus | 'Missing';

export function dayKey(d: Date): string {
  const p = (n: number): string => (n < 10 ? '0' : '') + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function itemTitle(date: string, systemKey: string): string {
  return `${date}|${systemKey}`;
}

export function displayStatus(check: IDailyCheck | undefined, files: IReportFile[]): DisplayStatus {
  if (!check || check.status === 'Pending') {
    return files.length === 0 ? 'Missing' : 'Pending';
  }
  return check.status;
}

/** True only when every non-N/A check was explicitly marked OK. Unknown means not healthy. */
export function isDayHealthy(statuses: DisplayStatus[]): boolean {
  return statuses.length > 0 && statuses.every(s => s === 'OK' || s === 'N/A');
}

export function nextStage(stage: Stage): Stage | undefined {
  if (stage === 'NOC') return 'System';
  if (stage === 'System') return 'Admin';
  return undefined;
}

export function assigneeFor(stage: Stage, system: ISystem): IPerson | undefined {
  if (stage === 'System') return system.owner;
  if (stage === 'Admin') return system.admin;
  return undefined;
}

/** Validates an escalation and returns the new stage + assignee, or an error message. */
export function planEscalation(
  check: IDailyCheck,
  system: ISystem
): { stage: Stage; assignee: IPerson } | { error: string } {
  if (check.status !== 'Fail' && check.status !== 'Warning') {
    return { error: 'Only a Fail or Warning check can be escalated.' };
  }
  const stage = nextStage(check.stage);
  if (!stage) {
    return { error: check.stage === 'Closed' ? 'This check is closed.' : 'Already at the last stage (Admin).' };
  }
  const assignee = assigneeFor(stage, system);
  if (!assignee) {
    return { error: `No ${stage === 'System' ? 'system owner' : 'system admin'} is set for ${system.name} in the Systems list.` };
  }
  return { stage, assignee };
}

/** One audit line, appended to the History field. */
export function historyLine(at: Date, actor: string, action: string, note?: string): string {
  const t = `${dayKey(at)} ${at.toTimeString().slice(0, 5)}`;
  const clean = (s: string): string => s.replace(/[\r\n|]+/g, ' ').trim();
  return [t, clean(actor), clean(action), note ? clean(note) : ''].filter(Boolean).join(' | ');
}

export function appendHistory(history: string, line: string): string {
  return history ? `${history}\n${line}` : line;
}

const TEXT_EXT = /\.(csv|txt|log|htm|html|json|xml)$/i;
const ERR = /\b(fail(ed|ure|s)?|error(s)?|critical|down|killed|did not run)\b/i;
const WARN = /\b(warn(ing)?s?|degraded|partial(ly)?)\b/i;
// Counts like "0 errors" or "Failed: 0" are not problems.
const ZERO = /(\b0\s+(errors?|failures?|failed|warnings?|critical)\b)|((errors?|failures?|failed|warnings?|critical)\s*[:=]\s*0\b)/i;

export function canScan(fileName: string): boolean {
  return TEXT_EXT.test(fileName);
}

/** Generic keyword scan of a text report. A suggestion for NOC, not a verdict. */
export function scanText(fileName: string, content: string, maxLines: number = 5): IInsight {
  if (!canScan(fileName)) return { errors: 0, warnings: 0, lines: [], readable: false };
  const text = /\.html?$/i.test(fileName)
    ? content.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<\/(tr|p|div|li|h\d)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    : content;
  let errors = 0;
  let warnings = 0;
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || ZERO.test(line)) continue;
    const isErr = ERR.test(line);
    const isWarn = !isErr && WARN.test(line);
    if (isErr) errors++;
    if (isWarn) warnings++;
    if ((isErr || isWarn) && lines.length < maxLines) lines.push(line.slice(0, 200));
  }
  return { errors, warnings, lines, readable: true };
}

export function suggestStatus(insights: IInsight[]): CheckStatus | undefined {
  const readable = insights.filter(i => i.readable);
  if (readable.length === 0) return undefined;
  if (readable.some(i => i.errors > 0)) return 'Fail';
  if (readable.some(i => i.warnings > 0)) return 'Warning';
  return 'OK';
}

export interface ISummaryRow {
  system: ISystem;
  status: DisplayStatus;
  check?: IDailyCheck;
  fileCount: number;
}

export function buildSummary(date: string, rows: ISummaryRow[]): { subject: string; text: string; html: string } {
  const count = (s: DisplayStatus): number => rows.filter(r => r.status === s).length;
  const open = rows.filter(r => r.status !== 'OK' && r.status !== 'N/A');
  const healthy = isDayHealthy(rows.map(r => r.status));
  const subject = `Morning Checks ${date}: ${healthy ? 'All OK' : `${open.length} need attention`}`;
  const totals = `OK ${count('OK')} | Warning ${count('Warning')} | Fail ${count('Fail')} | Missing ${count('Missing')} | Pending ${count('Pending')} | N/A ${count('N/A')}`;

  const who = (r: ISummaryRow): string => {
    const c = r.check;
    if (!c || c.stage === 'NOC') return 'NOC';
    if (c.stage === 'Closed') return 'Closed';
    return `${c.stage}: ${c.assignedTo ? c.assignedTo.title : 'unassigned'}`;
  };
  const textRows = open.map(r => `- ${r.system.name}: ${r.status} (${who(r)})${r.check && r.check.notes ? ` - ${r.check.notes}` : ''}`);
  const text = [subject, totals, '', open.length ? 'Needs attention:' : 'No open items.', ...textRows].join('\n');

  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const color: Record<string, string> = { Fail: '#c50f1f', Missing: '#c50f1f', Warning: '#bc4b09', Pending: '#616161', OK: '#107c10', 'N/A': '#616161' };
  const tr = rows
    .map(r => `<tr><td>${esc(r.system.name)}</td><td style="color:${color[r.status]};font-weight:600">${r.status}</td><td>${esc(who(r))}</td><td>${r.fileCount}</td><td>${esc(r.check ? r.check.notes : '')}</td></tr>`)
    .join('');
  const html = `<h2>${esc(subject)}</h2><p>${esc(totals)}</p>` +
    `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse"><tr><th>System</th><th>Status</th><th>Owner / stage</th><th>Files</th><th>Notes</th></tr>${tr}</table>`;
  return { subject, text, html };
}
