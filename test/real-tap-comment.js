// real-tap-comment.js — 真实触摸（Input.dispatchTouchEvent）打开评论弹层，绕过 CDP click 手势限制
'use strict';
const cdp = require('./cdp');

(async () => {
  const api = await cdp.browserApi();
  try {
    const ts = (await cdp.getTargets(api)).filter(t => t.type === 'page' && t.url.includes('2108463757307240853'));
    const sid = await cdp.attach(api, ts[0].targetId);
    await cdp.sleep(800);
    // 滚到按钮位置
    await cdp.evalJs(api, `(() => { const btn = [...document.querySelectorAll('button')].find(b => /^31 条评论$/.test((b.textContent || '').replace(/[\u200b]/g, '').trim())); if (btn) { btn.scrollIntoView({ block: 'center' }); return 'scrolled'; } return 'nf'; })()`, sid);
    await cdp.sleep(1200);
    // 取视觉坐标（zoom 后视觉 = 布局 rect / zoom；再乘 dsf=物理像素给 dispatchTouchEvent）
    const pos = await cdp.evalJson(api, `JSON.stringify((() => {
      const z = parseFloat(document.documentElement.style.zoom) || 1;
      const btn = [...document.querySelectorAll('button')].find(b => /^31 条评论$/.test((b.textContent || '').replace(/[\u200b]/g, '').trim()));
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      const dsf = window.devicePixelRatio || 3;
      return { px: Math.round((r.left + r.width / 2) * dsf), py: Math.round((r.top + r.height / 2) * dsf), dsf };
    })())`, sid);
    const p = typeof pos === 'string' ? JSON.parse(pos) : pos;
    if (!p) { console.log('按钮没了'); return; }
    console.log('触摸坐标(物理):', JSON.stringify(p));
    // 真实触摸事件
    await api.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.px, y: p.py, id: 1 }] }, sid);
    await cdp.sleep(80);
    await api.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sid);
    await cdp.sleep(5000);
    const st = await cdp.evalJson(api, `JSON.stringify((() => {
      const box = document.querySelector('.Modal-content');
      if (!box) return { modal: false };
      return { modal: true, head: (box.textContent || '').replace(/[\u200b]/g, '').slice(0, 10),
        viewAll: [...box.querySelectorAll('button')].filter(b => /查看全部.*回复/.test((b.textContent || '').replace(/[\u200b]/g, ''))).length,
        state: String(JSON.stringify(history.state)).slice(0, 25), hist: history.length };
    })())`, sid);
    const s1 = typeof st === 'string' ? JSON.parse(st) : st;
    console.log('真实触摸后弹层:', JSON.stringify(s1));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
