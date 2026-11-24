// probe-modal-scroll.js — 找出弹层滚动容器，并尝试把它滚到线程视图
'use strict';
const C = require('./cdp-local');

const INFO = `(() => {
  const box = document.querySelector('.Modal-content');
  const visThread = [...box.children].find(v => getComputedStyle(v).display !== 'none'
      && (v.textContent||'').replace(/[\\u200b]/g,'').startsWith('评论回复'));
  let el = visThread;
  const chain = [];
  while (el && el !== document.body) {
    const cs = getComputedStyle(el);
    chain.push({ tag: el.tagName, cls: ((el.className||'')+'').slice(0,40), of: cs.overflowY,
      sh: el.scrollHeight, ch: el.clientHeight, st: Math.round(el.scrollTop), pos: cs.position });
    el = el.parentElement;
  }
  return { chain, docScroll: Math.round(scrollY), docH: document.documentElement.scrollHeight };
})()`;

const SCROLL = `(() => {
  const box = document.querySelector('.Modal-content');
  const visThread = [...box.children].find(v => getComputedStyle(v).display !== 'none'
      && (v.textContent||'').replace(/[\\u200b]/g,'').startsWith('评论回复'));
  // 找最近的可滚动祖先
  let el = visThread.parentElement;
  while (el && el !== document.body) {
    if (el.scrollHeight > el.clientHeight + 5) { el.scrollTop = visThread.offsetTop; return 'scrolled ' + ((el.className||'')+'') + ' to ' + el.scrollTop; }
    el = el.parentElement;
  }
  return 'no scrollable ancestor';
})()`;

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, 'question/');
  const sid = await C.attach(api, tab.targetId || tab.id);
  console.log(JSON.stringify(await C.evalJson(api, INFO, sid), null, 2));
  console.log('SCROLL:', await C.evalJson(api, SCROLL, sid));
  await C.sleep(600);
  await C.screenshot(api, sid, __dirname + '/shots/thread-scrolled.png');
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
