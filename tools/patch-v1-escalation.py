"""Adds the NOC -> System -> Admin escalation workflow to an extracted 1.0.3.0 package.

Usage: python3 -I tools/patch-v1-escalation.py <extracted-1.0.3.0-dir>
Result: the same folder becomes 1.0.4.0 with a renamed JS asset.
"""
import glob
import hashlib
import os
import sys

root = sys.argv[1]
js = glob.glob(root + '/ClientSideAssets/*.js')[0]
s = open(js, encoding='utf-8').read()
assert 'function escHTML' not in s, 'already patched'


def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, (n, old[:90])
    s = s.replace(old, new)


ESC_CODE = r"""/* ---------- הסלמה: NOC -> צוות מערכת -> מנהל מערכת ---------- */
const ESC_L = { noc: 'NOC', system: 'צוות מערכת', admin: 'מנהל מערכת', closed: 'טופל' };
const meName = () => nz(__spfx.userDisplayName || S.settings.inspector || '');
const escOpen = x => !!x && (x.stage === 'system' || x.stage === 'admin');
function escOf(m) { return (m && m.esc) || { stage: 'noc', to: '', hist: [] }; }
function escTarget(stage, e) {
  if (stage === 'system') return e.owner || e.sys.owner || '';
  if (stage === 'admin') return e.sys.admin || '';
  return '';
}
function escHTML(e) {
  const s = e.sys, x = escOf(e.m), open = escOpen(x);
  const canUp = e.status === 'alerts' && (x.stage === 'noc' || x.stage === 'system');
  const next = x.stage === 'noc' ? 'system' : 'admin', nextTo = escTarget(next, e);
  if (!canUp && x.stage === 'noc' && !(x.hist || []).length) return '';
  const btns = [
    canUp ? `<button class="btn pri sm" data-act="escup" data-id="${s.id}">⬆️ העבר ל${ESC_L[next]}${nextTo ? ': ' + esc(nextTo) : ' (לא הוגדר)'}</button>` : '',
    open ? `<button class="btn sm" data-act="escclose" data-id="${s.id}">✅ סמן כטופל</button>` : '',
    x.stage === 'closed' ? `<button class="btn sm" data-act="escreopen" data-id="${s.id}">↩️ פתח מחדש</button>` : ''
  ].join(' ');
  const hist = (x.hist || []).slice().reverse().map(h => `<div class="muted small">${esc(fmtDT(h.t))} · ${esc(h.by)} · ${esc(h.a)}${h.note ? ' · ' + esc(h.note) : ''}</div>`).join('');
  return `<div class="box" style="margin-top:10px"><h5>הסלמה</h5>
    <div style="margin-bottom:6px">שלב: <b>${ESC_L[x.stage] || x.stage}</b>${x.to ? ' · מטפל: <b>' + esc(x.to) + '</b>' : ''}${open && meName() && nz(x.to) === meName() ? ' <span class="tag amber">מוקצה אליך</span>' : ''}</div>
    <div class="row">${btns}</div>${hist ? `<div style="margin-top:8px">${hist}</div>` : ''}</div>`;
}
function escMove(id, stage, action) {
  const sys = sysById(id); if (!sys) return;
  const e = evalSystem(sys), m = (D().manual[id] = D().manual[id] || {});
  const x = m.esc = escOf(m); x.hist = x.hist || [];
  const to = escTarget(stage, e);
  if ((stage === 'system' || stage === 'admin') && !to) {
    toast(stage === 'system' ? 'לא הוגדר אחראי ראשי למערכת. הגדר אותו בקטלוג המערכות.' : 'לא הוגדר מנהל מערכת. הגדר אותו בקטלוג המערכות (כפתור פרטים).', 'err');
    return;
  }
  const note = window.prompt(action + (to ? ' ← ' + to : '') + '\nהערה (לא חובה):', '');
  if (note === null) return;
  x.stage = stage; x.to = to;
  x.hist.push({ t: new Date().toISOString(), by: __spfx.userDisplayName || S.settings.inspector || '', a: action + (to ? ' ← ' + to : ''), note: String(note).trim() });
  UI.open[id] = true; save(true); rerenderCard(id); toast(action + (to ? ': ' + to : ''), 'ok');
}
function openEscalations() {
  const out = [];
  Object.keys(S.days || {}).sort().forEach(key => {
    const man = (S.days[key] && S.days[key].manual) || {};
    Object.keys(man).forEach(id => { const x = man[id] && man[id].esc, sys = sysById(id); if (sys && escOpen(x)) out.push({ key, sys, x }); });
  });
  return out;
}
function escBannerHTML() {
  const l = openEscalations().filter(o => o.key !== S.cur);
  if (!l.length) return '';
  return `<div class="glass pad" style="margin-bottom:14px;border:1px solid #f59e0b"><b>⬆️ הסלמות פתוחות מימים קודמים (${l.length})</b>
    ${l.map(o => `<div class="row" style="margin-top:6px"><span>${esc(fmtDate(o.key))} · <b>${esc(o.sys.name)}</b> · ${ESC_L[o.x.stage]}${o.x.to ? ': ' + esc(o.x.to) : ''}${meName() && nz(o.x.to) === meName() ? ' <span class="tag amber">מוקצה אליך</span>' : ''}</span><button class="btn sm" data-act="openday" data-id="${o.key}">פתח את היום</button></div>`).join('')}</div>`;
}
"""

