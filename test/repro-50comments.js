// repro-50comments.js — 用「50 条评论」入口复现：展开 → 找「查看全部 11 条回复」→ 点 → 返回
'use strict';
const cdp = require('./cdp');

(async () => {
  const api = await cdp.browserApi();
  try {
    const ts = (await cdp.getTargets(api)).filter(t => t.type === 'page' && t.url.includes('2108463757307240853'));
    const sid = await cdp.attach(api, ts[0].targetId);
    await cdp.sleep(600);
    // 开 50 条评论
    await cdp.evalJs(api, `(() => {
      const b = [...document.querySelectorAll('button')].find(b2 => /^50 条评论$/.test((b2.textContent || '').replace(/[\u200b]/g, '').trim()));
      if (b) { b.scrollIntoView({ block: 'center' }); setTimeout(() => b.click(), 500); }
    })()`, sid);
    await cdp.sleep(5500);
    // 形态 + 找 11 条回复按钮
    const r = await cdp.evalJson(api, `JSON.stringify((() => {
      const box = document.querySelector('.Modal-content');
      const z = parseFloat(document.documentElement.style.zoom) || 1;
      const eleven = [...document.querySelectorAll('button')].filter(b => /查看全部 11 条回复/.test((b.textContent || '').replace(/[\u200b]/g, '')));
      return {
        modal: !!box,
        modalHead: box ? (box.textContent || '').replace(/[\u200b]/g, '').slice(0, 10) : null,
        elevenBtns: eleven.map(b => {
          const r0 = b.getBoundingClientRect();
          return { vis: r0.width > 0 && r0.height > 0, y: Math.round(r0.top / z) };
        }),
        anyReplyBtns: [...document.querySelectorAll('button')].filter(b => /查看全部.*回复/.test((b.textContent || '').replace(/[\u200b]/g, ''))).length
      };
    })())`, sid);
    const r1 = typeof r === 'string' ? JSON.parse(r) : r;
    console.log('50条评论展开后:', JSON.stringify(r1, null, 1));
    if (!r1.elevenBtns || !r1.elevenBtns.some(x => x.vis)) {
      // 十一条按钮可能不可见（要滚动）——滚动加载后再找
      for (let i = 0; i < 5; i++) {
        await cdp.evalJs(api, `(() => { const mc = document.querySelector('.Modal-content'); if (mc) mc.scrollTop = mc.scrollHeight; else scrollBy(0, 1500); })()`, sid);
        await cdp.sleep(2000);
        const f = await cdp.evalJson(api, `JSON.stringify((() => {
          const z = parseFloat(document.documentElement.style.zoom) || 1;
          const btns = [...document.querySelectorAll('button')].filter(b => /查看全部 11 条回复/.test((b.textContent || '').replace(/[\u200b]/g, '')) && b.getBoundingClientRect().width > 0);
          return btns.length ? btns.map(b => (b.textContent || '').replace(/[\u200b]/g, '').trim().slice(0, 18)) : [];
        })())`, sid);
        const fa = typeof f === 'string' ? JSON.parse(f) : f;
        if (fa.length) { console.log('滚加载后找到:', JSON.stringify(fa)); break; }
        console.log('  scroll#' + i, '未找到');
      }
    }
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
