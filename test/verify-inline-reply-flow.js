// verify-inline-reply-flow.js — 内联评论区完整重演：开内联 → 点「查看全部回复」→ 弹层 → 返回
// 断言：返回后弹层关，但内联评论区仍在（用户「回到评论页」）
'use strict';
const cdp = require('./cdp');

(async () => {
  const api = await cdp.browserApi();
  try {
    const ts = (await cdp.getTargets(api)).filter(t => t.type === 'page' && t.url.includes('2108463757307240853'));
    const sid = await cdp.attach(api, ts[ts.length - 1].targetId);
    await cdp.sleep(800);
    // 打开内联评论区
    const st0 = await cdp.evalJson(api, `JSON.stringify({ inline: !!document.querySelector('.Comments-container') })`, sid);
    const s0 = typeof st0 === 'string' ? JSON.parse(st0) : st0;
    if (!s0.inline) {
      await cdp.evalJs(api, `(() => {
        const btns = [...document.querySelectorAll('button')].filter(b => {
          const t = (b.textContent || '').replace(/[\u200b]/g, '');
          if (!/条评论/.test(t)) return false;
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        if (btns[0]) btns[0].click();
      })()`, sid);
      await cdp.sleep(4500);
    }
    // 找回复按钮
    const f = await cdp.evalJson(api, `JSON.stringify((() => {
      const btns = [...document.querySelectorAll('button')].filter(b => {
        const t = (b.textContent || '').replace(/[\u200b]/g, '');
        if (!/查看全部.*回复/.test(t)) return false;
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      return btns.map(b => (b.textContent || '').replace(/[\u200b]/g, '').trim().slice(0, 18));
    })())`, sid);
    const btns = typeof f === 'string' ? JSON.parse(f) : f;
    console.log('回复按钮:', JSON.stringify(btns));
    if (!btns.length) { console.log('无回复按钮，无法复现'); return; }
    // 点击
    await cdp.evalJs(api, `(() => {
      const btns2 = [...document.querySelectorAll('button')].filter(b => {
        const t = (b.textContent || '').replace(/[\u200b]/g, '');
        if (!/查看全部.*回复/.test(t)) return false;
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (btns2[0]) btns2[0].click();
    })()`, sid);
    await cdp.sleep(4000);
    const st1 = await cdp.evalJson(api, `JSON.stringify({ modal: !!document.querySelector('.Modal-content'), thread: (() => { const box = document.querySelector('.Modal-content'); if (!box) return false; return [...box.children].some(v => getComputedStyle(v).display !== 'none' && (v.textContent || '').replace(/[\u200b]/g, '').startsWith('评论回复')); })(), hist: history.length, state: String(JSON.stringify(history.state)).slice(0, 22) })`, sid);
    const s1 = typeof st1 === 'string' ? JSON.parse(st1) : st1;
    console.log('弹层(线程):', JSON.stringify(s1));
    // 手势返回
    await cdp.evalJs(api, 'history.back(); 1', sid);
    await cdp.sleep(2200);
    const st2 = await cdp.evalJson(api, `JSON.stringify({ modal: !!document.querySelector('.Modal-content'), inlineStill: !!document.querySelector('.Comments-container'), inlineH: (() => { const c = document.querySelector('.Comments-container'); return c ? Math.round(c.getBoundingClientRect().height) : 0; })(), state: String(JSON.stringify(history.state)).slice(0, 22) })`, sid);
    const s2 = typeof st2 === 'string' ? JSON.parse(st2) : st2;
    console.log('返回后:', JSON.stringify(s2));
    const pass = !s2.modal && s2.inlineStill && s2.inlineH > 100;
    console.log(pass ? '===== PASS：弹层关、内联评论列表保留（回到评论页）✓' : '===== 观察：' + JSON.stringify(s2));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
