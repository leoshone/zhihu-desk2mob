// probe-overlay.js — 列出页面上 fixed/sticky 的元素几何，以及目标元素顶部与它们的重叠
// 用途：查「某块内容被常驻浮条盖住」类问题（如专栏页顶部两层常驻栏）。
// 用法: node probe-overlay.js <tab 子串>
'use strict';
const cdp = require('./cdp');

const S = `JSON.stringify((()=>{
  const zI = parseFloat(document.documentElement.style.zoom) || 1;
  const vv = window.visualViewport;
  const s = vv ? vv.scale : 1;
  const out = [];
  // 只扫 fixed / sticky（这两种才会浮在内容之上），限制数量
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    out.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 70),
               pos: cs.position, top: cs.top, z: cs.zIndex, h: cs.height,
               rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
               txt: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40) });
  }
  // 评论区各层几何
  const cc = document.querySelector('.Comments-container');
  const chain = [];
  if (cc) { let n = cc; while (n && n !== document.body && chain.length < 6) {
    const cs = getComputedStyle(n); const r = n.getBoundingClientRect();
    chain.push({ tag: n.tagName, cls: (n.className || '').toString().slice(0, 60), pos: cs.position,
                 rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
    n = n.parentElement; } }
  return { zoom: +zI.toFixed(5), scale: +s.toFixed(5), inlineZoom: document.documentElement.style.zoom || '',
           scrollY: Math.round(window.scrollY), scrollMaxY: Math.round(document.documentElement.scrollHeight - window.innerHeight),
           fixedOrSticky: out, commentsChain: chain };
})())`;

(async () => {
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, process.argv[2] || '');
    if (!tab) { console.log('NO matching tab'); return; }
    const sid = await cdp.attach(api, tab.targetId);
    const d = await cdp.evalJson(api, S, sid);
    console.log('zoom=' + d.zoom + ' scale=' + d.scale + ' inlineZoom=' + JSON.stringify(d.inlineZoom) +
                ' scrollY=' + d.scrollY + '/' + d.scrollMaxY);
    console.log('--- fixed / sticky (' + d.fixedOrSticky.length + ') ---');
    d.fixedOrSticky.forEach(x => console.log(' ', JSON.stringify(x)));
    console.log('--- 评论区祖先链 ---');
    d.commentsChain.forEach(x => console.log(' ', JSON.stringify(x)));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
