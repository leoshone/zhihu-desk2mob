// probe-50-modal.js — adb tap 后确认弹层状态
'use strict';
const cdp = require('./cdp');

(async () => {
  const api = await cdp.browserApi();
  try {
    const ts = (await cdp.getTargets(api)).filter(t => t.type === 'page' && t.url.includes('2108463757307240853'));
    const sid = await cdp.attach(api, ts[0].targetId);
    await cdp.sleep(600);
    const EX = `JSON.stringify((() => {
      const z = parseFloat(document.documentElement.style.zoom) || 1;
      const b = [...document.querySelectorAll('button')].find(b2 => /^50 条评论$/.test((b2.textContent || '').replace(/[\u200b]/g, '').trim()));
      const box = document.querySelector('.Modal-content');
      return {
        btnVy: b ? Math.round(b.getBoundingClientRect().top / z) : null,
        modal: !!box,
        head: box ? (box.textContent || '').replace(/[\u200b]/g, '').slice(0, 10) : null,
        viewAll: box ? [...box.querySelectorAll('button')].filter(bb => /查看全部.*回复/.test((bb.textContent || '').replace(/[\u200b]/g, ''))).length : 0,
        state: String(JSON.stringify(history.state)).slice(0, 25)
      };
    })())`;
    const r = await cdp.evalJson(api, EX, sid);
    const s = typeof r === 'string' ? JSON.parse(r) : r;
    console.log(JSON.stringify(s, null, 1));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