# 1. escalation functions
rep('function cardHTML(e) {', ESC_CODE + 'function cardHTML(e) {')
# 2. escalation box under the manual-marking box in each card
rep('body = `<div class="cbody"><div class="two" style="margin-top:14px"><div>${left}</div><div>${right}</div></div></div>`;',
    'body = `<div class="cbody"><div class="two" style="margin-top:14px"><div>${left}</div><div>${right}${escHTML(e)}</div></div></div>`;')
# 3. tag on the card header and in the report
rep("  if (staleFiles.length) tags.push({ t: '⚠️ דוח ישן', c: 'amber' });",
    "  if (staleFiles.length) tags.push({ t: '⚠️ דוח ישן', c: 'amber' });\n"
    "  if (escOpen(m.esc)) tags.push({ t: '⬆️ ' + ESC_L[m.esc.stage] + (m.esc.to ? ': ' + m.esc.to : ''), c: 'amber' });\n"
    "  else if (m.esc && m.esc.stage === 'closed') tags.push({ t: '✅ הסלמה טופלה', c: '' });")
# 4. click handlers
rep('  quick(el) {',
    "  escup(el) { const id = el.dataset.id, x = escOf(D().manual[id]); if (x.stage === 'noc') escMove(id, 'system', 'הועבר לצוות מערכת'); else escMove(id, 'admin', 'הועבר למנהל מערכת'); },\n"
    "  escclose(el) { escMove(el.dataset.id, 'closed', 'סומן כטופל'); },\n"
    "  escreopen(el) { escMove(el.dataset.id, 'system', 'נפתח מחדש'); },\n"
    '  quick(el) {')
# 5. filters: escalated / assigned to me
rep("    if (f.sev === 'unchecked') return e.status === 'notchecked';",
    "    if (f.sev === 'esc') return escOpen(e.m.esc);\n"
    "    if (f.sev === 'mine') return escOpen(e.m.esc) && !!meName() && nz(e.m.esc.to) === meName();\n"
    "    if (f.sev === 'unchecked') return e.status === 'notchecked';")
rep("['ok', 'תקין'], ['unchecked', 'לא נבדק']], f.sev)}</select>",
    "['ok', 'תקין'], ['unchecked', 'לא נבדק'], ['esc', '⬆️ בהסלמה'], ['mine', '👤 מוקצה אליי']], f.sev)}</select>")
# 6. banner with open escalations from earlier days
rep("<p>ממצאי הניתוח האוטומטי מוצגים בכל כרטיס. השלם ידנית את מה שחסר.</p></div></div>${stepperHTML()}",
    "<p>ממצאי הניתוח האוטומטי מוצגים בכל כרטיס. השלם ידנית את מה שחסר.</p></div></div>${stepperHTML()}${escBannerHTML()}")
# 7. catalog: system admin field (escalation stage 3)
rep('<div><label class="f">קישור לקונסולה</label><input type="text" data-c="${s.id}" data-f="link" value="${esc(s.link)}" placeholder="https://"></div>',
    '<div><label class="f">קישור לקונסולה</label><input type="text" data-c="${s.id}" data-f="link" value="${esc(s.link)}" placeholder="https://"></div>'
    '<div><label class="f">מנהל מערכת ראשי (שלב הסלמה 3)</label><input type="text" list="ownersList" data-c="${s.id}" data-f="admin" value="${esc(s.admin)}" placeholder="יש לאמת"></div>')

new_name = 'morning-checks-web-part_' + hashlib.sha1(s.encode()).hexdigest()[:20] + '.js'
old_name = os.path.basename(js)
open(os.path.join(os.path.dirname(js), new_name), 'w', encoding='utf-8').write(s)
os.remove(js)
for p in glob.glob(root + '/**/*', recursive=True):
    if os.path.isfile(p) and (p.endswith('.xml') or p.endswith('.rels')):
        t = open(p, encoding='utf-8').read()
        o = t
        t = t.replace(old_name, new_name).replace('Version="1.0.3.0"', 'Version="1.0.4.0"')
        if t != o:
            open(p, 'w', encoding='utf-8').write(t)
            print('updated', os.path.relpath(p, root))
print(old_name, '->', new_name)
