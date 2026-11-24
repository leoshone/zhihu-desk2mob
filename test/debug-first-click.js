// debug-first-click.js — 慢动作：手动恢复列表态 → 清残留 → 点按钮 → 观察节点身份/视图/栈
'use strict';
const cdp = require('./cdp');

(async () => {
  const api = await cdp.browserApi();
  try {
    const ts = (await cdp.getTargets(api)).filter(t => t.type === 'page' && t.url.includes('2108463757307240853'));
    const sid = await cdp.attach(api, ts[0].targetId);
    await cdp.sleep(600);
    // 手动恢复列表态
    await cdp.evalJs(api, `(() => {
      const b = document.querySelector('.Modal-content');
      if (!b) return 'no-modal';
      const list = [...b.children].find(v => /条评论/.test((v.textContent || '').slice(0, 200)));
      if (list) list.style.display = 'flex';
      [...b.children].forEach(v => { if ((v.textContent || '').replace(/[\u200b]/g, '').startsWith('评论回复')) v.style.display = 'none'; });
      return 'restored';
    })()`, sid);
    // 清残留 T
    await cdp.evalJs(api, 'history.back(); 1', sid);
    await cdp.sleep(1200);
    const s0 = await cdp.evalJson(api, `JSON.stringify({ state: String(JSON.stringify(history.state)).slice(0, 22) })`, sid);
    const o0 = typeof s0 === 'string' ? JSON.parse(s0) : s0;
    console.log('清栈后 state:', JSON.stringify(o0));
    // 打标记并点击
    const c = await cdp.evalJson(api, `JSON.stringify((() => {
      const b = [...document.querySelectorAll('button')].find(b2 => /查看全部 17 条回复/.test((b2.textContent || '').replace(/[\u200b]/g, '')) && b2.getBoundingClientRect().width > 0);
      if (!b) return 'nf';
      b.__z2mMark = 'first-click';
      b.click();
      return 'clicked';
    })())`, sid);
    console.log('点击:', JSON.stringify(c));
    await cdp.sleep(4000);
    const s1 = await cdp.evalJson(api, `JSON.stringify((() => {
      const btn = [...document.querySelectorAll('button')].find(b2 => /查看全部 17 条回复/.test((b2.textContent || '').replace(/[\u200b]/g, '')) && b2.getBoundingClientRect().width > 0);
      const box = document.querySelector('.Modal-content');
      return {
        btnMark: btn ? (btn.__z2mMark || 'REPLACED(节点被React替换)') : 'btn-gone',
        thread: box ? [...box.children].some(v => getComputedStyle(v).display !== 'none' && (v.textContent || '').replace(/[\u200b]/g, '').startsWith('评论回复')) : false,
        state: String(JSON.stringify(history.state)).slice(0, 22)
      };
    })())`, sid);
    const o1 = typeof s1 === 'string' ? JSON.parse(s1) : s1;
    console.log('点击后:', JSON.stringify(o1, null, 1));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
