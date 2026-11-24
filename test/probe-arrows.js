// probe-arrows.js — 统计页面上所有 ArrowLeft 图标及其所属头部文本（验证线程箭头选择器唯一性）
'use strict';
const C = require('./cdp-local');

const EXPR = `(() => {
  const out = [];
  document.querySelectorAll('svg').forEach(svg => {
    const cls = (svg.className.baseVal !== undefined ? svg.className.baseVal : svg.className) || '';
    if (!/ArrowLeft/i.test(cls)) return;
    const r = svg.getBoundingClientRect();
    const p2 = svg.parentElement && svg.parentElement.parentElement;
    out.push({ cls: cls.slice(0, 40), w: Math.round(r.width), h: Math.round(r.height),
      top: Math.round(r.top), parent2: p2 ? (p2.textContent||'').replace(/[\\u200b]/g,'').trim().slice(0, 20) : '',
      parent2cls: p2 ? ((p2.className||'')+'').slice(0, 30) : '' });
  });
  const box = document.querySelector('.Modal-content');
  const sc = document.querySelector('.css-1e7fksk');
  return { arrows: out, modal: !!box, scrollerTop: sc ? Math.round(sc.scrollTop) : null,
    state: history.state,
    kids: box ? [...box.children].map((v,i)=>({i, display:getComputedStyle(v).display, head:(v.textContent||'').replace(/[\\u200b]/g,'').slice(0,10)})) : null };
})()`;

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, 'question/');
  const sid = await C.attach(api, tab.targetId || tab.id);
  console.log(JSON.stringify(await C.evalJson(api, EXPR, sid), null, 2));
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
