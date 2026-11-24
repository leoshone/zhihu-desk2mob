// e2e-thread-back.js — 真机端到端：注入 v1.9.16 → 开弹层 → 进线程 → 返回 → 再进 → 再返回
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
    state: history.state, len: history.length,
    modal: !!box, scrollerTop: sc ? Math.round(sc.scrollTop) : null,
    visibleThreadArrows: arrows,
    viewAll: vb.length ? vb[0].textContent.replace(/[\\u200b]/g,'').trim() : null,
    listVisible: box ? [...box.children].some(v => /条评论/.test((v.textContent||'').slice(0,200)) && getComputedStyle(v).display !== 'none') : null,
    pins: box ? [...box.children].map(v => v.style.display || '').filter(Boolean) : null,
    docY: Math.round(scrollY),
  };
})()`;

const CLICK_EXACT = (txt) => `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').replace(/[\\u200b]/g,'').trim() === '${txt}' && x.getBoundingClientRect().width > 0);
  if (!b) return 'not-found';
  b.click();
  return 'clicked ' + '${txt}';
})()`;

const CLICK_RE = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => /查看全部\\s*[\\d,]*\\s*条回复/.test((x.textContent||'').replace(/[\\u200b]/g,'')) && x.getBoundingClientRect().width > 0);
  if (!b) return 'not-found';
  const t = (b.textContent||'').replace(/[\\u200b]/g,'').trim();
  b.click();
  return 'clicked ' + t;
})()`;

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, 'question/');
  const sid = await C.attach(api, tab.targetId || tab.id);
  const S = async (tag, shot) => {
    const r = await C.evalJson(api, STATE, sid);
    console.log(tag.padEnd(20), JSON.stringify(r));
    if (shot) await C.screenshot(api, sid, __dirname + '/shots/' + shot);
    return r;
  };
  const back = async (ms = 2000) => { await C.evalJson(api, 'history.back(); 1', sid); await C.sleep(ms); };

  await api.send('Page.enable', {}, sid);
  await api.send('Page.reload', {}, sid);
  await C.sleep(6500);
  if (!process.env.SKIP_INJECT) await C.evalJson(api, SRC, sid);
  await C.sleep(1200);
  await S('页面就绪', 'e1-injected.png');

  console.log('开弹层:', await C.evalJson(api, CLICK_EXACT('138 条评论'), sid));
  await C.sleep(3000);
  await S('弹层已开', 'e2-modal.png');

  console.log('进线程:', await C.evalJson(api, CLICK_RE, sid));
  await C.sleep(3000);
  await S('线程视图', 'e3-thread.png');

  await back();
  await S('返回1→列表?', 'e4-back1.png');

  console.log('再进线程:', await C.evalJson(api, CLICK_RE, sid));
  await C.sleep(3000);
  await S('第二轮线程', 'e5-thread2.png');

  await back();
  await S('返回2→列表?', 'e6-back2.png');
  await back();
  await S('返回3→关弹层?', 'e7-back3.png');

  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
