import * as React from 'react';
import { DefaultButton, MessageBar, MessageBarType, PrimaryButton, Spinner, Dropdown } from '@fluentui/react';
import styles from './MorningChecks.module.scss';
import type { IMorningChecksProps } from './IMorningChecksProps';
import SystemRow from './SystemRow';
import { ConflictError } from '../logic/sp';
import {
  appendHistory, buildSummary, canScan, CheckStatus, dayKey, displayStatus, historyLine, IDailyCheck,
  IInsight, IReportFile, ISystem, isDayHealthy, planEscalation, scanText
} from '../logic/model';

type Filter = 'all' | 'attention' | 'mine';
interface IMsg { type: MessageBarType; text: string }

export default function MorningChecks(props: IMorningChecksProps): React.ReactElement {
  const { sp } = props;
  const [date, setDate] = React.useState(dayKey(new Date()));
  const [ready, setReady] = React.useState<boolean | undefined>(undefined);
  const [systems, setSystems] = React.useState<ISystem[]>([]);
  const [checks, setChecks] = React.useState<IDailyCheck[]>([]);
  const [files, setFiles] = React.useState<Record<string, IReportFile[]>>({});
  const [insights, setInsights] = React.useState<Record<string, IInsight>>({});
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<IMsg | undefined>();
  const [filter, setFilter] = React.useState<Filter>('all');
  const [log, setLog] = React.useState<string[]>([]);

  const isToday = date === dayKey(new Date());
  const me = props.userEmail.toLowerCase();

  const load = React.useCallback(async (): Promise<void> => {
    const ok = await sp.isProvisioned();
    setReady(ok);
    if (!ok) return;
    const [s, c, f] = await Promise.all([sp.getSystems(), sp.getChecks(date), sp.getFiles(date)]);
    setSystems(s); setChecks(c); setFiles(f);
  }, [sp, date]);

  React.useEffect(() => {
    load().catch(e => setMsg({ type: MessageBarType.error, text: String(e.message || e) }));
  }, [load]);

  // Scan readable report files for error/warning lines, 4 at a time.
  React.useEffect(() => {
    let cancelled = false;
    const todo: IReportFile[] = ([] as IReportFile[]).concat(...Object.keys(files).map(k => files[k])).filter(f => !insights[f.url]);
    const run = async (): Promise<void> => {
      // eslint-disable-next-line no-unmodified-loop-condition -- set by the effect cleanup
      for (let i = 0; i < todo.length && !cancelled; i += 4) {
        const batch = await Promise.all(todo.slice(i, i + 4).map(async (f): Promise<[string, IInsight]> => {
          if (!canScan(f.name)) return [f.url, scanText(f.name, '')];
          try { return [f.url, scanText(f.name, await sp.readText(f.url))]; } catch { return [f.url, { errors: 0, warnings: 0, lines: ['Could not read file.'], readable: false }]; }
        }));
        if (!cancelled) setInsights(prev => { const n = { ...prev }; batch.forEach(([u, ins]) => { n[u] = ins; }); return n; });
      }
    };
    run().catch(() => undefined);
    return () => { cancelled = true; };
  }, [files]);

  /** Runs a write, then reloads so every row has a fresh ETag. */
  const act = async (fn: () => Promise<void>, okText?: string): Promise<void> => {
    setBusy(true); setMsg(undefined);
    try {
      await fn();
      if (okText) setMsg({ type: MessageBarType.success, text: okText });
    } catch (e) {
      setMsg({ type: e instanceof ConflictError ? MessageBarType.warning : MessageBarType.error, text: String((e as Error).message || e) });
    } finally {
      try { await load(); } catch { /* message already shown */ }
      setBusy(false);
    }
  };

  const hist = (c: IDailyCheck, action: string, note?: string): string =>
    appendHistory(c.history, historyLine(new Date(), props.userDisplayName, action, note));

  const setStatus = (c: IDailyCheck, s: CheckStatus): Promise<void> =>
    act(() => sp.updateCheck(c, { status: s, history: hist(c, `Status ${c.status} -> ${s}`) }));

  const escalate = (c: IDailyCheck, s: ISystem): Promise<void> => {
    const plan = planEscalation(c, s);
    if ('error' in plan) { setMsg({ type: MessageBarType.warning, text: plan.error }); return Promise.resolve(); }
    return act(() => sp.updateCheck(c, {
      stage: plan.stage, assignedToId: plan.assignee.id,
      history: hist(c, `Escalated ${c.stage} -> ${plan.stage}, assigned to ${plan.assignee.title}`)
    }), `${s.name} escalated to ${plan.assignee.title}.`);
  };

  const close = (c: IDailyCheck): Promise<void> =>
    act(() => sp.updateCheck(c, { stage: 'Closed', assignedToId: null, history: hist(c, `Closed at stage ${c.stage} with status ${c.status}`) }));

  const saveNote = (c: IDailyCheck, note: string): Promise<void> =>
    act(() => sp.updateCheck(c, { notes: note, history: hist(c, 'Note updated', note) }));

  const upload = (s: ISystem, fl: File[]): Promise<void> =>
    act(async () => { for (const f of fl) await sp.upload(s.key, f); }, `${fl.length} file(s) uploaded to ${s.name}.`);

  const startDay = (): Promise<void> =>
    act(async () => { const n = await sp.startDay(date, systems, checks); setMsg({ type: MessageBarType.success, text: `Day started: ${n} checks created.` }); });

  const provision = (): Promise<void> => {
    setLog([]);
    return act(() => sp.provision(m => setLog(l => [...l, m])), 'Setup finished. Add your systems in the Systems list, then reload.');
  };

  const rows = systems.map(s => {
    const c = checks.find(x => x.systemKey === s.key);
    const f = files[s.key] || [];
    return { system: s, check: c, files: f, status: displayStatus(c, f), fileCount: f.length };
  });
  const summary = buildSummary(date, rows);

  const sendSummary = (): Promise<void> => {
    const to = props.summaryTo.split(/[;,]/).map(x => x.trim()).filter(Boolean);
    if (to.length === 0) {
      setMsg({ type: MessageBarType.warning, text: 'No recipients set. Edit the web part and fill "Summary recipients".' });
      return Promise.resolve();
    }
    if (!window.confirm(`Send "${summary.subject}" to ${to.join(', ')}?`)) return Promise.resolve();
    return act(() => sp.sendEmail(to, summary.subject, summary.html), 'Summary sent.');
  };

  const copySummary = (): void => {
    navigator.clipboard.writeText(summary.text).then(
      () => setMsg({ type: MessageBarType.success, text: 'Summary copied.' }),
      () => setMsg({ type: MessageBarType.error, text: 'Copy failed. Select the text in the preview instead.' }));
  };

  if (ready === undefined) return <Spinner label="Loading Morning Checks..." />;

  if (!ready) {
    return (
      <section className={styles.morningChecks}>
        <h2>Morning Checks: setup needed</h2>
        <p>This site does not have the Morning Checks lists yet ({'MC_Systems'}, {'MC_DailyChecks'}, {'MC_Reports'}).</p>
        {props.canManage
          ? <PrimaryButton text="Create lists now" disabled={busy} onClick={provision} />
          : <p>Ask a site owner to open this page and click &quot;Create lists now&quot;.</p>}
        {msg && <MessageBar messageBarType={msg.type}>{msg.text}</MessageBar>}
        {log.length > 0 && <pre className={styles.history}>{log.join('\n')}</pre>}
      </section>
    );
  }

  const visible = rows.filter(r =>
    filter === 'all' ? true
      : filter === 'mine' ? !!(r.check && r.check.assignedTo && r.check.assignedTo.email.toLowerCase() === me)
        : r.status !== 'OK' && r.status !== 'N/A' && !(r.check && r.check.stage === 'Closed'));
  const counts = (s: string): number => rows.filter(r => r.status === s).length;
  const healthy = isDayHealthy(rows.map(r => r.status));

  return (
    <section className={styles.morningChecks}>
      <div className={styles.toolbar}>
        <h2 className={styles.title}>Morning Checks</h2>
        <input type="date" value={date} max={dayKey(new Date())} onChange={e => e.target.value && setDate(e.target.value)} />
        <Dropdown selectedKey={filter} onChange={(_, o) => o && setFilter(o.key as Filter)} className={styles.filter}
          options={[{ key: 'all', text: 'All systems' }, { key: 'attention', text: 'Needs attention' }, { key: 'mine', text: 'Assigned to me' }]} />
        <DefaultButton text="Reload" iconProps={{ iconName: 'Refresh' }} disabled={busy} onClick={() => act(async () => undefined)} />
        {isToday && checks.length < systems.length && <PrimaryButton text="Start day" disabled={busy} onClick={startDay} />}
        <DefaultButton text="Copy summary" disabled={busy} onClick={copySummary} />
        <PrimaryButton text="Send summary" iconProps={{ iconName: 'Mail' }} disabled={busy} onClick={sendSummary} />
        {props.canManage && <DefaultButton text="Edit systems" href={sp.systemsListUrl()} target="_blank" />}
        {busy && <Spinner />}
      </div>

      <div className={`${styles.totals} ${healthy ? styles.ok : styles.fail}`}>
        {healthy ? 'All checks OK' : 'Not all checks are OK'} | OK {counts('OK')} | Warning {counts('Warning')} | Fail {counts('Fail')} |
        Missing {counts('Missing')} | Pending {counts('Pending')} | N/A {counts('N/A')}
      </div>

      {msg && <MessageBar messageBarType={msg.type} onDismiss={() => setMsg(undefined)}>{msg.text}</MessageBar>}
      {systems.length === 0 && <MessageBar>No active systems. Add them in the Systems list (Edit systems).</MessageBar>}
      {systems.length > 0 && checks.length === 0 && isToday && <MessageBar>Today has not started. Click &quot;Start day&quot;.</MessageBar>}

      {visible.map(r => (
        <SystemRow key={r.system.key} system={r.system} check={r.check} status={r.status} files={r.files} insights={insights}
          isMine={!!(r.check && r.check.assignedTo && r.check.assignedTo.email.toLowerCase() === me)} busy={busy}
          onStatus={s => r.check && setStatus(r.check, s)}
          onEscalate={() => r.check && escalate(r.check, r.system)}
          onClose={() => r.check && close(r.check)}
          onNote={n => r.check && saveNote(r.check, n)}
          onUpload={fl => upload(r.system, fl)} />
      ))}

      <details className={styles.preview}>
        <summary>Summary preview</summary>
        <pre className={styles.history}>{summary.text}</pre>
      </details>
    </section>
  );
}
