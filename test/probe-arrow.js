// probe-arrow.js — 勘察线程视图返回箭头，并试试点它能否原生回到列表
'use strict';
const C = require('./cdp-local');

const INFO = `(() => {
  const box = document.querySelector('.Modal-content');
  const out = {};
  const visThread = [...box.children].find(v => getComputedStyle(v).display !== 'none'
      && (v.textContent||'').replace(/[\\u200b]/g,'').startsWith('评论回复'));
  if (!visThread) return { err: 'no visible thread' };
  const r = visThread.getBoundingClientRect();
  out.thread = { top: Math.round(r.top), h: Math.round(r.height), cls: visThread.className };
  out.scrollY = Math.round(scrollY);
  const svg = visThread.querySelector('svg.ZDI--ArrowLeftSmall24, svg[class*="ArrowLeft"]');
  if (!svg) return { ...out, err: 'no arrow' };
  let el = svg;
  const chain = [];
  for (let i = 0; i < 6 && el; i++) {
    const cs = getComputedStyle(el);
    const rr = el.getBoundingClientRect();
    chain.push({ tag: el.tagName, cls: ((el.className.baseVal !== undefined ? el.className.baseVal : el.className)||'').toString().slice(0,50),
      role: el.getAttribute('role')||'', aria: el.getAttribute('aria-label')||'',
      cursor: cs.cursor, rect: [Math.round(rr.left), Math.round(rr.top), Math.round(rr.width), Math.round(rr.height)],
      txt: (el.textContent||'').replace(/[\\u200b]/g,'').trim().slice(0,16) });
    el = el.parentElement;
  }
  out.chain = chain;
  // 线程视图头部整体文本
  const header = visThread.firstElementChild;
  out.headerText = header ? (header.textContent||'').replace(/[\\u200b]/g,'').slice(0, 80) : '';
  return out;
})()`;

const CLICK_ARROW = `(() => {
  const box = document.querySelector('.Modal-content');
  const visThread = [...box.children].find(v => getComputedStyle(v).display !== 'none'
      && (v.textContent||'').replace(/[\\u200b]/g,'').startsWith('评论回复'));
  if (!visThread) return 'no visible thread';
  const svg = visThread.querySelector('svg.ZDI--ArrowLeftSmall24, svg[class*="ArrowLeft"]');
  if (!svg) return 'no arrow';
  let el = svg;
  for (let i = 0; i < 6 && el; i++) {
    if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || getComputedStyle(el).cursor === 'pointer') {
      el.click();
      return 'clicked ' + el.tagName + '.' + ((el.className||'').toString().slice(0,30));
    }
    el = el.parentElement;
  }
  svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return 'dispatched on svg';
})()`;

const AFTER = `(() => {
  const box = document.querySelector('.Modal-content');
  return {
    state: history.state, len: history.length, scrollY: Math.round(scrollY),
    kids: [...box.children].map((v,i) => ({ i, cls:(v.className||'').toString().slice(0,20),
      display: getComputedStyle(v).display, h: Math.round(v.getBoundingClientRect().height),
      head: (v.textContent||'').replace(/[\\u200b]/g,'').slice(0,14) })),
  };
})()`;

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, 'question/');
  const sid = await C.attach(api, tab.targetId || tab.id);
  console.log(JSON.stringify(await C.evalJson(api, INFO, sid), null, 2));
  await C.screenshot(api, sid, __dirname + '/shots/thread-view-live.png');
  console.log('CLICK:', await C.evalJson(api, CLICK_ARROW, sid));
  await C.sleep(1200);
  console.log(JSON.stringify(await C.evalJson(api, AFTER, sid), null, 2));
  await C.screenshot(api, sid, __dirname + '/shots/after-arrow.png');
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
