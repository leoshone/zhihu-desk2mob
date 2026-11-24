// probe-threadview-live.js — 真实点击「查看全部 N 条回复」后，勘察线程视图结构与可见性
'use strict';
const C = require('./cdp-local');

const CLICK = `(() => {
  const bs = [...document.querySelectorAll('button')].filter(b => /查看全部\\s*[\\d,]*\\s*条回复/.test((b.textContent||'').replace(/[\\u200b]/g,'')));
  const b = bs.find(x => x.getBoundingClientRect().width > 0);
  if (!b) return 'no-button';
  b.click();
  return 'clicked:' + (b.textContent||'').replace(/[\\u200b]/g,'').trim();
})()`;

const DUMP = `(() => {
  const box = document.querySelector('.Modal-content');
  const out = { state: history.state, len: history.length };
  out.kids = [...box.children].map((v,i) => {
    const cs = getComputedStyle(v);
    const r = v.getBoundingClientRect();
    const t = (v.textContent||'').replace(/[\\u200b]/g,'');
    return { i, cls:(v.className||'').toString().slice(0,30), display: cs.display, rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)],
      head: t.slice(0,24), isList:/条评论/.test(t.slice(0,200)), isThread:t.startsWith('评论回复'),
      inlineDisplay: v.style.display || '' };
  });
  const vis = out.kids.filter(k => k.display !== 'none');
  const vi = vis.find(k => k.isThread) ? vis.find(k => k.isThread).i : (vis[0] ? vis[0].i : -1);
  if (vi >= 0) {
    const v = box.children[vi];
    // 头部区域（前 120px）的可交互元素
    out.headerEls = [...v.querySelectorAll('button,a,[role="button"],svg')].slice(0, 14).map(e => {
      const r = e.getBoundingClientRect();
      if (r.top - v.getBoundingClientRect().top > 200) return null;
      return { tag: e.tagName, cls:(e.className.baseVal !== undefined ? e.className.baseVal : e.className||'').toString().slice(0,40),
        aria: e.getAttribute('aria-label')||'', t:(e.textContent||'').replace(/[\\u200b]/g,'').trim().slice(0,14),
        rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)] };
    }).filter(Boolean);
    out.headerHTML = v.firstElementChild ? v.firstElementChild.outerHTML.slice(0, 900) : '';
  }
  return out;
})()`;

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, 'question/');
  const sid = await C.attach(api, tab.targetId || tab.id);
  console.log('CLICK:', await C.evalJson(api, CLICK, sid));
  await C.sleep(2000);
  const r = await C.evalJson(api, DUMP, sid);
  console.log(JSON.stringify(r, null, 2));
  await C.screenshot(api, sid, __dirname + '/shots/thread-live.png');
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
