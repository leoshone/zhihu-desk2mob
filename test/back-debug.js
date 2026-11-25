// back-debug.js — 用 __z2mLog 看清「返回键到底走了哪个分支」
'use strict';
const fs = require('fs');
const C = require('./cdp-local');
const SRC = fs.readFileSync(__dirname + '/../zhihu-desk2mob.user.js', 'utf8');

const clean = `const clean = s => (s || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').trim();`;

const ST = `(() => { ${clean}
  const ms = [...document.querySelectorAll('.Modal-content')];
  return {
    state: history.state, len: history.length,
    modals: ms.length,
    visModals: ms.filter(m => m.checkVisibility && m.checkVisibility({ opacityProperty: true, visibilityProperty: true })).length,
    arrowsByRect: [...document.querySelectorAll('svg[class*="ArrowLeft"]')].filter(s => s.getBoundingClientRect().width > 8).length,
    inlineCmt: [...document.querySelectorAll('.Comments-container')].filter(c => getComputedStyle(c).display !== 'none').length,
    viewAll: [...document.querySelectorAll('button')].filter(b => clean(b.textContent).startsWith('查看全部') && b.getBoundingClientRect().width > 0).length,
    log: window.__z2mLog || [],
  };
})()`;

const CLICK_VA = `(() => { ${clean}
  const b = [...document.querySelectorAll('button')].find(x => clean(x.textContent).startsWith('查看全部') && x.getBoundingClientRect().width > 0);
  if (!b) return 'not-found';
  const t = clean(b.textContent); b.click(); return 'clicked ' + t;
})()`;

const CLICK_CM = `(() => { ${clean}
  const b = [...document.querySelectorAll('button')].find(x => /^\\d+\\s*条评论$/.test(clean(x.textContent)) && x.getBoundingClientRect().width > 0);
  if (!b) return 'not-found';
  const t = clean(b.textContent); b.click(); return 'clicked ' + t;
})()`;

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, process.env.TAB_FILTER || 'question/2108463757307240853');
  const sid = await C.attach(api, tab.targetId || tab.id);
  const S = async (tag) => { const r = await C.evalJson(api, ST, sid); console.log(tag.padEnd(12), JSON.stringify(r)); return r; };

  await api.send('Page.enable', {}, sid);
  try { await api.send('Page.bringToFront', {}, sid); } catch (e) {}
  await C.sleep(800);
  await api.send('Page.reload', {}, sid);
  await C.sleep(7000);
  if (process.env.INJECT !== '0') { await C.evalJson(api, SRC, sid); await C.sleep(1200); }

  if (!(await S('0').then(r => r.viewAll || r.inlineCmt))) {
    console.log('开评论:', await C.evalJson(api, CLICK_CM, sid));
    await C.sleep(8000);
  }
  await S('1');
  console.log('进线程:', await C.evalJson(api, CLICK_VA, sid));
  await C.sleep(4000);
  await S('2 线程');
  await C.evalJson(api, 'history.back();1', sid);
  await C.sleep(2500);
  await S('3 返回→列表?');
  await C.evalJson(api, 'history.back();1', sid);
  await C.sleep(2500);
  await S('4 返回→关弹层?');
  console.log('再返回（应为正常导航/无操作）:');
  await C.evalJson(api, 'history.back();1', sid);
  await C.sleep(2500);
  await S('5 第三次返回');
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
