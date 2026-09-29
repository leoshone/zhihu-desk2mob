// inspect.js — 用 elementsFromPoint 判定「屏幕上真实的顶层叠加层」，并给出稳定识别特征
// 用法: node inspect.js [--tab <URL 子串>]   只观察
//       node inspect.js reload              先重载页面再观察
//       node inspect.js open                点开站点上的入口后再观察（入口规则见 OPEN_ENTRY）
//   --tab 传任意 URL 子串，用于在多标签页里挑目标；不传则取第一个页面标签。
//
// 输出：视口与缩放、若干采样点的命中栈与祖先链、页面上各 Modal 类元素的「活性」
// （自身或祖先是否 display:none）与关闭按钮位置 —— 用来回答
// 「这个浮层到底开没开」「它是不是在屏幕内」「关闭入口在不在屏幕内」。
'use strict';
const cdp = require('./cdp');

// `open` 子命令要点的入口 —— 换站点时改这里（默认规则对应知乎的「N 条评论」按钮）
const OPEN_ENTRY = { textRe: /^\d+ ?条评论$/, clsRe: /(^|\s)ContentItem-action(\s|$)/ };
const TAB_SUBSTR = process.argv.includes('--tab') ? (process.argv[process.argv.indexOf('--tab') + 1] || '') : '';

const INSPECT_JS = `JSON.stringify((()=>{
  const zoomF = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const visW = Math.round((window.innerWidth||0)/zoomF), visH = Math.round((window.innerHeight||0)/zoomF);
  const pts = [[Math.round(visW/2), Math.round(visH/2)], [8,8], [Math.round(visW/2), visH-8]];
  const desc = el => {
    if (!el || el === document.documentElement) return null;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    return { tag: el.tagName, cls: (el.className||'').toString().slice(0,120),
             pos: cs.position, z: cs.zIndex, disp: cs.display, vis: cs.visibility, op: cs.opacity,
             overflowY: cs.overflowY,
             rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } };
  };
  const stacks = pts.map(([x,y]) => {
    const els = document.elementsFromPoint(x, y).slice(0, 6);
    return { pt: [x,y], top: els.slice(0,3).map(desc), chainOfTop: (()=>{
      const chain = []; let n = els[0];
      while (n && n.tagName && chain.length < 8) { chain.push(desc(n)); n = n.parentElement; }
      return chain;
    })() };
  });
  // 页面上所有 .Modal-content / [class*=Modal] 的「活性」（祖先是否可见）
  const aliveCheck = [...document.querySelectorAll('[class*="Modal"]')].map(el => {
    let n = el, hidden = null, fixedAnc = null;
    while (n && n.tagName) {
      const cs = getComputedStyle(n);
      if (!hidden && (cs.display === 'none' || cs.visibility === 'hidden')) hidden = { tag: n.tagName, cls: (n.className||'').toString().slice(0,60), disp: cs.display, vis: cs.visibility };
      if (!fixedAnc && cs.position === 'fixed' && (parseInt(cs.zIndex,10)||0) >= 50) { const r = n.getBoundingClientRect(); fixedAnc = { cls: (n.className||'').toString().slice(0,60), z: cs.zIndex, rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, overflowY: cs.overflowY }; }
      n = n.parentElement;
    }
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, cls: (el.className||'').toString().slice(0,80), ownRect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
             hiddenAncestor: hidden, fixedAncestor: fixedAnc };
  });
  return { zoomF, visW, visH, histLen: history.length, histState: history.state,
           stacks, aliveCheck,
           closeBtns: [...document.querySelectorAll('[aria-label="关闭"], [aria-label*="close" i]')].map(b => { const r = b.getBoundingClientRect(); return { tag: b.tagName, cls: (b.className||'').toString().slice(0,60), rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, inDom: true }; }),
         };
})())`;

(async () => {
  const cmd = process.argv[2] || '';
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, TAB_SUBSTR) || await cdp.findTab(api);
    const sid = await cdp.attach(api, tab.targetId);
    if (cmd === 'reload') {
      await api.send('Page.navigate', { url: tab.url }, sid);
      await cdp.waitReady(api, sid, 30);
      await cdp.sleep(3000);
      console.log('reloaded');
    }
    if (cmd === 'open') {
      const clk = await cdp.evalJson(api, `JSON.stringify((()=>{
        const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g,' ').trim();
        const els = [...document.querySelectorAll('button')].filter(el => /(^|\\s)ContentItem-action(\\s|$)/.test((el.className||'').toString()) && /^\\d+ ?条评论$/.test(norm(el.innerText)));
        if (!els.length) return { err: 'none' };
        const n = norm(els[0].innerText); els[0].scrollIntoView({block:'center'}); els[0].click(); return { ok: n };
      })())`, sid);
      console.log('OPEN ->', JSON.stringify(clk));
      await cdp.sleep(3500);
    }
    const d = await cdp.evalJson(api, INSPECT_JS, sid);
    console.log(JSON.stringify(d, null, 2));
    await cdp.shot(api, sid, 'D:/AiSpaces/Work/2026-09-29-10-18-12/shots/inspect-' + (cmd || 'plain') + '.png');
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
