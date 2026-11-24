// verify-scroll-restore.js — v1.9.13 验证：内联→线程弹层→返回后滚动位置恢复到进弹层前
'use strict';
const cdp = require('./cdp');

(async () => {
  const api = await cdp.browserApi();
  try {
    const ts = (await cdp.getTargets(api)).filter(t => t.type === 'page' && t.url.includes('2108463757307240853'));
    const sid = await cdp.attach(api, ts[0].targetId);
    await api.send('Page.navigate', { url: ts[0].url }, sid);
    await cdp.waitReady(api, sid);
    await cdp.sleep(9000);
    // ① 开内联评论
    await cdp.evalJs(api, `(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => {
        const t = (b.textContent || '').replace(/[\u200b]/g, '');
        if (!/条评论/.test(t) || /收起/.test(t)) return false;
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (btns[0]) btns[0].click();
    })()`, sid);
    await cdp.sleep(4500);
    const y0r = await cdp.evalJson(api, 'JSON.stringify({ y: Math.round(scrollY) })', sid);
    const y0 = typeof y0r === 'string' ? JSON.parse(y0r) : y0r;
    console.log('① 内联评论展开, y=' + y0.y);
    // ② 点「查看全部回复」进线程弹层
    let clicked = false;
    for (let i = 0; i < 4 && !clicked; i++) {
      const c = await cdp.evalJson(api, `JSON.stringify((() => {
        const btns = [...document.querySelectorAll('button')].filter(b => {
          const t = (b.textContent || '').replace(/[\u200b]/g, '');
          if (!/查看全部.*回复/.test(t)) return false;
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        if (btns[0]) { btns[0].click(); return true; }
        const c2 = document.querySelector('[class*=Comments]');
        if (c2) c2.scrollTop = c2.scrollHeight;
        scrollBy(0, 600);
        return false;
      })())`, sid);
      clicked = typeof c === 'boolean' ? c : !!c;
      if (!clicked) await cdp.sleep(1800);
    }
    console.log('② 点查看全部回复:', clicked);
    await cdp.sleep(4500);
    const s1 = await cdp.evalJson(api, `JSON.stringify({ modal: !!document.querySelector('.Modal-content'), thread: (() => { const box = document.querySelector('.Modal-content'); if (!box) return false; return [...box.children].some(v => getComputedStyle(v).display !== 'none' && (v.textContent || '').replace(/[\u200b]/g, '').startsWith('评论回复')); })() })`, sid);
    const o1 = typeof s1 === 'string' ? JSON.parse(s1) : s1;
    console.log('③ 线程弹层:', JSON.stringify(o1));
    // ④ 手势返回 → 弹层关 + 滚动恢复
    await cdp.evalJs(api, 'history.back(); 1', sid);
    await cdp.sleep(2500);
    const s2 = await cdp.evalJson(api, `JSON.stringify({ modal: !!document.querySelector('.Modal-content'), y: Math.round(scrollY) })`, sid);
    const o2 = typeof s2 === 'string' ? JSON.parse(s2) : s2;
    const diff = Math.abs(o2.y - y0.y);
    console.log('④ 返回后: modal=' + o2.modal + ' y=' + o2.y + ' (进弹层前 y=' + y0.y + ')');
    console.log(diff < 300 ? `===== PASS ✓ 滚动恢复（差 ${diff}px < 300）` : `===== FAIL 滚动差 ${diff}px`);
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
