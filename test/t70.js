// t70.js — 直连 target 70 检查
'use strict';
const C = require('./cdp-local');
(async () => {
  const api = await C.browserApi();
  const sid = await C.attach(api, '70');
  await api.send('Page.bringToFront', {}, sid);
  await C.sleep(600);
  const r = await C.evalJson(api, `(() => ({ title: document.title.slice(0,45), confirm: !!document.getElementById('confirm'), body: document.body.innerText.slice(0,60) }))()`, sid);
  console.log(JSON.stringify(r));
  api.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message.slice(0, 80)); process.exit(1); });
