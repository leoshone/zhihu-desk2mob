// watch-back.js — 实时监控真机手势返回：每 300ms 轮询页面状态 60 秒，
// 捕捉 popstate 是否到达、哨兵变化、弹层视图变化。配合用户手滑测试。
'use strict';
const C = require('./cdp-local');

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, process.env.TAB_FILTER || 'question/655443488');
  if (!tab) { console.log('no tab'); process.exit(1); }
  const sid = await C.attach(api, tab.targetId);
  await api.send('Page.bringToFront', {}, sid).catch(() => {});

  // 在页面里装高频记录器：popstate/hashchange 都记时间戳
  await C.evalJson(api, `(() => {
    window.__events = [];
    const stamp = m => { window.__events.push(performance.now().toFixed(0) + 'ms ' + m); };
    stamp('watch start st=' + (history.state ? Object.keys(history.state)[0] : 'null'));
    addEventListener('popstate', () => stamp('POPSTATE st=' + (history.state ? Object.keys(history.state)[0] : 'null')));
    return 'ok';
  })()`, sid);

  const SNAP = `(() => { const clean = s => (s || '').replace(/[\\u200b]/g, '').trim();
    const m = [...document.querySelectorAll('.Modal-content')].find(x => x.checkVisibility && x.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
    return {
      st: history.state ? Object.keys(history.state)[0] : null,
      mv: m ? 1 : 0,
      view: m ? (m.children.length > 1 ? 'multi' : (clean(m.textContent).startsWith('106') || /条评论/.test(clean(m.textContent).slice(0, 30)) ? 'list' : 'thread')) : '-',
      arrows: [...document.querySelectorAll('svg[class*="ArrowLeft"]')].filter(s => s.getBoundingClientRect().width > 8).length,
      log: (window.__z2mLog || []).slice(-2),
      ev: (window.__events || []).slice(-3),
    }; })()`;

  console.log('监控中（60s）。请现在开始手滑测试……');
  let last = '';
  for (let i = 0; i < 200; i++) {
    await C.sleep(300);
    const r = await C.evalJson(api, SNAP, sid).catch(() => null);
    if (!r) { console.log('[' + (i * 0.3).toFixed(1) + 's] CDP 断开'); break; }
    const sig = JSON.stringify([r.st, r.mv, r.view, r.arrows, r.ev.length]);
    if (sig !== last) { console.log((i * 0.3).toFixed(1) + 's', JSON.stringify(r)); last = sig; }
  }
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
