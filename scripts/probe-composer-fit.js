// probe-composer-fit.js — 诊断「发布」按钮右侧超出屏幕 / 被压成竖排：定位过宽或过窄的那一层
// 用法: node probe-composer-fit.js [--tab <URL 子串>]
// 先打开评论弹层并聚焦输入框，再测量 —— 页面级与弹层内的发布框是两套容器，都要能测到。
'use strict';
const cdp = require('./cdp');

const TAB_SUBSTR = process.argv.includes('--tab') ? (process.argv[process.argv.indexOf('--tab') + 1] || '') : '';

const OPEN_MODAL = `JSON.stringify((()=>{
  const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
  const vh = window.innerHeight;
  const c = [...document.querySelectorAll('button')].filter(el => /条评论/.test(norm(el.innerText)))
    .map(el => ({ el, top: el.getBoundingClientRect().top }))
    .filter(x => x.top >= 0 && x.top <= vh)
    .sort((a, b) => Math.abs(a.top - vh / 2) - Math.abs(b.top - vh / 2))[0];
  if (!c) return { err: 'no in-view comment button' };
  const t = norm(c.el.innerText); c.el.click(); return { clicked: t };
})())`;

const FOCUS = `JSON.stringify((()=>{
  const eds = [...document.querySelectorAll('[contenteditable="true"]')];
  if (!eds.length) return { err: 'no editable' };
  const e = eds[eds.length - 1]; e.scrollIntoView({ block: 'center' }); e.focus(); e.click();
  return { focused: document.activeElement === e, inModal: !!e.closest('.Modal-content') };
})())`;

const JS = `JSON.stringify((()=>{
  const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
  const rect = el => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const btn = [...document.querySelectorAll('button')].find(b => norm(b.innerText) === '发布');
  if (!btn) return { err: 'no publish button' };
  const ed = [...document.querySelectorAll('[contenteditable="true"]')].pop();
  const vw = document.body.getBoundingClientRect().width;

  // 从「发布」按钮往上走，找到第一个「宽度足够容纳按钮」的祖先 = 该行的容器；
  // 再往上就是可用列。逐层记录，找出是谁把按钮挤出去。
  const chain = []; let n = btn;
  while (n && n !== document.body && chain.length < 8) {
    const cs = getComputedStyle(n); const b = n.getBoundingClientRect();
    chain.push({ tag: n.tagName, cls: (n.className||'').toString().slice(0,60),
                 rect: rect(n), disp: cs.display, flexDir: cs.flexDirection, flexWrap: cs.flexWrap,
                 flex: cs.flex, minW: cs.minWidth, w: cs.width, overflow: cs.overflowX,
                 scrollW: n.scrollWidth, clientW: n.clientWidth,
                 childCount: n.children.length,
                 children: [...n.children].map(c => { const cc = getComputedStyle(c);
                   return { tag: c.tagName, cls: (c.className||'').toString().slice(0,40), rect: rect(c),
                            flex: cc.flex, minW: cc.minWidth, w: cc.width, txt: norm(c.innerText).slice(0, 16) }; }) });
    n = n.parentElement;
  }
  // 按钮自身
  const bcs = getComputedStyle(btn);
  // 记录按钮矩形与视口的关系
  const br = btn.getBoundingClientRect();
  return {
    viewportW: Math.round(vw),
    editable: ed ? rect(ed) : null,
    publish: { rect: rect(btn), whiteSpace: bcs.whiteSpace, flex: bcs.flex, minW: bcs.minWidth, padding: bcs.padding, fontSize: bcs.fontSize,
               rightOverflowPx: Math.round(br.right - vw) },
    chain,
  };
})())`;

(async () => {
  const api = await cdp.browserApi();
  try {
    const src = await cdp.findTab(api, TAB_SUBSTR) || await cdp.findTab(api);
    const sid = await cdp.attach(api, src.targetId);
    const run = e => cdp.evalJson(api, e, sid);
    await api.send('Page.navigate', { url: src.url }, sid);
    await cdp.waitReady(api, sid, 30);
    await cdp.sleep(3500);
    // 打开评论弹层（弹层内的发布框与页面级发布框是两套容器，都要覆盖）
    console.log('打开弹层 -> ' + JSON.stringify(await run(OPEN_MODAL)));
    await cdp.sleep(2500);
    console.log('聚焦 -> ' + JSON.stringify(await run(FOCUS)));
    await cdp.sleep(2200);
    await run(FOCUS);
    await cdp.sleep(1200);
    const d = await run(JS);
    if (d.err) { console.log(JSON.stringify(d)); return; }
    console.log('视口宽 = ' + d.viewportW + '  输入框 = ' + JSON.stringify(d.editable));
    console.log('发布按钮 = ' + JSON.stringify(d.publish));
    console.log('\n祖先链（由内向外，只到 body）:');
    d.chain.forEach((c, i) => {
      console.log(' ' + i + ' ' + c.tag + '.' + c.cls + ' rect=' + JSON.stringify(c.rect) +
        ' disp=' + c.disp + '/' + c.flexDir + '/' + c.flexWrap + ' flex=' + c.flex + ' minW=' + c.minW +
        ' overflowX=' + c.overflow + ' scrollW=' + c.scrollW + ' clientW=' + c.clientW);
      c.children.forEach((k, j) => console.log('      ' + j + ' ' + k.tag + '.' + k.cls + ' rect=' + JSON.stringify(k.rect) +
        ' flex=' + k.flex + ' minW=' + k.minW + ' w=' + k.w + ' :: ' + k.txt));
    });
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
