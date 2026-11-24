// reopen-modal-124.js — 重开 124 条评论弹层并完成「进线程→返回→再进→返回」两轮验证
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

    // 打开 124 条评论弹层（scrollIntoView + click）
    await cdp.evalJs(api, `(() => {
      const b = [...document.querySelectorAll('button')].find(b2 => /^124 条评论$/.test((b2.textContent || '').replace(/[\u200b]/g, '').trim()));
      if (b) { b.scrollIntoView({ block: 'center' }); setTimeout(() => b.click(), 500); }
    })()`, sid);
    await cdp.sleep(6000);
    let s0 = await state();
    console.log('S0 弹层:', JSON.stringify(s0));
    if (!s0.modal) { console.log('弹层未打开，中止'); return; }

    // 找「查看全部 17 条回复」（弹层内滚动加载）
    let found = false;
    for (let i = 0; i < 5 && !found; i++) {
      const f = await cdp.evalJson(api, `JSON.stringify((() => {
        const mc = document.querySelector('.Modal-content');
        return [...mc.querySelectorAll('button')].filter(b => /查看全部 17 条回复/.test((b.textContent || '').replace(/[\u200b]/g, '')) && b.getBoundingClientRect().width > 0).length;
      })())`, sid);
      found = typeof f === 'number' ? f > 0 : !!f;
      if (!found) {
        await cdp.evalJs(api, `(() => { const mc = document.querySelector('.Modal-content'); if (mc) mc.scrollTop = mc.scrollHeight; })()`, sid);
        await cdp.sleep(2000);
      }
    }
    console.log('17条回复按钮:', found ? '已出现' : '未找到');

    // 两轮「进线程 → 返回」
    for (let round = 1; round <= 2; round++) {
      await cdp.evalJs(api, `(() => {
        const mc = document.querySelector('.Modal-content');
        const btn = [...mc.querySelectorAll('button')].find(b => /查看全部 17 条回复/.test((b.textContent || '').replace(/[\u200b]/g, '')));
        if (btn) btn.click();
      })()`, sid);
      await cdp.sleep(4000);
      let s1 = await state();
      console.log('R' + round + ' 进线程:', JSON.stringify(s1));
      await cdp.evalJs(api, 'history.back(); 1', sid);
      await cdp.sleep(2200);
      let s2 = await state();
      console.log('R' + round + ' 返回:', JSON.stringify(s2));
      const r1ok = s1.thread && s1.state.indexOf('z2mThread') !== -1;
      const r2ok = s2.modal && s2.list && !s2.thread;
      if (!r1ok) console.log('R' + round + ' 进线程 FAIL');
      if (!r2ok) console.log('R' + round + ' 返回 FAIL');
      // 若弹层被关（返回后无弹层），重开弹层继续第二轮
      if (!s2.modal && round === 1) {
        console.log('弹层被关（异常）——中止');
        return;
      }
    }
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
