import * as React from 'react';
import { DefaultButton, PrimaryButton, TextField } from '@fluentui/react';
import styles from './MorningChecks.module.scss';
import {
  CheckStatus, DisplayStatus, IDailyCheck, IInsight, IReportFile, ISystem, STATUSES, nextStage, suggestStatus
} from '../logic/model';

export interface ISystemRowProps {
  system: ISystem;
  check?: IDailyCheck;
  status: DisplayStatus;
  files: IReportFile[];
  insights: Record<string, IInsight>;
  isMine: boolean;
  busy: boolean;
  onStatus: (s: CheckStatus) => void;
  onEscalate: () => void;
  onClose: () => void;
  onNote: (note: string) => void;
  onUpload: (files: File[]) => void;
}

const statusClass: Record<DisplayStatus, string> = {
  OK: styles.ok, Warning: styles.warn, Fail: styles.fail, Missing: styles.fail, Pending: styles.pending, 'N/A': styles.pending
};

export default function SystemRow(p: ISystemRowProps): React.ReactElement {
  const [note, setNote] = React.useState(p.check ? p.check.notes : '');
  const [showHistory, setShowHistory] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => setNote(p.check ? p.check.notes : ''), [p.check && p.check.notes]);

  const c = p.check;
  const fileInsights = p.files.map(f => p.insights[f.url]).filter(Boolean);
  const suggested = suggestStatus(fileInsights);
  const next = c ? nextStage(c.stage) : undefined;
  const closed = c && c.stage === 'Closed';

  return (
    <div className={`${styles.row} ${p.isMine ? styles.mine : ''}`}>
      <div className={styles.rowHead}>
        <span className={`${styles.badge} ${statusClass[p.status]}`}>{p.status === 'Missing' ? 'Missing report' : p.status}</span>
        <strong className={styles.sysName}>{p.system.name}</strong>
        {p.system.critical && <span className={styles.tag}>critical</span>}
        {p.system.group && <span className={styles.tag}>{p.system.group}</span>}
        <span className={styles.stage}>
          {c ? `Stage: ${c.stage}${c.assignedTo ? ` (${c.assignedTo.title})` : ''}` : 'Day not started'}
          {p.isMine && ' - assigned to you'}
        </span>
      </div>

      {p.system.instructions && <div className={styles.muted}>{p.system.instructions}</div>}

      <div className={styles.files}>
        {p.files.length === 0 && <span className={styles.muted}>No report uploaded for this day.</span>}
        {p.files.map(f => {
          const ins = p.insights[f.url];
          return (
            <div key={f.url} className={styles.file}>
              <a href={f.url} target="_blank" rel="noreferrer">{f.name}</a>
              <span className={styles.muted}> {new Date(f.created).toTimeString().slice(0, 5)} by {f.author}</span>
              {ins && ins.readable && (
                <span className={ins.errors ? styles.fail : ins.warnings ? styles.warn : styles.ok}>
                  {' '}{ins.errors} errors, {ins.warnings} warnings
                </span>
              )}
              {ins && !ins.readable && <span className={styles.muted}> (open the file to review)</span>}
              {ins && ins.lines.length > 0 && (
                <ul className={styles.lines}>{ins.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
              )}
            </div>
          );
        })}
        <input ref={fileInput} type="file" multiple hidden
          onChange={e => { const fl = Array.from(e.target.files || []); e.target.value = ''; if (fl.length) p.onUpload(fl); }} />
        <DefaultButton text="Upload report" iconProps={{ iconName: 'Upload' }} disabled={p.busy} onClick={() => fileInput.current && fileInput.current.click()} />
      </div>

      {c && (
        <>
          <div className={styles.actions}>
            {STATUSES.map(s => (
              <DefaultButton key={s} text={s} checked={c.status === s} disabled={p.busy || closed}
                className={c.status === s ? styles.selected : ''} onClick={() => p.onStatus(s)} />
            ))}
            {suggested && c.status === 'Pending' && (
              <PrimaryButton text={`Apply suggestion: ${suggested}`} disabled={p.busy} onClick={() => p.onStatus(suggested)} />
            )}
            {next && (c.status === 'Fail' || c.status === 'Warning') && (
              <PrimaryButton text={`Escalate to ${next}`} iconProps={{ iconName: 'Up' }} disabled={p.busy} onClick={p.onEscalate} />
            )}
            {!closed && c.status !== 'Pending' && (
              <DefaultButton text="Close" iconProps={{ iconName: 'CheckMark' }} disabled={p.busy} onClick={p.onClose} />
            )}
          </div>
          <div className={styles.noteRow}>
            <TextField multiline autoAdjustHeight placeholder="Notes" value={note} disabled={p.busy}
              onChange={(_, v) => setNote(v || '')} className={styles.note} />
            <DefaultButton text="Save note" disabled={p.busy || note === c.notes} onClick={() => p.onNote(note)} />
          </div>
          {c.history && (
            <div>
              <button className={styles.link} onClick={() => setShowHistory(!showHistory)}>
                {showHistory ? 'Hide history' : 'Show history'}
              </button>
              {showHistory && <pre className={styles.history}>{c.history}</pre>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
