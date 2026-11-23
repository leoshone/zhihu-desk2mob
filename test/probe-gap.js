// probe-gap.js — 诊断「更多回答上方空白反复出现/消失」：时序采样 holder 高度 vs docH vs 吸底栏位置
// 用法: node probe-gap.js
'use strict';
const cdp = require('./cdp');

(async () => {
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, '/answer/');
    if (!tab) { console.log('NO answer tab'); return; }
    await api.send('Target.activateTarget', { targetId: tab.targetId });
    await cdp.sleep(400);
    const sid = await cdp.attach(api, tab.targetId);
    await cdp.waitReady(api, sid);
    await cdp.evalJs(api, 'window.scrollTo(0, 5800)', sid);
    await cdp.sleep(1200);

    // 装采样器：rAF 每帧记录，外部滚动由 node 驱动
    const INSTALL = `(() => {
      window.__gap = [];
      const rec = () => {
        if (window.__gap.length > 1500) return;
        const h = document.querySelector('.Sticky--holder');
        const bar = document.querySelector('.ContentItem-actions.Sticky');
        window.__gap.push([
          Math.round(performance.now()),
          h ? Math.round(h.getBoundingClientRect().height) : -1,
          h && h.style.height ? Math.round(parseFloat(h.style.height) || 0) : -1,
          h && h.style.maxHeight ? Math.round(parseFloat(h.style.maxHeight) || 0) : -1,
          bar ? Math.round(bar.getBoundingClientRect().top) : -1,
          document.body.scrollHeight,
          Math.round(scrollY)
        ]);
        requestAnimationFrame(rec);
      };
      requestAnimationFrame(rec);
      return 1;
    })()`;
    await cdp.evalJs(api, INSTALL, sid);

    // node 侧驱动小幅滚动（用户手势复现）
    const scrolls = [[400, -80], [1000, 80], [1600, -60], [2200, 60]];
    const timers = scrolls.map(([t, dy]) => setTimeout(() => { cdp.evalJs(api, `scrollBy(0, ${dy})`, sid).catch(() => {}); }, t));
    await cdp.sleep(3200);
    timers.forEach(clearTimeout);

    const rep = await cdp.evalJson(api, `JSON.stringify((()=>{
      const F = window.__gap || [];
      // 找「页面没滚(y 不变)但 docH 变了」的帧 = 空白出现/消失
      const ev = [];
      for (let i = 1; i < F.length; i++) {
        const a = F[i-1], b = F[i];
        if (a[6] === b[6] && a[5] !== b[5]) ev.push({ t: b[0] - F[0][0], y: b[6], docH: [a[5], b[5]], hh: [a[1], b[1]], hs: [a[2], b[2]], hm: [a[3], b[3]], barTop: [a[4], b[4]] });
      }
      // 压缩：只留 docH/hh 变化的首个样本，最多 30 条
      const firsts = [];
      let lastKey = '';
      for (const e of ev) { const k = e.docH.join('/') + '|' + e.hh.join('/'); if (k !== lastKey) { firsts.push(e); lastKey = k; } }
      return { n: F.length, docHEvts: firsts.slice(0, 30),
               tail: F.slice(-3),
               holderNow: (() => { const h = document.querySelector('.Sticky--holder'); return h ? { rectH: Math.round(h.getBoundingClientRect().height), style: h.getAttribute('style') } : null; })() };
    })())`, sid, 15000);
    console.log('frames:', rep.n);
    console.log('--- 页面静止时 docH/holder 突变事件 ---');
    (rep.docHEvts || []).forEach(e => console.log(JSON.stringify(e)));
    console.log('tail:', JSON.stringify(rep.tail));
    console.log('holderNow:', JSON.stringify(rep.holderNow));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
