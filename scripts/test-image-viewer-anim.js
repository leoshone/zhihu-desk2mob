// test-image-viewer-anim.js — 验证「知乎逐帧重写 img 样式时，放大的图仍稳定居中」
// 用法: node test-image-viewer-anim.js             重载页面并注入 src 下脚本
//       node test-image-viewer-anim.js --installed 测真机暴力猴里已安装的版本
//
// 背景：v1.4.6 用「一次性写入 position:fixed+inset:0+margin:auto+transform:none !important」把
//       放大的图居中。但知乎的「打开动画」会**逐帧重写** img 的内联 transform/位置（v1.4.6 注释已证实）。
//       一次性 !important 只能赢那一帧，动画随后又改回去 ⇒ 图被拉到屏幕外、停在那儿（用户 2026-10-13 反馈）。
//       本测试用一个「每 30ms 用 !important 重写 img 位置/缩放」的激进动画模拟知乎，验证脚本能否压住它。
// 修法（v1.4.16）：给 img 挂 style 属性的 MutationObserver，知乎每改一次就在微任务里重新居中
//       （必排在知乎那次写之后 ⇒ 每帧都赢）；并给浮层挂 class 观察器，预渲染 portal 加 is-active 时立刻重跑。
//
// 断言（判别力：v1.4.15 一次性方案在动画下 ②③ 必 FAIL；v1.4.16 下 PASS）：
//   ① 夹具 + 激进动画已就位
//   ② 动画结束后图片中心 ≈ 浮层中心（容差：浮层短边的 25%）
//   ③ 图片完整落在浮层内（不出屏）
//   ④ 反向：图片可见且保有实际尺寸
'use strict';
const fs = require('fs');
const path = require('path');
const cdp = require('./cdp');

const SCRIPT = path.join(__dirname, '..', 'zhihu-desk2mob.user.js');
const INJECT_MODE = process.argv[2] !== '--installed';
const DOMAIN = '/answer/';
const FALLBACK_ANSWER = 'https://www.zhihu.com/question/2087120107130598179/answer/2087228487664920091';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const ST = `JSON.stringify((()=>{
  const iv = document.querySelector('.ImageView');
  const img = iv ? iv.querySelector('img.ImageView-img') : null;
  const rect = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const cs = img ? getComputedStyle(img) : null;
  return { z2m: !!document.getElementById('z2m-style'),
    ivRect: iv ? rect(iv) : null,
    img: img ? { rect: rect(img), disp: cs.display, pos: cs.position, tf: cs.transform.slice(0,40) } : null,
    animTicks: window.__ivAnimTicks || 0 };
})())`;

// 构造夹具 + 激进动画（每 30ms 用 !important 把 img 甩到 (900,1500) 并放大）
const SETUP = `(()=>{
  window.__ivAnimTicks = 0;
  const old = document.querySelector('.ImageView'); if (old) old.remove();
  const iv = document.createElement('div'); iv.className = 'ImageView';
  iv.style.cssText = 'position:fixed;inset:0;z-index:203;background:rgba(0,0,0,.8);overflow:hidden;';
  const inner = document.createElement('div'); inner.className = 'ImageView-inner';
  inner.style.cssText = 'overflow:auto;height:100%;';
  const img = document.createElement('img'); img.className = 'ImageView-img';
  img.src = 'https://picx.zhimg.com/80/v2-1a3f17bd3f3a2f8dec1e12a1e46b7873_720w.jpg?source=20261009';
  img.style.cssText = 'width:202px;';
  inner.appendChild(img); iv.appendChild(inner); document.body.appendChild(iv);
  // 激进动画：模拟知乎逐帧重写（含 !important， worst-case 压过一次性方案）
  if (window.__ivAnim) clearInterval(window.__ivAnim);
  window.__ivAnim = setInterval(() => {
    if (!img.isConnected) { clearInterval(window.__ivAnim); return; }
    window.__ivAnimTicks++;
    const s = img.style;
    s.setProperty('position', 'absolute', 'important');
    s.setProperty('left', (900 + (window.__ivAnimTicks % 5) * 3) + 'px', 'important');
    s.setProperty('top', (1500 + (window.__ivAnimTicks % 5) * 3) + 'px', 'important');
    s.setProperty('transform', 'scale(3.2)', 'important');
  }, 30);
  const poke = document.createElement('span'); poke.style.display = 'none'; document.body.appendChild(poke);
  setTimeout(() => poke.remove(), 100);
  return 1;
})()`;
const STOP = `(()=>{ if (window.__ivAnim) { clearInterval(window.__ivAnim); window.__ivAnim = 0; } return 1; })()`;

