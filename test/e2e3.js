// e2e3.js — 问题页完整往返（当前安装版本）：开评论 → 进线程 → 返回 → 再进 → 返回
'use strict';
const C = require('./cdp-local');

const clean = `const clean = s => (s || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').trim();`;

const ST = `(() => { ${clean}
  const ms = [...document.querySelectorAll('.Modal-content')];
  const vis = ms.filter(m => m.checkVisibility && m.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
  return {
    state: history.state, len: history.length,
    visModals: vis.length, allModals: ms.length,
    arrows: [...document.querySelectorAll('svg[class*="ArrowLeft"]')].filter(s => s.getBoundingClientRect().width > 8).length,
    inlineCmt: [...document.querySelectorAll('.Comments-container')].filter(c => getComputedStyle(c).display !== 'none').length,
    viewAll: [...document.querySelectorAll('button')].filter(b => clean(b.textContent).startsWith('查看全部') && b.getBoundingClientRect().width > 0).length,
    scrollY: Math.round(scrollY),
  };
})()`;

const CLICK = (kind) => `(() => { ${clean}
  const all = [...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0);
  const b = ${kind === 'va'
    ? `all.find(x => clean(x.textContent).startsWith('查看全部'))`
    : `all.find(x => /^\\d+\\s*条评论$/.test(clean(x.textContent)))`};
  if (!b) return 'not-found';
  const t = clean(b.textContent); b.click(); return 'clicked ' + t;
})()`;

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, process.env.TAB_FILTER || 'question/2108463757307240853');
  const sid = await C.attach(api, tab.targetId || tab.id);
  const S = async (tag) => { const r = await C.evalJson(api, ST, sid); console.log(tag.padEnd(16), JSON.stringify(r)); return r; };
  const back = async (ms = 2500) => { await C.evalJson(api, 'history.back();1', sid); await C.sleep(ms); };

  await api.send('Page.enable', {}, sid);
  await api.send('Page.reload', {}, sid);
  await C.sleep(9000);
  await S('0 重载后');
  console.log('开评论:', await C.evalJson(api, CLICK('cm'), sid));
  await C.sleep(9000);
  await S('1 评论区');
  console.log('进线程:', await C.evalJson(api, CLICK('va'), sid));
  await C.sleep(4000);
  await S('2 线程');
  await back(); await S('3 返回');
  console.log('再进线程:', await C.evalJson(api, CLICK('va'), sid));
  await C.sleep(4000);
  await S('4 线程2');
  await back(); await S('5 返回');
  await back(); await S('6 返回');
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
