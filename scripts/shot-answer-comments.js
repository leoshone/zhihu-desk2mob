// shot-answer-comments.js — 打开回答内评论弹层并抓真机屏幕，用于人工核验
'use strict';
const { execSync } = require('child_process');
const cdp = require('./cdp');

const norm = `const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();`;

const SCROLL_BTN = `JSON.stringify((()=>{ ${norm}
  const els = [...document.querySelectorAll('button')].filter(el =>
    /(^|\\s)ContentItem-action(\\s|$)/.test((el.className||'').toString()) && /条评论/.test(norm(el.innerText)));
  if (!els.length) return { err: 'none' };
  els[0].scrollIntoView({ block: 'center' });
  return { scrolledTo: norm(els[0].innerText), total: els.length };
})())`;

const CLICK_NEAREST_ANSWER = `JSON.stringify((()=>{ ${norm}
  const vh = window.innerHeight;
  const c = [...document.querySelectorAll('button')].filter(el =>
    /(^|\\s)ContentItem-action(\\s|$)/.test((el.className||'').toString()) && /条评论/.test(norm(el.innerText)))
    .map(el => ({ el, top: el.getBoundingClientRect().top }))
    .filter(x => x.top >= 0 && x.top <= vh)
    .sort((a, b) => Math.abs(a.top - vh / 2) - Math.abs(b.top - vh / 2))[0];
  if (!c) return { err: 'no in-view answer comment button' };
  const t = norm(c.el.innerText); c.el.click(); return { clicked: t };
})())`;

const STATE = `JSON.stringify((()=>{
  const mc = document.querySelector('.Modal-content');
  if (!mc) return { open: false, hist: history.state };
  let L = mc;
  while (L && L !== document.body) { const cs = getComputedStyle(L); if (cs.position === 'fixed' && (parseInt(cs.zIndex,10)||0) >= 50) break; L = L.parentElement; }
  const r = e => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  return { open: true, justify: getComputedStyle(L).justifyContent, layer: r(L), card: r(mc.parentElement), hist: history.state,
           headerText: (mc.innerText||'').replace(/[\\s\\u200b]+/g,' ').trim().slice(0, 46) };
})())`;

(async () => {
  const api = await cdp.browserApi();
  let tid = null;
  try {
    const src = await cdp.findTab(api, '/answer/') || await cdp.findTab(api);
    if (!src) throw new Error('no zhihu tab');
    tid = (await api.send('Target.createTarget', { url: src.url })).targetId;
    await cdp.sleep(7000);
    const sid = await cdp.attach(api, tid);
    await cdp.waitReady(api, sid, 30);
    await cdp.sleep(4000);

    console.log('scroll ->', JSON.stringify(await cdp.evalJson(api, SCROLL_BTN, sid)));
    await cdp.sleep(1800);
    console.log('click  ->', JSON.stringify(await cdp.evalJson(api, CLICK_NEAREST_ANSWER, sid)));
    await cdp.sleep(4000);
    console.log('state  ->', JSON.stringify(await cdp.evalJson(api, STATE, sid)));
    await api.send('Page.bringToFront', {}, sid);
    execSync('adb exec-out screencap -p > "D:/AiSpaces/Work/2026-09-29-10-18-12/shots/12-final-answer-comments.png"', { shell: 'bash' });
    console.log('screenshot saved');
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
