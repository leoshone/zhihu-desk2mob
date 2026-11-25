// e2e2.js — 完整往返：开评论 → 进线程 → 返回(回列表) → 再进 → 返回 → 返回(关弹层)
'use strict';
const C = require('./cdp-local');

const clean = `const clean = s => (s || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').trim();`;
const CLICK_PREFIX = (p) => `(() => { ${clean}
  const b = [...document.querySelectorAll('button')].find(x => clean(x.textContent).startsWith(${JSON.stringify(p)}) && x.getBoundingClientRect().width > 0);
  if (!b) return 'not-found';
  const t = clean(b.textContent); b.click(); return 'clicked ' + t;
})()`;

const ST = `(() => { ${clean}
  const modals = [...document.querySelectorAll('.Modal-content')];
  const vis = modals.filter(m => m.checkVisibility && m.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
  return {
    state: history.state, len: history.length,
    visModals: vis.length, allModals: modals.length,
    arrows: [...document.querySelectorAll('svg[class*="ArrowLeft"]')].filter(s => s.getBoundingClientRect().width > 8).length,
    viewAll: [...document.querySelectorAll('button')].filter(b => clean(b.textContent).startsWith('查看全部') && b.getBoundingClientRect().width > 0).length,
    inlineCmt: [...document.querySelectorAll('.Comments-container')].filter(c => getComputedStyle(c).display !== 'none').length,
  };
})()`;

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, process.env.TAB_FILTER || '/answer/');
  const sid = await C.attach(api, tab.targetId || tab.id);
  const S = async (tag) => { const r = await C.evalJson(api, ST, sid); console.log(tag.padEnd(16), JSON.stringify(r)); return r; };
  const back = async (ms = 2500) => { await C.evalJson(api, 'history.back();1', sid); await C.sleep(ms); };

  await api.send('Page.enable', {}, sid);
  await api.send('Page.reload', {}, sid);
  await C.sleep(8000);
  await S('0 重载后');

  console.log('开评论:', await C.evalJson(api, CLICK_PREFIX('1065'), sid));
  await C.sleep(9000);
  await S('1 评论展开');

  console.log('进线程:', await C.evalJson(api, CLICK_PREFIX('查看全部'), sid));
  await C.sleep(4000);
  await S('2 线程视图');

  await back(); await S('3 返回→列表?');
  console.log('再进线程:', await C.evalJson(api, CLICK_PREFIX('查看全部'), sid));
  await C.sleep(4000);
  await S('4 第二轮线程');
  await back(); await S('5 返回→列表?');
  await back(); await S('6 返回→关弹层?');
  await C.sleep(2000); await S('7 再等2s');
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
