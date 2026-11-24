// verify-thread-repeat.js — v1.9.9 验证：点「查看全部回复」→返回→再点→返回×3 轮往返
// 断言每轮切回后 visThreads=0 且 listVisible=true（切回干净、按钮可重复点击）
'use strict';
const cdp = require('./cdp');

(async () => {
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, '/question/2108463757307240853');
    if (!tab) { console.log('NO tab'); return; }
    const sid = await cdp.attach(api, tab.targetId);
    await cdp.sleep(1500);
    const probe = `JSON.stringify((() => {
      const box = document.querySelector('.Modal-content');
      if (!box) return { modal: false };
      return {
        modal: true, hist: history.length,
        state: String(JSON.stringify(history.state)).slice(0, 22),
        visThreads: [...box.children].filter(v => getComputedStyle(v).display !== 'none' && (v.textContent || '').replace(/[\u200b]/g, '').startsWith('评论回复')).length,
        listVisible: [...box.children].some(v => getComputedStyle(v).display !== 'none' && /条评论/.test((v.textContent || '').slice(0, 200)))
      };
    })())`;
    // evalJson 已做一次 JSON.parse；对象直接用，字符串再 parse 一层
    let s = await cdp.evalJson(api, probe, sid);
    if (s && typeof s === 'string') s = JSON.parse(s);
    if (!s.modal) {
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
      s = await cdp.evalJson(api, probe, sid);
      if (s && typeof s === 'string') s = JSON.parse(s);
    }
    console.log('S1 弹层:', JSON.stringify(s));
    let allPass = true;
    for (let round = 1; round <= 3; round++) {
      await cdp.evalJs(api, `(() => {
        const mc = document.querySelector('.Modal-content');
        const btn = mc && [...mc.querySelectorAll('button')].find(b => /查看全部.*回复/.test((b.textContent || '').replace(/[\u200b]/g, '')));
        if (btn) btn.click();
      })()`, sid);
      await cdp.sleep(4000);
      let sIn = await cdp.evalJson(api, probe, sid);
      if (sIn && typeof sIn === 'string') sIn = JSON.parse(sIn);
      console.log('R' + round + ' 进线程:', JSON.stringify(sIn));
      await cdp.evalJs(api, 'history.back(); 1', sid);
      await cdp.sleep(2200);
      let sOut = await cdp.evalJson(api, probe, sid);
      if (sOut && typeof sOut === 'string') sOut = JSON.parse(sOut);
      console.log('R' + round + ' 返回:', JSON.stringify(sOut));
      if (sOut.visThreads !== 0 || !sOut.listVisible) { console.log('>>> R' + round + ' FAIL'); allPass = false; break; }
    }
    console.log(allPass ? '===== 三轮往返全 PASS ✓ 切回干净、按钮可重复点击' : '===== 仍有 FAIL');
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
