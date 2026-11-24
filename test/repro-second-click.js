// repro-second-click.js — 复现「第二次点击查看全部回复点不动」
// 前置：清栈到 z2mComment → 进线程 → 返回 → 再点 → 断言
'use strict';
const cdp = require('./cdp');

(async () => {
  const api = await cdp.browserApi();
  try {
    const ts = (await cdp.getTargets(api)).filter(t => t.type === 'page' && t.url.includes('2108463757307240853'));
    const sid = await cdp.attach(api, ts[0].targetId);
    await cdp.sleep(800);

    const state = async () => {
      const s = await cdp.evalJson(api, `JSON.stringify({
        thread: (() => { const box = document.querySelector('.Modal-content'); if (!box) return false; return [...box.children].some(v => getComputedStyle(v).display !== 'none' && (v.textContent || '').replace(/[\u200b]/g, '').startsWith('评论回复')); })(),
        list: (() => { const box = document.querySelector('.Modal-content'); if (!box) return false; return [...box.children].some(v => getComputedStyle(v).display !== 'none' && /条评论/.test((v.textContent || '').slice(0, 200))); })(),
        modal: !!document.querySelector('.Modal-content'),
        state: String(JSON.stringify(history.state)).slice(0, 22),
        hist: history.length
      })`, sid);
      return typeof s === 'string' ? JSON.parse(s) : s;
    };
    const clickViewAll = async () => {
      const c = await cdp.evalJson(api, `JSON.stringify((() => {
        const btns = [...document.querySelectorAll('button')].filter(b => {
          const t = (b.textContent || '').replace(/[\u200b]/g, '');
          if (!/查看全部 17 条回复/.test(t)) return false;
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        if (btns[0]) { btns[0].click(); return btns[0].textContent.replace(/[\u200b]/g, '').trim().slice(0, 16); }
        return null;
      })())`, sid);
      return typeof c === 'string' ? JSON.parse(c) : c;
    };

    // 当前应已是列表态、栈顶 z2mComment（上一轮数栈后）
    let s0 = await state();
    console.log('S0 初始:', JSON.stringify(s0));

    // 第 1 轮：进线程 → 返回
    const c1 = await clickViewAll();
    console.log('R1 点:', c1);
    await cdp.sleep(4000);
    let s1 = await state();
    console.log('R1 进线程:', JSON.stringify(s1));
    await cdp.evalJs(api, 'history.back(); 1', sid);
    await cdp.sleep(2200);
    let s2 = await state();
    console.log('R1 返回:', JSON.stringify(s2));

    // 第 2 轮（用户报「点不动」的场景）：再点
    const c2 = await clickViewAll();
    console.log('R2 点:', c2);
    await cdp.sleep(4000);
    let s3 = await state();
    console.log('R2 进线程:', JSON.stringify(s3));
    const ok2 = s3.thread === true && s3.state.indexOf('z2mThread') !== -1;
    console.log(ok2 ? 'R2 PASS 可重复进入 ✓' : 'R2 FAIL 复现「点不动」');

    // 若 R2 PASS，继续返回验证
    if (ok2) {
      await cdp.evalJs(api, 'history.back(); 1', sid);
      await cdp.sleep(2200);
      let s4 = await state();
      console.log('R2 返回:', JSON.stringify(s4));
    }
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
