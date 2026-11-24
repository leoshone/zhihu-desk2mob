// probe-reply-back.js — 复现「弹层内点『查看全部 N 条回复』后返回键不能回到刚才的评论页」
// 记录点回复按钮前后的 history 栈、URL、导航事件，模拟返回键观察行为。
'use strict';
const cdp = require('./cdp');

(async () => {
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, '/answer/');
    if (!tab) { console.log('NO answer tab'); return; }
    const sid = await cdp.attach(api, tab.targetId);
    await api.send('Page.navigate', { url: 'https://www.zhihu.com/question/2107410046787262060/answer/2108121528701282170' }, sid);
    await cdp.waitReady(api, sid);
    await cdp.sleep(8000);
    // 挂监听
    await cdp.evalJs(api, `(() => {
      window.__nav = [];
      window.addEventListener('popstate', () => window.__nav.push({ ev: 'popstate', url: location.pathname.slice(-20), state: JSON.stringify(history.state) }));
      const op = history.pushState.bind(history);
      history.pushState = function(s, t2, u) { window.__nav.push({ ev: 'push', url: (u||'').toString().slice(-20), state: JSON.stringify(s).slice(0, 40) }); return op(s, t2, u); };
      return 1;
    })()`, sid);
    // 打开评论弹层
    await cdp.evalJs(api, `(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => {
        const t = (b.textContent || '').replace(/[\u200b]/g, '');
        if (!/条评论/.test(t)) return false;
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (btns[0]) btns[0].click();
      return btns.length;
    })()`, sid);
    await cdp.sleep(4500);
    const s1 = await cdp.evalJson(api, `JSON.stringify({ modal: !!document.querySelector('.Modal-content'), hist: history.length, state: JSON.stringify(history.state) })`, sid);
    console.log('① 弹层打开后:', s1);
    // 点「查看全部 N 条回复」
    const has = await cdp.evalJson(api, `JSON.stringify((() => {
      const mc = document.querySelector('.Modal-content');
      if (!mc) return { has: false };
      const btn = [...mc.querySelectorAll('button')].find(b => /查看全部.*回复/.test((b.textContent || '').replace(/[\u200b]/g, '')));
      return { has: !!btn };
    })())`, sid);
    console.log('② 回复按钮存在:', JSON.stringify(has));
    if (!has.has) return;
    await cdp.evalJs(api, `(() => {
      const mc = document.querySelector('.Modal-content');
      const btn = [...mc.querySelectorAll('button')].find(b => /查看全部.*回复/.test((b.textContent || '').replace(/[\u200b]/g, '')));
      if (btn) btn.click();
      return 1;
    })()`, sid);
    await cdp.sleep(4500);
    const s2 = await cdp.evalJson(api, `JSON.stringify(() => 0) || JSON.stringify({ hist: history.length, state: JSON.stringify(history.state), modal: !!document.querySelector('.Modal-content'), url: location.pathname.slice(-25), nav: (window.__nav || []).slice(-6) })`, sid, 10000).catch(() => null);
    const s2b = await cdp.evalJson(api, `JSON.stringify({ hist: history.length, state: JSON.stringify(history.state), modal: !!document.querySelector('.Modal-content'), url: location.pathname.slice(-25), nav: (window.__nav || []).slice(-6) })`, sid, 10000);
    console.log('③ 点回复展开后:', JSON.stringify(s2b, null, 1));
    // 模拟返回键
    await cdp.evalJs(api, 'history.back(); 1', sid);
    await cdp.sleep(2500);
    const s3 = await cdp.evalJson(api, `JSON.stringify({ url: location.pathname.slice(-25), modal: !!document.querySelector('.Modal-content'), hist: history.length, nav: (window.__nav || []).slice(-4) })`, sid, 10000);
    console.log('④ 返回键后:', JSON.stringify(s3, null, 1));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
