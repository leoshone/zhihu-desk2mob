// probe-live-thread.js — 现场勘察：当前页面弹层结构、线程/列表视图判据、历史栈
'use strict';
const C = require('./cdp-local');

const EXPR = `(() => {
  const out = {};
  const box = document.querySelector('.Modal-content');
  out.url = location.href;
  out.scrollY = Math.round(scrollY);
  out.state = history.state;
  out.len = history.length;
  if (!box) return out;
  const bcs = getComputedStyle(box);
  out.box = { display: bcs.display, pos: bcs.position, overflow: bcs.overflow, h: Math.round(box.getBoundingClientRect().height), cls: box.className };
  out.kids = [...box.children].map((v, i) => {
    const cs = getComputedStyle(v);
    const r = v.getBoundingClientRect();
    return {
      i, cls: (v.className || '').toString().slice(0, 40), display: cs.display, pos: cs.position,
      vis: cs.visibility, op: cs.opacity, z: cs.zIndex,
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      isList: /条评论/.test((v.textContent || '').slice(0, 200)),
      isThread: (v.textContent || '').replace(/[\\u200b]/g, '').startsWith('评论回复'),
      btns: [...v.querySelectorAll('button')].slice(0, 8).map(b => ({
        t: (b.textContent || '').replace(/[\\u200b]/g, '').trim().slice(0, 12),
        aria: b.getAttribute('aria-label') || '',
        cls: (b.className || '').toString().slice(0, 40),
        disp: getComputedStyle(b).display,
      })),
    };
  });
  const el = document.elementFromPoint(innerWidth / 2, 120);
  out.hit = el ? { cls: (el.className || '').toString().slice(0, 60), tag: el.tagName, txt: (el.textContent || '').replace(/[\\u200b]/g, '').slice(0, 30) } : null;
  return out;
})()`;

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, 'question/');
  const sid = await C.attach(api, tab.targetId || tab.id);
  const r = await C.evalJson(api, EXPR, sid);
  console.log(JSON.stringify(r, null, 2));
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
