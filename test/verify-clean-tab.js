// verify-clean-tab.js — 全新标签从零复现：问题页 → 打开评论 → 弹层/内联判定 → 回复往返
'use strict';
const cdp = require('./cdp');

(async () => {
  const api = await cdp.browserApi();
  try {
    // 关闭旧测试标签
    const all = (await cdp.getTargets(api)).filter(t => t.type === 'page');
    for (const t of all) {
      if (t.url.includes('2108463757307240853') || t.url.includes('chrome://') || t.url.includes('confirm') || t.url === 'about:blank') {
        try { await api.send('Target.closeTarget', { targetId: t.targetId }); } catch (e) {}
      }
    }
    // 开全新标签
    const t = await api.send('Target.createTarget', { url: 'https://www.zhihu.com/question/2108463757307240853' });
    const sid = await cdp.attach(api, t.targetId);
    await cdp.waitReady(api, sid);
    await cdp.sleep(9000);
    const g = await cdp.evalJson(api, `JSON.stringify({ hist: history.length, state: String(JSON.stringify(history.state)), btns: [...document.querySelectorAll('button')].filter(b => /条评论/.test((b.textContent || '').replace(/[\u200b]/g, ''))).length })`, sid);
    console.log('全新标签:', g);
    // 点第一个可见「条评论」
    const c = await cdp.evalJson(api, `JSON.stringify((() => {
      const btns = [...document.querySelectorAll('button')].filter(b => {
        const t2 = (b.textContent || '').replace(/[\u200b]/g, '');
        if (!/条评论/.test(t2)) return false;
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (btns[0]) { btns[0].click(); return (btns[0].textContent || '').replace(/[\u200b]/g, '').trim().slice(0, 12); }
      return 'none';
    })())`, sid);
    console.log('点评论按钮:', c);
    await cdp.sleep(4500);
    const g2 = await cdp.evalJson(api, `JSON.stringify({ modal: !!document.querySelector('.Modal-content'), inline: !!document.querySelector('.Comments-container'), hist: history.length, state: String(JSON.stringify(history.state)).slice(0, 25) })`, sid);
    console.log('点后形态:', g2);
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
