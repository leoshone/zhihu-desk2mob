// probe-rightrail.js — 定位「页面右边缘那条残留的竖排文字」到底出自哪个容器
// 用法: node probe-rightrail.js [--tab <URL 子串>]
//
// 背景：首页右边缘会残留 帮助中心/举报中心/关于知乎 等链接，被挤成逐字竖排。
// 本探针按文案定位到最内层元素，再把祖先链与「靠右边缘的可见块」都 dump 出来，
// 用来判断该隐藏哪一层、以及为什么现有的 hideSideRails 没盖住它。
'use strict';
const cdp = require('./cdp');

const TAB_SUBSTR = process.argv.includes('--tab') ? (process.argv[process.argv.indexOf('--tab') + 1] || '') : '';

const JS = `JSON.stringify((()=>{
  const KW = ['帮助中心', '举报中心', '关于知乎', '用户协议', '隐私政策', '联系我们', '加入知乎'];
  const rect = el => { const b = el.getBoundingClientRect();
    return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const desc = el => { const cs = getComputedStyle(el);
    return { tag: el.tagName, cls: (el.className || '').toString().slice(0, 46),
             pos: cs.position, z: cs.zIndex, disp: cs.display, w: cs.width, h: cs.height,
             minW: cs.minWidth, flex: cs.flex, flexDir: cs.flexDirection, align: cs.alignItems,
             overflowX: cs.overflowX, whiteSpace: cs.whiteSpace, lineH: cs.lineHeight,
             rect: rect(el), txt: (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 40) }; };

  const bodyW = Math.round(document.body.getBoundingClientRect().width);
  const zoomF = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;

  // ① 每个关键词：找到「文本恰好含它、且没有更小的元素也含它」的最内层
  const hits = {};
  for (const k of KW) {
    const all = [...document.querySelectorAll('a, span, li, p, div')].filter(el => (el.textContent || '').includes(k));
    // 取最深的（其子元素里不再有含该关键词的）
    const deepest = all.filter(el => ![...el.children].some(c => (c.textContent || '').includes(k)));
    if (!deepest.length) { hits[k] = null; continue; }
    const el = deepest[deepest.length - 1];
    const chain = []; let n = el;
    while (n && n !== document.body && chain.length < 6) { chain.push(desc(n)); n = n.parentElement; }
    hits[k] = { self: desc(el), chain };
  }

  // ② 所有「靠右边缘、可见」的元素（右边界超出内容列，或在列右侧）
  const nearRight = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.left >= bodyW - 4) {
      nearRight.push({ ...desc(el), inMain: !!el.closest('main') });
      if (nearRight.length > 24) break;
    }
  }

  // ③ 从「帮助中心」所在节点往上，逐层列出该层的**兄弟** —— 看清「内容列 vs 侧栏」的关系
  const up = [];
  const kw = '帮助中心';
  const cands = [...document.querySelectorAll('a, span, li, p, div')].filter(el => (el.textContent || '').includes(kw));
  const deepest = cands.filter(el => ![...el.children].some(c => (c.textContent || '').includes(kw)));
  let node = deepest[deepest.length - 1];
  while (node && node.tagName !== 'FOOTER' && node !== document.body) node = node.parentElement;
  for (let lv = 0; node && node !== document.body && lv < 5; lv++) {
    const p = node.parentElement;
    up.push({
      level: lv, selfCls: (node.className || '').toString().slice(0, 36), selfRect: rect(node),
      parentCls: p && p !== document.body ? (p.className || '').toString().slice(0, 36) : null,
      parentRect: p && p !== document.body ? rect(p) : null,
      parentDisp: p && p !== document.body ? getComputedStyle(p).display : null,
      parentFlexDir: p && p !== document.body ? getComputedStyle(p).flexDirection : null,
      siblings: p && p !== document.body ? [...p.children].map(c => ({ tag: c.tagName,
        cls: (c.className || '').toString().slice(0, 32), disp: getComputedStyle(c).display,
        rect: rect(c), txt: (c.innerText || '').replace(/\\s+/g, ' ').slice(0, 26) })) : [],
    });
    node = p;
  }

  return { url: location.href, bodyW, zoomF, viewportW: Math.round(window.innerWidth / zoomF),
           hits, nearRight, up };
})())`;

(async () => {
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, TAB_SUBSTR) || await cdp.findTab(api);
    const sid = await cdp.attach(api, tab.targetId);
    console.log('页面: ' + tab.url.slice(0, 60));
    const d = await cdp.evalJson(api, JS, sid);
    console.log('\nbody 宽=' + d.bodyW + '  视口宽(除 zoom)=' + d.viewportW + '  zoom=' + d.zoomF);

    console.log('\n===== ① 按关键词定位 =====');
    for (const k of Object.keys(d.hits)) {
      const h = d.hits[k];
      if (!h) { console.log('  [' + k + '] 页面上没有'); continue; }
      console.log('  [' + k + '] 最内层: ' + JSON.stringify(h.self));
      h.chain.forEach((c, i) => console.log('      ↑' + i + ' ' +
        c.tag + '.' + c.cls + ' pos=' + c.pos + ' z=' + c.z + ' disp=' + c.disp +
        ' rect=' + JSON.stringify(c.rect) + ' minW=' + c.minW + ' flex=' + c.flex +
        ' dir=' + c.flexDir + ' ovX=' + c.overflowX + ' ws=' + c.whiteSpace));
    }

    console.log('\n===== ② 贴在右边缘的可见元素（前若干）=====');
    d.nearRight.forEach(e => console.log('  ' + e.tag + '.' + e.cls + ' pos=' + e.pos +
      ' rect=' + JSON.stringify(e.rect) + ' inMain=' + e.inMain + ' :: ' + e.txt));

    console.log('\n===== ③ 从 <footer> 往上逐层看兄弟（内容列 vs 侧栏）=====');
    d.up.forEach(u => {
      console.log('  层' + u.level + ' self.' + u.selfCls + ' rect=' + JSON.stringify(u.selfRect) +
        '   父.' + u.parentCls + ' rect=' + JSON.stringify(u.parentRect) +
        ' disp=' + u.parentDisp + ' dir=' + u.parentFlexDir);
      u.siblings.forEach(s => console.log('        ' + s.tag + '.' + s.cls + ' disp=' + s.disp +
        ' rect=' + JSON.stringify(s.rect) + ' :: ' + s.txt));
    });
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
