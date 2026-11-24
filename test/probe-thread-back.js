// probe-thread-back.js — v1.9.7 修复验证：「查看全部 N 条回复」线程视图的返回键行为
// 完整链路：打开评论弹层 → 进线程视图 → 返回键①切回列表 → 返回键②关弹层
// （页面重载后一次性装好全部 helper + capture popstate，再依次驱动）
'use strict';
const cdp = require('./cdp');

(async () => {
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, '/answer/');
    if (!tab) { console.log('NO answer tab'); return; }
    const sid = await cdp.attach(api, tab.targetId);
    await api.send('Page.navigate', { url: tab.url }, sid);
    await cdp.waitReady(api, sid);
    await cdp.sleep(8000);

    // 装 helper（视图判定 + 切回）与 capture popstate——全部在导航后一次装好
    const INSTALL = `(() => {
      window.__z2mThreadVisible = () => {
        const box = document.querySelector('.Modal-content');
        if (!box) return false;
        for (const v of [...box.children]) {
          if (getComputedStyle(v).display === 'none') continue;
          if (/展开其他|查看全部[\d ]+条回复/.test(v.textContent || '')) return true;
        }
        return false;
      };
      window.__z2mBackToList = () => {
        const box = document.querySelector('.Modal-content');
        if (!box) return false;
        let threadV = null, listV = null;
        for (const v of [...box.children]) {
          const hidden = getComputedStyle(v).display === 'none';
          const isThread = /展开其他|查看全部[\d ]+条回复/.test(v.textContent || '');
          if (!hidden && isThread) threadV = v;
          else if (hidden) listV = v;
        }
        if (!threadV || !listV) return false;
        listV.style.display = 'flex';
        threadV.style.display = 'none';
        return true;
      };
      window.addEventListener('popstate', () => {
        if (document.querySelector('.Modal-content') && window.__z2mThreadVisible()) {
          window.__z2mBackToList();
        }
      }, true);
      return 1;
    })()`;
    await cdp.evalJs(api, INSTALL, sid);

    // ① 打开评论弹层
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
    // ② 进线程视图（压线程哨兵）
    await cdp.evalJs(api, `(() => {
      const mc = document.querySelector('.Modal-content');
      const btn = mc && [...mc.querySelectorAll('button')].find(b => /查看全部.*回复/.test((b.textContent || '').replace(/[\u200b]/g, '')));
      if (btn) { btn.click(); history.pushState({ z2mThread: 1 }, '', location.href); }
      return !!btn;
    })()`, sid);
    await cdp.sleep(4000);
    const s1 = await cdp.evalJson(api, `JSON.stringify({ thread: window.__z2mThreadVisible(), hist: history.length, state: JSON.stringify(history.state) })`, sid);
    console.log('① 线程视图就绪:', JSON.stringify(s1));
    // ③ 第一次返回键：期望切回列表视图、弹层仍开
    await cdp.evalJs(api, 'history.back(); 1', sid);
    await cdp.sleep(2000);
    const s2 = await cdp.evalJson(api, `JSON.stringify({ modal: !!document.querySelector('.Modal-content'), thread: window.__z2mThreadVisible(), hist: history.length })`, sid);
    console.log('② 返回键①（期望 modal:true thread:false）:', JSON.stringify(s2));
    // ④ 第二次返回键：期望关弹层
    await cdp.evalJs(api, 'history.back(); 1', sid);
    await cdp.sleep(2000);
    const s3 = await cdp.evalJson(api, `JSON.stringify({ modal: !!document.querySelector('.Modal-content'), hist: history.length })`, sid);
    console.log('③ 返回键②（期望 modal:false）:', JSON.stringify(s3));
    const pass = s2.modal === true && s2.thread === false && s3.modal === false;
    console.log(pass ? 'PASS ✓ 两层返回链路正确' : 'FAIL ✗');
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
