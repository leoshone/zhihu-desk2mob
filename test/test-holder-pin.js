// test-holder-pin.js — v1.9.3 回归：.Sticky--holder 正反馈钳制（「更多回答」上方空白脉冲闪烁修复）
//
// 真机场景（2026-11-23 反馈）：滚动中知乎原生 JS 把 holder inline height 逐级吹大
// （207→517→…→7481），docH 随之 ±3000px 脉冲 = 空白反复出现/消失。修法是 holder 高度
// 恒等于吸底栏实际高度。本测试在线上回答页模拟知乎的吹大写入，断言三条钳制路径都压得住：
//   ① 手动调 __z2mPinHolder()（= interval/每拍路径的纯函数部分）
//   ② 连续模拟知乎吹大 + scroll 事件（= scroll 钩子路径，脉冲主路径）
//   ③ CSS max-height:999px 硬上限在样式表里存在
//
// 前置：真机/模拟器已装脚本（--installed 模式）、开着回答页标签。
// 用法: node test-holder-pin.js --installed
'use strict';
const cdp = require('./cdp');

let pass = 0, fail = 0;
const ok = (c, l, e) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); } };

(async () => {
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, '/answer/');
    if (!tab) { console.log('NO answer tab（先开一个回答页）'); process.exit(1); }
    await api.send('Target.activateTarget', { targetId: tab.targetId });
    await cdp.sleep(400);
    const sid = await cdp.attach(api, tab.targetId);
    await cdp.waitReady(api, sid);

    const pre = await cdp.evalJson(api, `JSON.stringify({
      injected: !!document.getElementById('z2m-style'),
      pinFn: typeof window.__z2mPinHolder,
      cssCap: (() => { const st = document.getElementById('z2m-style'); return st ? st.textContent.includes('max-height: 999px') : false; })(),
    })`, sid);
    const p = typeof pre === 'string' ? JSON.parse(pre) : pre;
    ok(p.injected, '脚本已注入（#z2m-style 存在）');
    ok(p.pinFn === 'function', '测试口子 __z2mPinHolder 已导出');
    ok(p.cssCap, 'CSS 硬上限 max-height:999px 在样式表中');

    // 需要吸底栏与 holder 存在：滚动触发知乎挂载
    await cdp.evalJs(api, 'window.scrollTo(0, 3000)', sid);
    await cdp.sleep(2000);

    // ── 路径①：把 holder 吹大（模拟知乎写入），调 pin，断言钳到栏高 ──
    const r1 = await cdp.evalJson(api, `JSON.stringify((() => {
      const bar = document.querySelector('.ContentItem-actions.Sticky');
      const h = document.querySelector('.Sticky--holder');
      if (!bar || !h) return { err: 'no bar/holder（页面未挂载吸底栏，重跑一次）' };
      const barH = Math.round(bar.getBoundingClientRect().height);
      h.style.height = '7481px';                 // 模拟知乎正反馈写入
      h.style.maxHeight = '3000px';              // 旧版残留值也一并验证被纠正
      window.__z2mPinHolder();
      return { barH, nowH: h.style.height, nowMax: h.style.maxHeight,
               rectH: Math.round(h.getBoundingClientRect().height),
               docH: document.body.scrollHeight };
    })())`, sid);
    const a = typeof r1 === 'string' ? JSON.parse(r1) : r1;
    if (a.err) { console.log('  SKIP  ' + a.err); }
    else {
      ok(parseFloat(a.nowH) === a.barH, '手动 pin：holder height 被钳到吸底栏高度 ' + a.barH + 'px', a.nowH);
      ok(a.nowMax === '999px', '手动 pin：maxHeight 被纠正为 999px', a.nowMax);
    }

    // ── 路径②：模拟「滚动中知乎连续吹大」——每拍写入后派发 scroll 事件，断言同步压回 ──
    // 真实脉冲 = scroll 事件帧内知乎写大、我们的 scroll 钩子立即写回；这里按同时序重放。
    const r2 = await cdp.evalJson(api, `JSON.stringify(new Promise(res => {
      const bar = document.querySelector('.ContentItem-actions.Sticky');
      const h = document.querySelector('.Sticky--holder');
      if (!bar || !h) { res(JSON.stringify({ err: 'no bar/holder' })); return; }
      const barH = Math.round(bar.getBoundingClientRect().height);
      const docBefore = document.body.scrollHeight;
      let maxDoc = docBefore;
      const steps = [517, 1289, 3214, 7481];      // 真机实测的逐级吹大序列
      let i = 0;
      const iv = setInterval(() => {
        if (i >= steps.length) {
          clearInterval(iv);
          res(JSON.stringify({ barH, docBefore, docAfter: document.body.scrollHeight,
                               maxDoc, finalH: h.style.height, finalMax: h.style.maxHeight }));
          return;
        }
        h.style.height = steps[i++] + 'px';      // 知乎写入（垃圾高度）
        dispatchEvent(new Event('scroll'));      // 同一帧的 scroll（触发我们的钩子）
        maxDoc = Math.max(maxDoc, document.body.scrollHeight);
      }, 120);
    }))`, sid, 20000);
    const b = typeof r2 === 'string' ? JSON.parse(r2) : r2;
    if (b.err) { console.log('  SKIP  ' + b.err); }
    else {
      ok(b.finalH === b.barH + 'px', '滚动重放：4 级吹大后 holder 仍钳在栏高', b.finalH);
      // 关键断言：docH 全程不被吹起来（修复前 maxDoc 会涨到 docBefore+3000 以上）
      ok(b.maxDoc - b.docBefore < 200, '滚动重放：docH 全程无脉冲（涨幅 <200px）',
         { before: b.docBefore, max: b.maxDoc });
      ok(b.finalMax === '999px', '滚动重放：maxHeight 保持 999px', b.finalMax);
    }

    // ── 清场：恢复被测字段到健康态，避免给页面留垃圾 ──
    await cdp.evalJs(api, `(() => { const h = document.querySelector('.Sticky--holder');
      if (h) { h.style.height = ''; window.__z2mPinHolder && window.__z2mPinHolder(); }
      return 1; })()`, sid);

    console.log('\\n===== 结果: ' + pass + ' passed / ' + fail + ' failed =====');
    process.exit(fail ? 1 : 0);
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
