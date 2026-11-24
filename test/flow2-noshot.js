// flow2.js — 从「弹层列表态」起跑：进线程 → 返回 → 再进 → 返回 → 再返回关弹层
'use strict';
const C = require('./cdp-local');

const ST = `(() => {
  const box = document.querySelector('.Modal-content');
  const arrows = [...document.querySelectorAll('svg[class*="ArrowLeft"]')].filter(s => s.getBoundingClientRect().width > 8).length;
  const vb = [...document.querySelectorAll('button')].filter(b => /查看全部\\s*[\\d,]*\\s*条回复/.test((b.textContent||'').replace(/[\\u200b]/g,'')) && b.getBoundingClientRect().width > 0);
  return { state: history.state, len: history.length, modal: !!box, arrows, viewAll: vb.length ? vb[0].textContent.replace(/[\\u200b]/g,'').trim() : null };
})()`;

const THREAD = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => /查看全部\\s*[\\d,]*\\s*条回复/.test((x.textContent||'').replace(/[\\u200b]/g,'')) && x.getBoundingClientRect().width > 0);
  if (!b) return 'not-found';
  const t = (b.textContent||'').replace(/[\\u200b]/g,'').trim();
  b.click(); return 'clicked ' + t;
})()`;

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, 'question/2108463757307240853');
  const sid = await C.attach(api, tab.targetId || tab.id);
  const S = async (tag, shot) => {
    const r = await C.evalJson(api, ST, sid);
    console.log(tag.padEnd(16), JSON.stringify(r));
    // no shot
    return r;
  };
  const back = async (ms = 2200) => { await C.evalJson(api, 'history.back();1', sid); await C.sleep(ms); };

  await S('起点(列表)', 'f0.png');
  console.log('进线程:', await C.evalJson(api, THREAD, sid));
  await C.sleep(3000); await S('线程1', 'f1-thread.png');
  await back(); await S('返回→列表', 'f2-back.png');
  console.log('再进线程:', await C.evalJson(api, THREAD, sid));
  await C.sleep(3000); await S('线程2', 'f3-thread2.png');
  await back(); await S('返回→列表', 'f4-back.png');
  await back(); await S('返回→关弹层', 'f5-back.png');
  await C.sleep(2000); await S('再等2s', 'f6.png');
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
