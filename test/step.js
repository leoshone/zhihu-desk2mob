// step.js — 单步操作+状态快照：node step.js <inject|reload|open|thread|back|state|shot>
'use strict';
const fs = require('fs');
const C = require('./cdp-local');
const SRC = fs.readFileSync(__dirname + '/../zhihu-desk2mob.user.js', 'utf8');

const STATE = `(() => {
  const box = document.querySelector('.Modal-content');
  const sc = document.querySelector('.css-1e7fksk');
  const arrows = [...document.querySelectorAll('svg[class*="ArrowLeft"]')].filter(s => s.getBoundingClientRect().width > 8).length;
  const vb = [...document.querySelectorAll('button')].filter(b => /查看全部\\s*[\\d,]*\\s*条回复/.test((b.textContent||'').replace(/[\\u200b]/g,'')) && b.getBoundingClientRect().width > 0);
  return {
    v: window.__z2mVersion || '(none)', inst: window.__z2mInst || 0,
    state: history.state, len: history.length,
    modal: !!box, scrollerTop: sc ? Math.round(sc.scrollTop) : null,
    threadArrows: arrows,
    viewAll: vb.length ? vb[0].textContent.replace(/[\\u200b]/g,'').trim() : null,
    kids: box ? [...box.children].map(x => ({ d: getComputedStyle(x).display, pin: x.style.display || '',
      t: (x.textContent||'').replace(/[\\u200b]/g,'').slice(0, 8) })) : null,
  };
})()`;

(async () => {
  const act = process.argv[2] || 'state';
  const api = await C.browserApi();
  const tab = await C.findTab(api, 'question/2108463757307240853');
  const sid = await C.attach(api, tab.targetId || tab.id);
  if (act === 'reload') { await api.send('Page.enable', {}, sid); await api.send('Page.reload', {}, sid); await C.sleep(6500); }
  if (act === 'inject') { await C.evalJson(api, SRC, sid); await C.sleep(800); }
  if (act === 'open') {
    console.log(await C.evalJson(api, `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').replace(/[\\u200b]/g,'').trim()==='138 条评论' && x.getBoundingClientRect().width>0); if(!b) return 'not-found'; b.click(); return 'clicked'; })()`, sid));
    await C.sleep(3000);
  }
  if (act === 'thread') {
    console.log(await C.evalJson(api, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/查看全部\\s*[\\d,]*\\s*条回复/.test((x.textContent||'').replace(/[\\u200b]/g,'')) && x.getBoundingClientRect().width>0); if(!b) return 'not-found'; const t=(b.textContent||'').replace(/[\\u200b]/g,'').trim(); b.click(); return 'clicked '+t; })()`, sid));
    await C.sleep(3000);
  }
  if (act === 'back') { await C.evalJson(api, 'history.back();1', sid); await C.sleep(2000); }
  const r = await C.evalJson(api, STATE, sid);
  console.log(JSON.stringify(r, null, 1));
  if (act !== 'state') await C.screenshot(api, sid, __dirname + '/shots/step-' + act + '.png');
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
