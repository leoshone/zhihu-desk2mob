// probe-composer2.js — 找出「同时发布到想法」选项的出现条件
// 依次尝试：直接查 / 滚动到底 / 聚焦评论输入框，每步报告该选项是否存在并 dump 页脚结构。
'use strict';
const cdp = require('./cdp');

const Q = '同时发布到想法';

const CHECK = `JSON.stringify((()=>{
  const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
  const strip = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, '');
  const Q = ${JSON.stringify(Q)};
  let leaf = null;
  try {
    const snap = document.evaluate("//*[contains(., '" + Q + "')]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < snap.snapshotLength; i++) { const el = snap.snapshotItem(i); if (strip(el.textContent) === Q) leaf = el; }
  } catch (e) { return { err: e.message }; }
  const rect = el => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  // 评论输入框（contenteditable）状态
  const eds = [...document.querySelectorAll('[contenteditable="true"]')].map(e => ({ rect: rect(e), focused: document.activeElement === e }));
  const btns = [...document.querySelectorAll('button')].map(b => norm(b.innerText)).filter(t => t && t.length <= 6);
  return { exists: !!leaf, leafRect: leaf ? rect(leaf) : null, scrollY: Math.round(window.scrollY),
           editables: eds, smallButtons: [...new Set(btns)].slice(0, 14), liyan: document.body.innerText.includes('理性发言') };
})())`;

(async () => {
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, 'zhuanlan') || await cdp.findTab(api);
    const sid = await cdp.attach(api, tab.targetId);
    const run = e => cdp.evalJson(api, e, sid);

    console.log('1) 当前状态:', JSON.stringify(await run(CHECK)));

    console.log('\n2) 滚动到底部…');
    await run(`JSON.stringify((()=>{ window.scrollTo(0, document.body.scrollHeight); return 'bottom'; })())`);
    await cdp.sleep(3000);
    console.log('   ->', JSON.stringify(await run(CHECK)));

    console.log('\n3) 聚焦评论输入框（点击 contenteditable）…');
    console.log('   ->', JSON.stringify(await run(`JSON.stringify((()=>{
      const eds = [...document.querySelectorAll('[contenteditable="true"]')];
      if (!eds.length) return { err: 'no editable' };
      const e = eds[eds.length - 1];
      e.scrollIntoView({ block: 'center' });
      e.focus();
      e.click();
      return { focused: document.activeElement === e, count: eds.length };
    })())`)));
    await cdp.sleep(3000);
    console.log('   ->', JSON.stringify(await run(CHECK)));

    console.log('\n4) 若出现，dump 页脚结构…');
    const d = await run(`JSON.stringify((()=>{
      const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
      const strip = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, '');
      const Q = ${JSON.stringify(Q)};
      const snap = document.evaluate("//*[contains(., '" + Q + "')]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      let leaf = null;
      for (let i = 0; i < snap.snapshotLength; i++) { const el = snap.snapshotItem(i); if (strip(el.textContent) === Q) leaf = el; }
      if (!leaf) return { err: 'still absent' };
      const desc = el => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
        return { tag: el.tagName, cls: (el.className||'').toString().slice(0,60), disp: cs.display, minW: cs.minWidth,
                 rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
                 txt: norm(el.innerText).slice(0, 34) }; };
      const out = [];
      let n = leaf; while (n && n !== document.body && out.length < 6) { out.push(desc(n)); n = n.parentElement; }
      return { chain: out, leafHTML: (leaf.outerHTML||'').slice(0, 200), wrapHTML: (leaf.parentElement.outerHTML||'').slice(0,260) };
    })())`);
    console.log(JSON.stringify(d, null, 1));
    await api.send('Page.bringToFront', {}, sid);
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
