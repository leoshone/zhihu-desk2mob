// verify-user-gesture.js — 复现用户手势返回场景：点「查看全部回复」→ history.back() 应切回列表
// 在用户实际操作的标签（弹层开着）上执行
'use strict';
const cdp = require('./cdp');

(async () => {
  const api = await cdp.browserApi();
  try {
    const ts = (await cdp.getTargets(api)).filter(t => t.type === 'page' && t.url.includes('2108463757307240853'));
    if (!ts.length) { console.log('NO tab'); return; }
    const tab = ts[ts.length - 1];
    const sid = await cdp.attach(api, tab.targetId);
    await cdp.sleep(800);

    const probe = `JSON.stringify((() => {
      const box = document.querySelector('.Modal-content');
      if (!box) return { modal: false };
      return {
        hist: history.length,
        state: String(JSON.stringify(history.state)).slice(0, 24),
        visThreads: [...box.children].filter(v => getComputedStyle(v).display !== 'none' && (v.textContent || '').replace(/[\u200b]/g, '').startsWith('评论回复')).length,
        listVisible: [...box.children].some(v => getComputedStyle(v).display !== 'none' && /条评论/.test((v.textContent || '').slice(0, 200)))
      };
    })())`;

    // 弹层内滚动加载回复按钮
    for (let i = 0; i < 3; i++) {
      await cdp.evalJs(api, `(() => { const mc = document.querySelector('.Modal-content'); if (mc) mc.scrollTop = mc.scrollHeight; })()`, sid);
      await cdp.sleep(1200);
    }
    let s0 = await cdp.evalJson(api, probe, sid);
    if (s0 && typeof s0 === 'string') s0 = JSON.parse(s0);
    console.log('T0 现状:', JSON.stringify(s0));

    // 找回复按钮（弹层或内联区）
    const find = await cdp.evalJson(api, `JSON.stringify((() => {
      const scopes = [document.querySelector('.Modal-content'), document.querySelector('.Comments-container'), document].filter(Boolean);
      for (const scope of scopes) {
        const btn = [...scope.querySelectorAll('button')].find(b => /查看全部.*回复/.test((b.textContent || '').replace(/[\u200b]/g, '')));
        if (btn) { const r = btn.getBoundingClientRect(); return { found: true, where: scope === document ? 'document' : scope.className.slice(0, 20), text: (btn.textContent || '').replace(/[\u200b]/g, '').trim().slice(0, 18), vis: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(',') }; }
      }
      return { found: false };
    })())`, sid);
    const f = typeof find === 'string' ? JSON.parse(find) : find;
    console.log('回复按钮:', JSON.stringify(f));
    if (!f.found) return;

    // 点击（真实 DOM click）
    await cdp.evalJs(api, `(() => {
      const scopes = [document.querySelector('.Modal-content'), document.querySelector('.Comments-container'), document].filter(Boolean);
      for (const scope of scopes) {
        const btn = [...scope.querySelectorAll('button')].find(b => /查看全部.*回复/.test((b.textContent || '').replace(/[\u200b]/g, '')));
        if (btn) { btn.click(); return 1; }
      }
    })()`, sid);
    await cdp.sleep(4000);
    let s1 = await cdp.evalJson(api, probe, sid);
    if (s1 && typeof s1 === 'string') s1 = JSON.parse(s1);
    console.log('T1 点回复后:', JSON.stringify(s1));

    // 手势返回 = history.back()
    await cdp.evalJs(api, 'history.back(); 1', sid);
    await cdp.sleep(2200);
    let s2 = await cdp.evalJson(api, probe, sid);
    if (s2 && typeof s2 === 'string') s2 = JSON.parse(s2);
    console.log('T2 返回后:', JSON.stringify(s2));
    const pass = s2.modal === true && s2.listVisible === true && s2.visThreads === 0;
    console.log(pass ? '===== PASS：切回列表 ✓' : '===== FAIL：' + (s2.modal ? '切回异常' : '弹层被关'));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
