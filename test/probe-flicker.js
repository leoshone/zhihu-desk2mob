// probe-flicker.js — 诊断「底部浮动评论工具栏闪烁」：对吸底栏挂 MutationObserver(style/attribute)
// 记录每一拍谁改了什么，然后驱动真机滚动复现。
// 用法: node probe-flicker.js <tab子串>（默认 answer）
'use strict';
const cdp = require('./cdp');

// 在页面里装记录器：监听 .ContentItem-actions.Sticky 的 attribute 变化 + scroll，
// 记录 200 条内联样式变更（含新值），并同步记录我们的每拍重写。
const INSTALL = `JSON.stringify((()=>{
  const s = document.querySelector('.ContentItem-actions.Sticky');
  if (!s) return { err: 'no sticky bar' };
  window.__flick = { log: [], scrolls: 0 };
  const L = window.__flick.log;
  const push = o => { if (L.length < 400) L.push(o); };
  new MutationObserver(muts => {
    for (const m of muts) {
      push({ t: performance.now()|0, type: m.type, attr: m.attributeName,
             old: (m.oldValue||'').slice(0,120), now: s.getAttribute(m.attributeName||'style') });
    }
  }).observe(s, { attributes: true, attributeOldValue: true, attributeFilter: ['style','class'] });
  addEventListener('scroll', () => { window.__flick.scrolls++; }, { passive: true });
  return { bar: s.className, inline: s.getAttribute('style'),
           rect: (r => [r.top|0, r.height|0])(s.getBoundingClientRect()) };
})())`;

const REPORT = `JSON.stringify((()=>{
  const L = window.__flick ? window.__flick.log : [];
  const s = document.querySelector('.ContentItem-actions.Sticky');
  return { scrolls: window.__flick ? window.__flick.scrolls : -1,
           n: L.length,
           first: L.slice(0, 60),
           last: L.slice(-20),
           now: s ? s.getAttribute('style') : null,
           rect: s ? (r => [r.top|0, r.height|0])(s.getBoundingClientRect()) : null };
})())`;

(async () => {
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, process.argv[2] || 'answer');
    if (!tab) { console.log('NO matching tab'); return; }
    await api.send('Target.activateTarget', { targetId: tab.targetId });
    await cdp.sleep(500);
    const sid = await cdp.attach(api, tab.targetId);
    await cdp.waitReady(api, sid);
    console.log('URL:', tab.url.slice(0, 90));
    const inst = await cdp.evalJson(api, INSTALL, sid);
    console.log('install:', JSON.stringify(inst));
    // 模拟用户滚动：向上滑一点（scrollY 减小）再往回，来回几次 —— 用户描述「稍微往上或往下滑动一点点」
    for (const dy of [-120, 60, -60, 60, -60]) {
      await cdp.evalJson(api, `JSON.stringify({y: scrollY})`, sid);
      await cdp.evalJs(api, `scrollBy(0, ${dy})`, sid);
      await cdp.sleep(350);
    }
    await cdp.sleep(600);
    const rep = await cdp.evalJson(api, REPORT, sid);
    console.log('scroll events:', rep.scrolls, ' mutations:', rep.n);
    console.log('now inline:', rep.now);
    console.log('now rect:', JSON.stringify(rep.rect));
    console.log('--- first 60 mutations ---');
    rep.first.forEach((m, i) => console.log(i, JSON.stringify(m)));
    console.log('--- last 20 ---');
    rep.last.forEach((m, i) => console.log('L' + i, JSON.stringify(m)));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
