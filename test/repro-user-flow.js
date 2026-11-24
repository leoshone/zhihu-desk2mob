// repro-user-flow.js — 在用户当前页面上复现完整操作流：
// 开内联评论 → 找「查看全部 11 条回复」→ 点击进线程 → 手势返回 → 观察结果
'use strict';
const cdp = require('./cdp');

(async () => {
  const api = await cdp.browserApi();
  try {
    const ts = (await cdp.getTargets(api)).filter(t => t.type === 'page' && t.url.includes('2108463757307240853'));
    const sid = await cdp.attach(api, ts[0].targetId);
    await cdp.sleep(600);

    // ① 展开内联评论
    const c = await cdp.evalJson(api, `JSON.stringify((() => {
      const b = [...document.querySelectorAll('button')].find(b2 => {
        const t = (b2.textContent || '').replace(/[\u200b]/g, '').trim();
        if (!/^\d+ 条评论$/.test(t)) return false;
        const r = b2.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (b) { b.scrollIntoView({ block: 'center' }); setTimeout(() => b.click(), 500); return (b.textContent || '').replace(/[\u200b]/g, '').trim(); }
      return 'none';
    })())`, sid);
    console.log('① 开评论区:', JSON.stringify(c));
    await cdp.sleep(5000);

    // ② 找「查看全部 11 条回复」按钮（展开后可能要滚加载）
    let btnInfo = null;
    for (let i = 0; i < 4; i++) {
      const f = await cdp.evalJson(api, `JSON.stringify((() => {
        const z = parseFloat(document.documentElement.style.zoom) || 1;
        const btns = [...document.querySelectorAll('button')].filter(b => {
          const t = (b.textContent || '').replace(/[\u200b]/g, '');
          if (!/查看全部 11 条回复/.test(t)) return false;
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        return btns.map(b => { b.scrollIntoView({ block: 'center' }); return (b.textContent || '').replace(/[\u200b]/g, '').trim(); });
      })())`, sid);
      const arr = typeof f === 'string' ? JSON.parse(f) : f;
      if (arr.length) { btnInfo = arr[0]; break; }
      await cdp.evalJs(api, `(() => { const els = document.querySelectorAll('[class*=Comments]'); els.forEach(e => { e.scrollTop = e.scrollHeight; }); scrollBy(0, 800); })()`, sid);
      await cdp.sleep(2000);
    }
    console.log('② 11条回复按钮:', JSON.stringify(btnInfo));
    if (!btnInfo) { console.log('未找到按钮，无法复现'); return; }

    // ③ 点击进线程
    await cdp.evalJs(api, `(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /查看全部 11 条回复/.test((b.textContent || '').replace(/[\u200b]/g, '')) && b.getBoundingClientRect().width > 0);
      if (btn) btn.click();
    })()`, sid);
    await cdp.sleep(4500);

    const probe = `JSON.stringify((() => {
      const box = document.querySelector('.Modal-content');
      return {
        modal: !!box,
        thread: box ? [...box.children].some(v => getComputedStyle(v).display !== 'none' && (v.textContent || '').replace(/[\u200b]/g, '').startsWith('评论回复')) : false,
        listVisible: box ? [...box.children].some(v => getComputedStyle(v).display !== 'none' && /条评论/.test((v.textContent || '').slice(0, 200))) : false,
        state: String(JSON.stringify(history.state)).slice(0, 26),
        hist: history.length
      };
    })())`;
    let s1 = await cdp.evalJson(api, probe, sid);
    if (s1 && typeof s1 === 'string') s1 = JSON.parse(s1);
    console.log('③ 进线程后:', JSON.stringify(s1));

    // ④ 手势返回（history.back）
    await cdp.evalJs(api, 'history.back(); 1', sid);
    await cdp.sleep(2500);
    let s2 = await cdp.evalJson(api, probe, sid);
    if (s2 && typeof s2 === 'string') s2 = JSON.parse(s2);
    console.log('④ 返回后:', JSON.stringify(s2));
    console.log((s2.modal && s2.listVisible && !s2.thread) ? '===== PASS：切回评论列表 ✓' : '===== 用户所见 = ' + (s2.modal ? '弹层态异常' : '弹层被关（回到问答正文）'));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
