// open-through.js — 打开评论并进线程：node open-through.js [评论按钮文案前缀]
'use strict';
const C = require('./cdp-local');

const byPrefix = (prefix) => `(() => {
  const clean = s => (s || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').trim();
  const b = [...document.querySelectorAll('button')].find(x => clean(x.textContent).startsWith(${JSON.stringify(prefix)}) && x.getBoundingClientRect().width > 0);
  if (!b) return 'not-found';
  const t = clean(b.textContent);
  b.click();
  return 'clicked ' + t;
})()`;

const clickViewAll = `(() => {
  const clean = s => (s || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').trim();
  const b = [...document.querySelectorAll('button')].find(x => clean(x.textContent).startsWith('查看全部') && x.getBoundingClientRect().width > 0);
  if (!b) return 'not-found';
  const t = clean(b.textContent);
  b.click();
  return 'clicked ' + t;
})()`;

const ST = `(() => {
  const modals = [...document.querySelectorAll('.Modal-content')];
  return {
    state: history.state, len: history.length, scrollY: Math.round(scrollY),
    visModals: modals.filter(m => m.checkVisibility && m.checkVisibility({ opacityProperty: true, visibilityProperty: true })).length,
    arrows: [...document.querySelectorAll('svg[class*="ArrowLeft"]')].filter(s => s.getBoundingClientRect().width > 8).length,
  };
})()`;

(async () => {
  const prefix = process.argv[2] || '1065';
  const api = await C.browserApi();
  const tab = await C.findTab(api, '/answer/');
  const sid = await C.attach(api, tab.targetId || tab.id);
  console.log('comment:', await C.evalJson(api, byPrefix(prefix), sid));
  await C.sleep(6000);
  console.log('viewAll:', await C.evalJson(api, clickViewAll, sid));
  await C.sleep(4000);
  console.log('state:', JSON.stringify(await C.evalJson(api, ST, sid)));
  await C.screenshot(api, sid, __dirname + '/shots/through.png');
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
