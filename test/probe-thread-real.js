// probe-thread-real.js — 线程视图到底画在哪个节点上（隐藏副本 vs 真正显示的那个）
'use strict';
const C = require('./cdp-local');

const clean = `const clean = s => (s || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').trim();`;

const DIAG = `(() => { ${clean}
  const heads = [];
  document.querySelectorAll('div,span,section').forEach(el => {
    if (el.children.length > 3) return;
    if (clean(el.textContent) !== '评论回复') return;
    const r = el.getBoundingClientRect();
    if (r.width < 5) return;
    const cs = getComputedStyle(el);
    // 逐级检查祖先的 opacity/visibility/display
    let hiddenBy = '';
    let p = el;
    while (p && p !== document.documentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none') { hiddenBy = 'display:none@' + ((p.className || '') + '').slice(0, 18); break; }
      if (s.visibility === 'hidden') { hiddenBy = 'visibility@' + ((p.className || '') + '').slice(0, 18); break; }
      if (parseFloat(s.opacity) < 0.05) { hiddenBy = 'opacity@' + ((p.className || '') + '').slice(0, 18); break; }
      p = p.parentElement;
    }
    const cx = Math.round(r.left + 20), cy = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    heads.push({
      cls: ((el.className || '') + '').slice(0, 30),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      inModal: !!el.closest('.Modal-content'),
      inComments: !!el.closest('.Comments-container'),
      hiddenBy: hiddenBy || 'visible',
      hit: hit ? hit.tagName + '|' + ((hit.className.baseVal !== undefined ? hit.className.baseVal : hit.className) || '').toString().slice(0, 22) : 'none',
      hitSame: !!(hit && (el === hit || el.contains(hit))),
    });
  });
  const modals = [...document.querySelectorAll('.Modal-content')].map(m => {
    const card = m.closest('.css-1aq8hf9') || m.parentElement;
    const cr = card.getBoundingClientRect();
    return { op: getComputedStyle(card).opacity, top: Math.round(cr.top), h: Math.round(cr.height), head: clean(m.textContent).slice(0, 10) };
  });
  return { state: history.state, scrollY: Math.round(scrollY), innerH: innerHeight, heads, modals };
})()`;

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, process.env.TAB_FILTER || '/answer/');
  const sid = await C.attach(api, tab.targetId || tab.id);
  console.log(JSON.stringify(await C.evalJson(api, DIAG, sid), null, 1));
  if (!process.env.NOSHOT) await C.screenshot(api, sid, __dirname + '/shots/thread-real.png');
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
