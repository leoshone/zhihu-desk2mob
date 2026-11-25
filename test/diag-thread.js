// diag-thread.js — 一次性：开评论 → 进线程 → 全面取证（弹层几何/可见性/hit-test/滚动）
'use strict';
const C = require('./cdp-local');

const clean = `const clean = s => (s || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').trim();`;
const CLICK_PREFIX = (p) => `(() => { ${clean}
  const b = [...document.querySelectorAll('button')].find(x => clean(x.textContent).startsWith(${JSON.stringify(p)}) && x.getBoundingClientRect().width > 0);
  if (!b) return 'not-found';
  const t = clean(b.textContent); b.click(); return 'clicked ' + t;
})()`;

const DIAG = `(() => { ${clean}
  const arrow = [...document.querySelectorAll('svg[class*="ArrowLeft"]')].find(x => x.getBoundingClientRect().width > 8);
  const ar = arrow ? arrow.getBoundingClientRect() : null;
  const hit = ar ? document.elementFromPoint(Math.round(ar.left + ar.width / 2), Math.round(ar.top + ar.height / 2)) : null;
  const modals = [...document.querySelectorAll('.Modal-content')].map((m, i) => {
    const card = m.closest('.css-1aq8hf9') || m.parentElement;
    const mr = m.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    return {
      i, contentRect: [Math.round(mr.left), Math.round(mr.top), Math.round(mr.width), Math.round(mr.height)],
      cardRect: [Math.round(cr.left), Math.round(cr.top), Math.round(cr.width), Math.round(cr.height)],
      opacity: cs.opacity, display: cs.display, transform: cs.transform,
      hasArrow: !!(arrow && m.contains(arrow)), kids: m.children.length,
      kidsDisp: [...m.children].map(k => getComputedStyle(k).display).join(','),
      head: clean(m.textContent).slice(0, 12),
    };
  });
  const cmts = [...document.querySelectorAll('.Comments-container')].map(c => {
    const r = c.getBoundingClientRect();
    return { disp: getComputedStyle(c).display, top: Math.round(r.top), h: Math.round(r.height), inModal: !!c.closest('.Modal-content') };
  });
  return {
    state: history.state, len: history.length, scrollY: Math.round(scrollY), innerH: innerHeight,
    arrowRect: ar ? [Math.round(ar.left), Math.round(ar.top), Math.round(ar.width)] : null,
    hit: hit ? hit.tagName + '|' + ((hit.className.baseVal !== undefined ? hit.className.baseVal : hit.className) || '').toString().slice(0, 26) : 'none',
    hitIsArrowKin: !!(arrow && hit && (arrow === hit || arrow.contains(hit) || hit.contains(arrow))),
    modals, comments: cmts,
  };
})()`;

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, process.env.TAB_FILTER || '/answer/');
  const sid = await C.attach(api, tab.targetId || tab.id);
  console.log('阶段0:', JSON.stringify(await C.evalJson(api, DIAG, sid)));
  console.log('点评论:', await C.evalJson(api, CLICK_PREFIX('1065'), sid));
  await C.sleep(8000);
  console.log('点查看全部:', await C.evalJson(api, CLICK_PREFIX('查看全部'), sid));
  await C.sleep(4000);
  console.log('阶段1:', JSON.stringify(await C.evalJson(api, DIAG, sid), null, 1));
  if (!process.env.NOSHOT) await C.screenshot(api, sid, __dirname + '/shots/diag-thread.png');
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
