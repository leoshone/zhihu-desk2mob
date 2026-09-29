// kiwi-cdp.js — generic CDP driver for the phone's Kiwi browser + Violentmonkey.
// Usage:
//   node kiwi-cdp.js install <RAW_URL>          auto install/update a userscript into VM (no human tap)
//   node kiwi-cdp.js verify  <EXT_ID>          open VM options page, list installed scripts
//   node kiwi-cdp.js inject  <FILE> [URL_SUBSTR] inject a local userscript into a live tab (temporary)
//   node kiwi-cdp.js list                       list open tabs
const fs = require('fs');
const http = require('http');
const { execSync } = require('child_process');
// adb is on PATH (installed at C:\platform-tools).
try { execSync('adb forward tcp:9222 localabstract:chrome_devtools_remote'); } catch (e) {}
const WS = globalThis.WebSocket;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);

function connectWs(url) {
  return new Promise((res, rej) => {
    const ws = new WS(url); const pend = new Map(); let id = 0; const evh = new Map();
    const api = { ws, send: (m, p = {}, sid) => new Promise((r2, j2) => { const i = ++id; pend.set(i, { r2, j2 }); const msg = { id: i, method: m, params: p }; if (sid) msg.sessionId = sid; try { ws.send(JSON.stringify(msg)); } catch (e) { j2(e); } }), on: (e, cb) => evh.set(e, cb), close: () => { try { ws.close(); } catch (e) {} } };
    ws.onopen = () => res(api);
    ws.onerror = e => { if (pend.size === 0) rej(new Error('ws onerror ' + (e && e.message))); };
    ws.onmessage = m => { let j; try { j = JSON.parse(m.data); } catch (e) { return; } if (j.id && pend.has(j.id)) { const { r2, j2 } = pend.get(j.id); pend.delete(j.id); j.error ? j2(new Error(JSON.stringify(j.error))) : r2(j.result); } else if (j.method && evh.has(j.method)) { try { evh.get(j.method)(j.params || {}); } catch (e) {} } };
    setTimeout(() => rej(new Error('ws timeout')), 5000);
  });
}
async function rawEval(api, expr, sid) { const r = await api.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sid); return r && r.result; }
async function waitReady(api, tries, sid) {
  for (let i = 0; i < tries; i++) { let o = null; try { const r = await rawEval(api, `JSON.stringify({rs:document.readyState,de:!!document.documentElement})`, sid); o = JSON.parse(r && r.value || 'null'); } catch (e) {} if (o && o.de && o.rs === 'complete') return true; await sleep(1000); }
  return false;
}
async function shot(api, path, sid) {
  try { const r = await Promise.race([api.send('Page.captureScreenshot', { format: 'png' }, sid), new Promise((_, rej) => setTimeout(() => rej(new Error('shot timeout')), 8000))]); fs.writeFileSync(path, Buffer.from(r.data, 'base64')); } catch (e) { log('  (shot skipped:', e.message + ')'); }
}
async function getTargets(api) { return (await api.send('Target.getTargets')).targetInfos || []; }
async function findTab(api, substr) { return (await getTargets(api)).find(t => t.type === 'page' && (substr ? (t.url || '').includes(substr) : true)) || null; }

// --- install: auto install/update a userscript into Violentmonkey (no human tap) ---
async function cmdInstall(rawUrl) {
  const api = await connectWs('ws://127.0.0.1:9222/devtools/browser');
  // 1. close stale confirm tabs
  for (const t of await getTargets(api)) if (/confirm\/index\.html/.test(t.url || '')) { try { await api.send('Target.closeTarget', { targetId: t.targetId }); } catch (e) {} }
  // 2. open raw url in a NEW tab -> VM confirm page
  const nt = await api.send('Target.createTarget', { url: rawUrl });
  log('createTarget ->', nt.targetId);
  // 3. poll confirm page, attach, ensure #confirm exists, click
  let sid = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1500);
    const c = (await getTargets(api)).find(t => /confirm\/index\.html/.test(t.url || ''));
    if (!c) continue;
    const cs = (await api.send('Target.attachToTarget', { targetId: c.targetId, flatten: true })).sessionId;
    await api.send('Runtime.enable', {}, cs);
    await waitReady(api, 10, cs);
    const has = await rawEval(api, `!!document.querySelector('#confirm')`, cs);
    const txt = await rawEval(api, `JSON.stringify((document.body.innerText||'').slice(0,160))`, cs);
    log(`  poll ${i}: hasBtn=${has && has.value} text=${txt && txt.value}`);
    if (has && has.value) { sid = cs; break; }
    try { await api.send('Target.detachFromTarget', { sessionId: cs }); } catch (e) {}
  }
  if (!sid) { log('NO usable confirm page'); api.close(); process.exit(1); }
  const r = await rawEval(api, `(()=>{const b=document.querySelector('#confirm'); if(b){b.click(); return 'clicked';} return 'no #confirm';})()`, sid);
  log('CLICK #confirm ->', r && r.value);
  await sleep(3000);
  const after = await rawEval(api, `JSON.stringify((document.body.innerText||'').slice(0,160))`, sid);
  log('AFTER CLICK:', after && after.value);
  api.close();
}

// --- verify: open VM options page, list installed scripts ---
async function cmdVerify(extId) {
  const api = await connectWs('ws://127.0.0.1:9222/devtools/browser');
  const nt = await api.send('Target.createTarget', { url: `chrome-extension://${extId}/options/index.html` });
  const cs = (await api.send('Target.attachToTarget', { targetId: nt.targetId, flatten: true })).sessionId;
  await api.send('Runtime.enable', {}, cs);
  await waitReady(api, 20, cs);
  await sleep(2000);
  const body = await rawEval(api, `document.body.innerText`, cs);
  log('INSTALLED SCRIPTS:\n' + (body && body.value ? body.value : '(empty)'));
  api.close();
}

// --- inject: run a local userscript file in a live tab (temporary, until refresh) ---
async function cmdInject(file, substr) {
  const code = fs.readFileSync(file, 'utf8');
  const api = await connectWs('ws://127.0.0.1:9222/devtools/browser');
  const tab = await findTab(api, substr);
  if (!tab) { log('NO matching tab'); api.close(); process.exit(1); }
  const cs = (await api.send('Target.attachToTarget', { targetId: tab.targetId, flatten: true })).sessionId;
  await api.send('Runtime.enable', {}, cs);
  await waitReady(api, 30, cs);
  const r = await rawEval(api, `(()=>{ try { ${code} ; return 'injected'; } catch(e){ return 'ERR:'+e.message; } })()`, cs);
  log('inject', file, '->', r && r.value);
  api.close();
}

// --- list tabs ---
async function cmdList() {
  const api = await connectWs('ws://127.0.0.1:9222/devtools/browser');
  const ts = await getTargets(api);
  ts.filter(t => t.type === 'page').forEach(t => log(' ', t.id, t.url));
  api.close();
}

(async () => {
  const [, , cmd, a1, a2] = process.argv;
  if (cmd === 'install') return cmdInstall(a1);
  if (cmd === 'verify') return cmdVerify(a1 || 'fcickoepngcnapddnnmjpkmpekmfmpaa');
  if (cmd === 'inject') return cmdInject(a1, a2);
  if (cmd === 'list') return cmdList();
  log('Usage: node kiwi-cdp.js [install <RAW>|verify <EXT>|inject <FILE> [URL]|list]');
  process.exit(1);
})().catch(e => { log('ERR', e.message); process.exit(1); });