let api, sid, freshTabId = null;
const run = e => cdp.evalJson(api, e, sid);

(async () => {
  const code = fs.readFileSync(SCRIPT, 'utf8');
  console.log('脚本: ' + SCRIPT.split(/[\\/]/).pop() + '  [' + (INJECT_MODE ? '注入模式' : '已安装版本') + ']');
  api = await cdp.browserApi();
  try {
    let src = await cdp.findTab(api, DOMAIN);
    if (!src) {
      console.log('  设备上没有回答页标签，自动开一个（' + FALLBACK_ANSWER + '）');
      const nt = await cdp.openTab(api, FALLBACK_ANSWER);
      await cdp.sleep(7000);
      src = { targetId: nt.targetId, url: FALLBACK_ANSWER };
    }
    if (!src) throw new Error('未找到知乎回答页标签');
    const url = src.url;
    freshTabId = (await api.send('Target.createTarget', { url })).targetId;
    await cdp.sleep(3000);
    sid = await cdp.attach(api, freshTabId);
    await cdp.waitReady(api, sid, 30);
    await cdp.sleep(3000);
    if (INJECT_MODE) {
      const r = await cdp.evalJs(api, `(()=>{ try { ${code}\n; return 'injected'; } catch(e){ return 'ERR:' + e.message; } })()`, sid);
      console.log('  注入 -> ' + JSON.stringify(r && r.value));
      await cdp.sleep(1200);
    } else {
      await cdp.sleep(2000);
    }

    console.log('\n[构造] 放入 .ImageView 夹具 + 激进逐帧动画');
    await cdp.evalJs(api, SETUP, sid);
    await cdp.sleep(2500);   // 让动画与脚本的处理互相博弈 ~80 帧
    const s0 = await run(ST);
    ok(s0.animTicks > 20, `① 激进动画已运行（${s0.animTicks} 帧）`, { animTicks: s0.animTicks });
    // 停动画，等最后一个 observer 微任务落定，再测稳态
    await cdp.evalJs(api, STOP, sid);
    await cdp.sleep(400);
    const s = await run(ST);
    if (!s.ivRect || !s.img) { console.log('FAIL  前置：夹具异常'); process.exit(1); }
    console.log('几何: 浮层=' + JSON.stringify(s.ivRect) + '  img=' + JSON.stringify(s.img.rect));

    const vw = s.ivRect.w, vh = s.ivRect.h;
    const cx = s.img.rect.x + s.img.rect.w / 2, cy = s.img.rect.y + s.img.rect.h / 2;
    const dx = Math.abs(cx - vw / 2), dy = Math.abs(cy - vh / 2);
    ok(dx <= vw * 0.25 && dy <= vh * 0.25,
      `② 动画结束后图片仍居中（dx=${Math.round(dx)}/${Math.round(vw*0.25)}, dy=${Math.round(dy)}/${Math.round(vh*0.25)}）`,
      { imgCenter: [Math.round(cx), Math.round(cy)], viewportCenter: [Math.round(vw/2), Math.round(vh/2)] });
    const r2 = s.img.rect;
    ok(r2.x >= -1 && r2.y >= -1 && r2.x + r2.w <= vw + 1 && r2.y + r2.h <= vh + 1,
      '③ 图片完整落在浮层内（不出屏）', { rect: r2, viewport: [vw, vh] });
    ok(s.img.disp !== 'none' && s.img.rect.w > 50 && s.img.rect.h > 40,
      '④ 反向：图片可见且保有实际尺寸', { disp: s.img.disp, rect: r2 });

    await cdp.shot(api, sid, 'shots/34-image-viewer-anim.png', 8000);
    console.log('\n截图: shots/34-image-viewer-anim.png');
  } finally {
    if (freshTabId) { try { await api.send('Target.closeTarget', { targetId: freshTabId }); } catch (e) {} }
    api.close();
  }
  console.log(`\n===== 结果: ${pass} passed / ${fail} failed =====`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
