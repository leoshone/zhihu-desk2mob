// probe-modal-life.js — rAF 采样「内联区点『查看全部回复』」后弹层的生命周期
'use strict';
const cdp = require('./cdp');

(async () => {
  const api = await cdp.browserApi();
  try {
    const ts = (await cdp.getTargets(api)).filter(t => t.type === 'page' && t.url.includes('2108463757307240853'));
    const sid = await cdp.attach(api, ts[ts.length - 1].targetId);
    await cdp.sleep(800);
    const INSTALL = `(() => {
      window.__life = [];
      const rec = () => {
        const m = !!document.querySelector('.Modal-content');
        const last = window.__life[window.__life.length - 1];
        if (!last || last.m !== m) window.__life.push({ t: Math.round(performance.now()), m });
        if (window.__life.length < 500) requestAnimationFrame(rec);
      };
      requestAnimationFrame(rec);
      const inline = document.querySelector('.Comments-container');
      const btn = inline && [...inline.querySelectorAll('button')].find(b => /查看全部.*回复/.test((b.textContent || '').replace(/[\u200b]/g, '')));
      if (btn) { btn.click(); return 'clicked'; }
      return 'no-btn';
    })()`;
    const c = await cdp.evalJson(api, INSTALL, sid);
    console.log('点击:', JSON.stringify(c));
    await cdp.sleep(7000);
    const life = await cdp.evalJson(api, 'JSON.stringify(window.__life)', sid);
    console.log('弹层生命周期(m=true区间):', JSON.stringify(life));
    // 最终状态
    const fin = await cdp.evalJson(api, `JSON.stringify({ modal: !!document.querySelector('.Modal-content'), hist: history.length, state: String(JSON.stringify(history.state)).slice(0, 24) })`, sid);
    console.log('最终状态:', JSON.stringify(fin));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
