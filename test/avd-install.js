// avd-install.js — 在 AVD Kiwi 上安装脚本（skill 流程：confirm 自动点击）
'use strict';
const C = require('./cdp-local');

(async () => {
  const api = await C.browserApi();
  const list = await C.getTargets(api);
  const t = list.find(x => x.type === 'page' && (x.url || '').includes('localhost:8099'))
    || list.find(x => x.type === 'page' && (x.url || '').includes('8099'));
  if (!t) { console.log('no 8099 tab; targets:', list.filter(x=>x.type==='page').map(x=>x.url.slice(0,40)).join(' | ')); process.exit(1); }
  const sid = await C.attach(api, t.targetId);
  await api.send('Page.bringToFront', {}, sid);
  await C.sleep(400);
  console.log('title:', await C.evalJson(api, 'document.title.slice(0,50)', sid));
  const hasConfirm = await C.evalJson(api, "!!document.getElementById('confirm')", sid);
  console.log('hasConfirm:', hasConfirm);
  if (!hasConfirm) { console.log('body:', (await C.evalJson(api, 'document.body.innerText.slice(0,80)', sid))); process.exit(1); }
  // 点击 confirm（中英文兼容，轮询）
  let clicked = false;
  for (let j = 0; j < 6; j++) {
    const r = await C.evalJson(api, `(() => {
      const b = [...document.querySelectorAll('button')].find(x => ['安装','重装','Install','Reinstall'].some(k => (x.innerText||'').trim().startsWith(k)));
      if (b) { b.click(); return 'clicked ' + (b.innerText||'').trim(); }
      return 'nf';
    })()`, sid);
    console.log('try', j, r);
    if (String(r).startsWith('clicked')) { clicked = true; break; }
    await C.sleep(1500);
  }
  console.log(clicked ? 'INSTALLED' : 'FAILED');
  process.exit(clicked ? 0 : 1);
})().catch(e => { console.error('ERR', e.message.slice(0, 80)); process.exit(1); });
