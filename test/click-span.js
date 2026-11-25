// click-span.js — 对线程返回箭头派发指针序列（点 svg 的父级 SPAN），前后各看一眼状态
'use strict';
const C = require('./cdp-local');

const S = `(() => {
  const ms = [...document.querySelectorAll('.Modal-content')];
  const card = ms[0] ? (ms[0].closest('.css-1aq8hf9') || ms[0].parentElement) : null;
  const clean = s => (s || '').replace(/[\\u200b]/g, '').trim();
  return {
    state: history.state, len: history.length,
    modals: ms.length, cardOpacity: card ? getComputedStyle(card).opacity : '-',
    arrows: [...document.querySelectorAll('svg[class*="ArrowLeft"]')].filter(s => s.getBoundingClientRect().width > 8).length,
    inlineCmt: [...document.querySelectorAll('.Comments-container')].filter(c => getComputedStyle(c).display !== 'none').length,
    viewAll: [...document.querySelectorAll('button')].filter(b => clean(b.textContent).startsWith('查看全部') && b.getBoundingClientRect().width > 0).length,
    scrollY: Math.round(scrollY),
  };
})()`;

const CLICK_SPAN = `(() => {
  const s = [...document.querySelectorAll('svg[class*="ArrowLeft"]')].find(x => x.getBoundingClientRect().width > 8);
  if (!s) return 'no-arrow';
  const sp = s.parentElement;
  const r = sp.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, view: window, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
  sp.dispatchEvent(new PointerEvent('pointerdown', o));
  sp.dispatchEvent(new MouseEvent('mousedown', o));
  sp.dispatchEvent(new PointerEvent('pointerup', o));
  sp.dispatchEvent(new MouseEvent('mouseup', o));
  sp.dispatchEvent(new MouseEvent('click', o));
  return 'dispatched on ' + sp.tagName + '.' + ((sp.className || '') + '');
})()`;

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, process.env.TAB_FILTER || '/answer/');
  const sid = await C.attach(api, tab.targetId || tab.id);
  console.log('前  ', JSON.stringify(await C.evalJson(api, S, sid)));
  console.log('点SPAN:', await C.evalJson(api, CLICK_SPAN, sid));
  await C.sleep(2000);
  console.log('点后  ', JSON.stringify(await C.evalJson(api, S, sid)));
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
