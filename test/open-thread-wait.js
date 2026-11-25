// open-thread-wait.js — 耐心打开线程：轮询「查看全部」按钮出现后点击，再等线程稳定
'use strict';
const C = require('./cdp-local');

const clean = `const clean = s => (s || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').trim();`;

const FIND = `(() => { ${clean}
  const all = [...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0);
  const va = all.find(b => clean(b.textContent).startsWith('查看全部'));
  const cm = all.find(b => /^\\d+\\s*条评论$/.test(clean(b.textContent)));
  return { viewAll: va ? clean(va.textContent) : null, comment: cm ? clean(cm.textContent) : null };
})()`;

const CLICK = (which) => `(() => { ${clean}
  const all = [...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0);
  const b = ${which === 'va'
    ? `all.find(x => clean(x.textContent).startsWith('查看全部'))`
    : `all.find(x => /^\\d+\\s*条评论$/.test(clean(x.textContent)))`};
  if (!b) return 'not-found';
  const t = clean(b.textContent); b.click(); return 'clicked ' + t;
})()`;

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, process.env.TAB_FILTER || '/answer/');
  const sid = await C.attach(api, tab.targetId || tab.id);
  // 1. 若还没有「查看全部」，先点评论按钮展开
  let s = await C.evalJson(api, FIND, sid);
  console.log('初始:', JSON.stringify(s));
  if (!s.viewAll && s.comment) {
    console.log(await C.evalJson(api, CLICK('cm'), sid));
  }
  // 2. 轮询等「查看全部」
  for (let i = 0; i < 15; i++) {
    await C.sleep(2000);
    s = await C.evalJson(api, FIND, sid);
    if (s.viewAll) break;
  }
  console.log('等待后:', JSON.stringify(s));
  if (!s.viewAll) { console.log('放弃：没有查看全部按钮'); process.exit(1); }
  console.log(await C.evalJson(api, CLICK('va'), sid));
  await C.sleep(4000);
  console.log('state:', JSON.stringify(await C.evalJson(api, '({state:history.state,len:history.length})', sid)));
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
