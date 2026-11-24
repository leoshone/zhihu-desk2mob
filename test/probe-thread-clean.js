// probe-thread-clean.js — 决定性勘察：看清楚「查看全部回复」到底把线程视图放在哪、返回后落在哪
// 用法: node probe-thread-clean.js reload | open | thread | back | dump
'use strict';
const C = require('./cdp-local');

const DUMP = `(() => {
  const modals = [...document.querySelectorAll('.Modal-content')].map(m => {
    const r = m.getBoundingClientRect();
    const card = m.closest('.css-1aq8hf9') || m.parentElement;
    return {
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      vis: m.checkVisibility ? m.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : '?',
      cardOpacity: card ? getComputedStyle(card).opacity : '?',
      kids: [...m.children].map(k => getComputedStyle(k).display).join(','),
    };
  });
  const svgs = [...document.querySelectorAll('svg[class*="ArrowLeft"]')].map(s => {
    const r = s.getBoundingClientRect();
    const head = s.parentElement && s.parentElement.parentElement;
    return {
      vis: r.width > 8, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      head: head ? (head.textContent || '').replace(/[\\u200b]/g, '').trim().slice(0, 10) : '',
      inModal: !!s.closest('.Modal-content'),
    };
  });
  const cards = [...document.querySelectorAll('.Comments-container')].map(c => {
    const r = c.getBoundingClientRect();
    return { vis: getComputedStyle(c).display !== 'none', top: Math.round(r.top), h: Math.round(r.height), inModal: !!c.closest('.Modal-content') };
  });
  return {
    state: history.state, len: history.length, scrollY: Math.round(scrollY),
    v: window.__z2mVersion || '(none)',
    modals, arrows: svgs, inlineComments: cards,
    viewAllVisible: [...document.querySelectorAll('button')].filter(b => /查看全部\\s*[\\d,]*\\s*条回复/.test((b.textContent||'').replace(/[\\u200b]/g,'')) && b.getBoundingClientRect().width > 0).map(b => b.textContent.replace(/[\\u200b]/g,'').trim()),
  };
})()`;

(async () => {
  const act = process.argv[2] || 'dump';
  const api = await C.browserApi();
  const tab = await C.findTab(api, 'question/');
  const sid = await C.attach(api, tab.targetId || tab.id);
  const say = async (tag) => { console.log('---', tag); console.log(JSON.stringify(await C.evalJson(api, DUMP, sid), null, 1)); };

  if (act === 'reload') { await api.send('Page.enable', {}, sid); await api.send('Page.reload', {}, sid); await C.sleep(7000); }
  if (act === 'open') {
    console.log(await C.evalJson(api, `(() => {
      const bs = [...document.querySelectorAll('button')].filter(b => /^\\d+\\s*条评论$/.test((b.textContent||'').replace(/[\\u200b]/g,'').trim()) && b.getBoundingClientRect().width > 0);
      if (!bs.length) return 'no-button';
      bs[0].click(); return 'clicked ' + bs[0].textContent.replace(/[\\u200b]/g,'').trim();
    })()`, sid));
    await C.sleep(3000);
  }
  if (act === 'thread') {
    console.log(await C.evalJson(api, `(() => {
      const b = [...document.querySelectorAll('button')].find(x => /查看全部\\s*[\\d,]*\\s*条回复/.test((x.textContent||'').replace(/[\\u200b]/g,'')) && x.getBoundingClientRect().width > 0);
      if (!b) return 'not-found';
      const t = (b.textContent||'').replace(/[\\u200b]/g,'').trim();
      b.click(); return 'clicked ' + t;
    })()`, sid));
    await C.sleep(3000);
  }
  if (act === 'back') { await C.evalJson(api, 'history.back();1', sid); await C.sleep(2500); }
  await say(act);
  await C.screenshot(api, sid, __dirname + '/shots/clean-' + act + '.png');
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
