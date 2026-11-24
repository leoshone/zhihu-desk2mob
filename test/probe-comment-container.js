// probe-comment-container.js — 从「收起评论」按钮向上找评论区真实容器类名
'use strict';
const cdp = require('./cdp');

(async () => {
  const api = await cdp.browserApi();
  try {
    const ts = (await cdp.getTargets(api)).filter(t => t.type === 'page' && t.url.includes('2108463757307240853'));
    const sid = await cdp.attach(api, ts[ts.length - 1].targetId);
    await cdp.sleep(800);
    const EX = `JSON.stringify((() => {
      const collapse = [...document.querySelectorAll('button')].find(b => /收起评论/.test((b.textContent || '').replace(/[\u200b]/g, '')));
      if (!collapse) return { noCollapseBtn: true };
      let n = collapse.parentElement;
      const chain = [];
      for (let i = 0; n && i < 5; i++, n = n.parentElement) {
        const r = n.getBoundingClientRect();
        chain.push({ cls: (n.className || '').toString().slice(0, 44), h: Math.round(r.height) });
      }
      return chain;
    })())`;
    const r = await cdp.evalJson(api, EX, sid);
    const arr = typeof r === 'string' ? JSON.parse(r) : r;
    arr.forEach(x => console.log(JSON.stringify(x)));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
