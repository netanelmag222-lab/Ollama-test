import {
  buildSummary, displayStatus, historyLine, IDailyCheck, isDayHealthy, ISystem,
  planEscalation, scanText, suggestStatus
} from './model';

const sys: ISystem = {
  id: 1, key: 'vcheck-dmz', name: 'VMware DMZ', group: 'vmware', critical: true, instructions: '',
  owner: { id: 10, title: 'Owner One', email: 'o@x' },
  admin: { id: 20, title: 'Admin One', email: 'a@x' }
};
const check = (o: Partial<IDailyCheck>): IDailyCheck => ({
  id: 1, etag: '"1"', title: '2026-11-11|vcheck-dmz', date: '2026-11-11', systemKey: 'vcheck-dmz',
  status: 'Pending', stage: 'NOC', notes: '', history: '', modified: '', editor: '', ...o
});
const file = { name: 'r.csv', url: '/r.csv', created: '2026-11-11T05:00:00Z', author: 'x' };

describe('displayStatus', () => {
  it('shows Missing when nothing was decided and no report exists', () => {
    expect(displayStatus(undefined, [])).toBe('Missing');
    expect(displayStatus(check({}), [])).toBe('Missing');
  });
  it('shows Pending when a report exists but no decision', () => {
    expect(displayStatus(check({}), [file])).toBe('Pending');
  });
  it('keeps an explicit decision', () => {
    expect(displayStatus(check({ status: 'OK' }), [])).toBe('OK');
  });
});

describe('isDayHealthy', () => {
  it('is false when anything is Missing or Pending', () => {
    expect(isDayHealthy(['OK', 'Missing'])).toBe(false);
    expect(isDayHealthy(['OK', 'Pending'])).toBe(false);
  });
  it('is false for an empty day', () => {
    expect(isDayHealthy([])).toBe(false);
  });
  it('is true only for OK and N/A', () => {
    expect(isDayHealthy(['OK', 'N/A'])).toBe(true);
  });
});

describe('planEscalation', () => {
  it('moves NOC to System owner, then System to Admin', () => {
    expect(planEscalation(check({ status: 'Fail' }), sys)).toEqual({ stage: 'System', assignee: sys.owner });
    expect(planEscalation(check({ status: 'Fail', stage: 'System' }), sys)).toEqual({ stage: 'Admin', assignee: sys.admin });
  });
  it('refuses OK checks, the last stage, and missing people', () => {
    expect(planEscalation(check({ status: 'OK' }), sys)).toHaveProperty('error');
    expect(planEscalation(check({ status: 'Fail', stage: 'Admin' }), sys)).toHaveProperty('error');
    expect(planEscalation(check({ status: 'Fail' }), { ...sys, owner: undefined })).toHaveProperty('error');
  });
});

describe('scanText', () => {
  it('counts errors and warnings, ignoring zero counts', () => {
    const r = scanText('a.csv', 'job1,Completed\njob2,Failed\njob3,Completed with warnings\nTotal errors: 0\n');
    expect(r.errors).toBe(1);
    expect(r.warnings).toBe(1);
    expect(r.lines.length).toBe(2);
  });
  it('strips HTML tags', () => {
    const r = scanText('a.html', '<table><tr><td>vm1</td><td>Critical</td></tr><tr><td>vm2</td><td>ok</td></tr></table>');
    expect(r.errors).toBe(1);
  });
  it('marks binary types unreadable', () => {
    expect(scanText('a.xlsx', '').readable).toBe(false);
  });
});

describe('suggestStatus', () => {
  it('returns undefined when nothing is readable', () => {
    expect(suggestStatus([{ errors: 0, warnings: 0, lines: [], readable: false }])).toBeUndefined();
  });
  it('picks the worst', () => {
    expect(suggestStatus([{ errors: 0, warnings: 1, lines: [], readable: true }, { errors: 2, warnings: 0, lines: [], readable: true }])).toBe('Fail');
  });
});

describe('historyLine / buildSummary', () => {
  it('strips separators from actor and note', () => {
    expect(historyLine(new Date(2026, 10, 11, 7, 5), 'A|B', 'Escalated', 'x\ny')).toBe('2026-11-11 07:05 | A B | Escalated | x y');
  });
  it('lists only open items and never calls a Missing day OK', () => {
    const s = buildSummary('2026-11-11', [
      { system: sys, status: 'Missing', fileCount: 0 },
      { system: { ...sys, name: 'Other' }, status: 'OK', fileCount: 1 }
    ]);
    expect(s.subject).toContain('1 need attention');
    expect(s.text).toContain('VMware DMZ: Missing');
    expect(s.text).not.toContain('Other:');
  });
});
