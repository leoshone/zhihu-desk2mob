// probe-arrow2.js — 滚到线程视图，验证点知乎自带返回箭头能否原生回到列表
'use strict';
const C = require('./cdp-local');

const SETUP = `(() => {
  const box = document.querySelector('.Modal-content');
  const visThread = [...box.children].find(v => getComputedStyle(v).display !== 'none'
      && (v.textContent||'').replace(/[\\u200b]/g,'').startsWith('评论回复'));
  if (!visThread) return 'no thread';
  const sc = document.querySelector('.css-1e7fksk') || visThread.closest('div[style]');
  if (!sc) return 'no scroller';
  sc.scrollTop = visThread.offsetTop;
  return 'scrollTop=' + sc.scrollTop + ' offsetTop=' + visThread.offsetTop;
})()`;

const CLICK = `(() => {
  const box = document.querySelector('.Modal-content');
  const visThread = [...box.children].find(v => getComputedStyle(v).display !== 'none'
      && (v.textContent||'').replace(/[\\u200b]/g,'').startsWith('评论回复'));
  if (!visThread) return 'no thread';
  const hit = visThread.querySelector('.css-1jm49l2') || visThread.querySelector('svg[class*="ArrowLeft"]').parentElement.parentElement;
  if (!hit) return 'no hit';
  const r = hit.getBoundingClientRect();
  const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2, view: window };
  hit.dispatchEvent(new PointerEvent('pointerdown', opt));
  hit.dispatchEvent(new MouseEvent('mousedown', opt));
  hit.dispatchEvent(new PointerEvent('pointerup', opt));
  hit.dispatchEvent(new MouseEvent('mouseup', opt));
  hit.dispatchEvent(new MouseEvent('click', opt));
  return 'dispatched at ' + Math.round(r.left + r.width/2) + ',' + Math.round(r.top + r.height/2);
})()`;

const AFTER = `(() => {
  const box = document.querySelector('.Modal-content');
  const sc = document.querySelector('.css-1e7fksk');
  return { state: history.state, len: history.length, scrollerTop: sc ? Math.round(sc.scrollTop) : null,
    kids: [...box.children].map((v,i)=>({ i, cls:(v.className||'').toString().slice(0,20), display:getComputedStyle(v).display,
      top: Math.round(v.getBoundingClientRect().top), h: Math.round(v.getBoundingClientRect().height),
      head:(v.textContent||'').replace(/[\\u200b]/g,'').slice(0,12) })) };
})()`;

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, 'question/');
  const sid = await C.attach(api, tab.targetId || tab.id);
  console.log('SETUP:', await C.evalJson(api, SETUP, sid));
  await C.sleep(500);
  console.log(JSON.stringify(await C.evalJson(api, AFTER, sid), null, 2));
  await C.screenshot(api, sid, __dirname + '/shots/thread-visible.png');
  console.log('CLICK:', await C.evalJson(api, CLICK, sid));
  await C.sleep(1000);
  console.log(JSON.stringify(await C.evalJson(api, AFTER, sid), null, 2));
  await C.screenshot(api, sid, __dirname + '/shots/after-arrow2.png');
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
