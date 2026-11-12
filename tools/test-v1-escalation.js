// Loads the patched web part in Chromium with a mocked SharePoint list and clicks through escalation.
const { chromium } = require('playwright');
const fs = require('fs');
const bundle = fs.readFileSync(process.argv[2], 'utf8');
const page_html = `<!doctype html><meta charset="utf-8"><body><div id="host" style="height:900px"></div><script>
window.__log=[]; window.prompt=()=> 'בדיקה'; window.confirm=()=>true;
const store={items:{},next:1}; window.__store=store;
function resp(status, obj){ return { ok: status<300, status, text: async()=> obj===undefined?'':JSON.stringify(obj), json: async()=>obj }; }
const http={
  async get(url){ return resp(200,{value:Object.values(store.items)}); },
  async post(url,cfg,opt){ const h=opt.headers||{}; const m=/items\\((\\d+)\\)/.exec(url); const body=opt.body?JSON.parse(opt.body):{};
    if(!m){ const id=store.next++; store.items[id]=Object.assign({Id:id,owshiddenversion:1},body); window.__log.push('create '+body.Title); return resp(201,store.items[id]); }
    const it=store.items[m[1]]; if(!it) return resp(404,{});
    const want=h['IF-MATCH']; if(want!=='*' && want!=='"'+it.owshiddenversion+'"'){ window.__log.push('412 '+it.Title+' want '+want+' have '+it.owshiddenversion); return resp(412,{}); }
    if(want==='*') window.__log.push('WILDCARD '+h['X-HTTP-Method']);
    if(h['X-HTTP-Method']==='DELETE'){ delete store.items[m[1]]; return resp(204); }
    Object.assign(it,body); it.owshiddenversion++; window.__log.push('merge '+it.Title+' v'+it.owshiddenversion); return resp(204); } };
function Base(){}
window.define=(n,deps,f)=>{ window.__mod=f({BaseClientSideWebPart:Base},{SPHttpClient:{configurations:{v1:{}}}}); };
</script><script>${bundle.replace(/<\/script>/g,'<\\/script>')}</script><script>
const W=window.__mod.default; const wp=new W(); wp.domElement=document.getElementById('host');
wp.context={spHttpClient:http,pageContext:{web:{absoluteUrl:'https://t/sites/noc'},user:{displayName:'Dana NOC'}}};
wp.render(); window.__root=wp.domElement.shadowRoot;
</script>`;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.setContent(page_html); await p.waitForTimeout(1500);
  const R = (fn, ...a) => p.evaluate(fn, ...a);
  const click = sel => R(s => { const el = window.__root.querySelector(s); if (!el) throw new Error('missing ' + s); el.click(); }, sel);
  const toast = () => R(() => [...window.__root.querySelectorAll('.toast, #toast, [class*=toast]')].map(x => x.textContent.trim()).filter(Boolean).slice(-1)[0] || '');
  await click('[data-act="go"][data-v="analysis"]'); await p.waitForTimeout(300);
  // pick a system that has an owner (Linux: Boris Shtil)
  const sysId = await R(() => { const c = [...window.__root.querySelectorAll('.card[data-sys]')].find(c => /Linux/.test(c.querySelector('h3').textContent)); return c.dataset.sys; });
  const card = `#card-${sysId}`;
  await R(id => { window.__root.querySelector('#card-' + id + ' .chead').click(); }, sysId);
  await click(`${card} [data-act="mstatus"][data-v="alerts"]`); await p.waitForTimeout(1200);
  const btn1 = await R(s => window.__root.querySelector(s + ' [data-act="escup"]').textContent, card);
  console.log('button before escalation:', btn1.trim());
  await click(`${card} [data-act="escup"]`); await p.waitForTimeout(1200);
  console.log('after step 1:', (await R(s => window.__root.querySelector(s + ' .box:last-child').innerText, card)).replace(/\s+/g, ' '));
  console.log('header tags:', (await R(s => window.__root.querySelector(s + ' .chead').innerText, card)).replace(/\s+/g, ' ').slice(0, 200));
  await click(`${card} [data-act="escup"]`); await p.waitForTimeout(500);
  console.log('escalate without admin ->', await toast());
  // set admin in the catalog
  await click('[data-act="go"][data-v="catalog"]'); await p.waitForTimeout(300);
  await click(`[data-act="csopen"][data-id="${sysId}"]`); await p.waitForTimeout(300);
  await R(id => { const i = window.__root.querySelector(`[data-c="${id}"][data-f="admin"]`); i.value = 'Avi Admin'; i.dispatchEvent(new Event('change', { bubbles: true })); }, sysId);
  await p.waitForTimeout(1200);
  await click('[data-act="go"][data-v="analysis"]'); await p.waitForTimeout(300);
  await R(id => { const c = window.__root.querySelector('#card-' + id); if (!c.querySelector('.cbody')) c.querySelector('.chead').click(); }, sysId);
  await click(`${card} [data-act="escup"]`); await p.waitForTimeout(1200);
  console.log('after step 2:', (await R(s => window.__root.querySelector(s + ' .box:last-child').innerText, card)).replace(/\s+/g, ' '));
  // filter: escalated
  await R(() => { const s = window.__root.querySelector('[data-flt="sev"]'); s.value = 'esc'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  console.log('cards with filter "בהסלמה":', await R(() => window.__root.querySelectorAll('#cardsHost .card').length));
  await R(() => { const s = window.__root.querySelector('[data-flt="sev"]'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await R(id => { const c = window.__root.querySelector('#card-' + id); if (!c.querySelector('.cbody')) c.querySelector('.chead').click(); }, sysId);
  await click(`${card} [data-act="escclose"]`); await p.waitForTimeout(1200);
  console.log('after close:', (await R(s => window.__root.querySelector(s + ' .box:last-child').innerText, card)).replace(/\s+/g, ' '));
  // conflict: someone else saves the day item
  await R(() => { const it = Object.values(window.__store.items).find(i => /\|DAY\|/.test(i.Title)); it.owshiddenversion += 5; });
  await R(id => { const c = window.__root.querySelector('#card-' + id); if (!c.querySelector('.cbody')) c.querySelector('.chead').click(); }, sysId);
  await click(`${card} [data-act="escreopen"]`); await p.waitForTimeout(1500);
  console.log('conflict toast ->', await toast());
  const day = Object.values(await R(() => window.__store.items)).find(i => /\|DAY\|/.test(i.Title));
  const st = JSON.parse(day.Payload); console.log('stored esc:', JSON.stringify(st.manual[sysId].esc));
  console.log('log:', (await R(() => window.__log)).filter(x => !/^merge/.test(x)).join(' / '));
  console.log('page errors:', errors.length ? errors : 'none');
  await b.close();
})().catch(e => { console.error('HARNESS FAIL', e); process.exit(1); });
