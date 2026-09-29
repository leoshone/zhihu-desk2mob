// probe-sticky.js — 找出「吸顶」到底挂在哪个元素上（默认探专栏页文章头，可改选择器）
// 用法: node probe-sticky.js <tab 子串>
'use strict';
const cdp = require('./cdp');

const S = `JSON.stringify((()=>{
  const anchor = document.querySelector('.ColumnPageHeader-content') || document.querySelector('[class*="ColumnPageHeader"]');
  if (!anchor) return { err: 'no ColumnPageHeader' };
  const chain = [];
  let n = anchor;
  while (n && n !== document.documentElement) {
    const cs = getComputedStyle(n); const r = n.getBoundingClientRect();
    chain.push({ tag: n.tagName, cls: (n.className || '').toString(),
                 pos: cs.position, top: cs.top, z: cs.zIndex, sticky: cs.position === 'sticky' || cs.position === 'fixed',
                 rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
    n = n.parentElement;
  }
  // 找出所有 position:sticky 的元素（含文章头所在链）
  const stickies = [...document.querySelectorAll('body *')].filter(e => getComputedStyle(e).position === 'sticky')
    .map(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      return { cls: (e.className || '').toString().slice(0, 60), top: cs.top, z: cs.zIndex,
               rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }; })
    .filter(x => x.rect[1] < 200);                        // 只留贴在顶部的
  return { scrollY: Math.round(window.scrollY), chain, topStickies: stickies };
})())`;

(async () => {
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, process.argv[2] || '');
    if (!tab) { console.log('NO matching tab'); return; }
    await api.send('Target.activateTarget', { targetId: tab.targetId });
    await cdp.sleep(800);
    const sid = await cdp.attach(api, tab.targetId);
    const d = await cdp.evalJson(api, S, sid);
    console.log('scrollY=' + d.scrollY);
    console.log('--- 文章头祖先链（由内向外）---');
    d.chain.forEach((x, i) => console.log(' ' + i + ' ' + JSON.stringify(x)));
    console.log('--- 贴在顶部的 sticky ---');
    d.topStickies.forEach(x => console.log(' ' + JSON.stringify(x)));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
