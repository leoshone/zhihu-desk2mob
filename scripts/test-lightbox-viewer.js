// test-lightbox-viewer.js — 验证「正文图放大查看器（body 直下 img + 动画 transform）稳定居中」
// 用法: node test-lightbox-viewer.js             重载页面并注入 src 下脚本
//       node test-lightbox-viewer.js --installed 测真机暴力猴里已安装的版本
//
// 背景（2026-10-13 用户反馈「点击图片放大的图跑到屏幕外」，v1.4.16 只修了 .ImageView 仍无效）：
//   真机抓到现行：正文图（img.zh-lightbox-thumb）的放大查看器**不是** .ImageView，而是
//   body > img.css-xxx（position:absolute; z-index:999; 动画逐帧重写 transform
//   matrix(2.305,…,536,847) ⇒ 图被甩出屏幕停住）；全屏遮罩 div 是它的兄弟，不是祖先。
//   类名全是 emotion hash —— 只能用结构特征识别：body 直接子级 img + transform 非 none
//   + z-index≥500 + 尺寸≥200。
// 修法（v1.4.17）：与 .ImageView 同路 —— position:fixed + inset:0 + margin:auto + transform:none
//   + style 观察器逐帧复位。真机现场已验证：注入后图从 absolute@410,1122 → fixed@10,195 338×315 居中。
//
// 断言（改前判别力：v1.4.16 装机下 ②③ 必 FAIL —— 旧代码不认这种结构，图被动画甩出）：
//   ① 夹具 + 激进动画已运行
//   ② 图片中心 ≈ 视口中心（容差：短边 25%）
//   ③ 图片完整落在视口内
//   ④ 图片可见且保有实际尺寸
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
  // 找「body 直下、被变换过或 position:fixed 的 img」（即被脚本接管的查看器图）
  let img = null;
  for (const c of document.body ? document.body.children : []) {
    if (c.tagName === 'IMG') { img = c; break; }
  }
  const rect = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const cs = img ? getComputedStyle(img) : null;
  return { z2m: !!document.getElementById('z2m-style'),
    img: img ? { rect: rect(img), pos: cs.position, tf: cs.transform.slice(0,40), disp: cs.display } : null,
    animTicks: window.__lbAnimTicks || 0 };
})())`;

// 夹具：body 直下 img + 遮罩兄弟（模拟真实结构）+ 激进动画（每 30ms 用 !important 甩出屏幕）
const SETUP = `(()=>{
  window.__lbAnimTicks = 0;
  const old = document.querySelectorAll('body > img.__lb-fix, body > div.__lb-mask');
  old.forEach(e => e.remove());
  const mask = document.createElement('div'); mask.className = '__lb-mask';
  mask.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.8);';
  const img = document.createElement('img'); img.className = '__lb-fix';
  img.src = 'https://picx.zhimg.com/v2-d93f26002ad604d33cf76d1ec1b28110d_b.jpg';
  img.style.cssText = 'position:absolute;z-index:999;width:318px;';
  document.body.appendChild(mask); document.body.appendChild(img);
  if (window.__lbAnim) clearInterval(window.__lbAnim);
  window.__lbAnim = setInterval(() => {
    if (!img.isConnected) { clearInterval(window.__lbAnim); return; }
    window.__lbAnimTicks++;
    const s = img.style;
    s.setProperty('position', 'absolute', 'important');
    s.setProperty('left', '20px', 'important');
    s.setProperty('top', '884px', 'important');
    s.setProperty('transform', 'translateX(136px) translateY(1146px) scale(2.3)', 'important');
  }, 30);
  return 1;
})()`;
const STOP = `(()=>{ if (window.__lbAnim) { clearInterval(window.__lbAnim); window.__lbAnim = 0; } return 1; })()`;

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

    console.log('\n[构造] body 直下 img 夹具 + 遮罩兄弟 + 激进逐帧动画');
    await cdp.evalJs(api, SETUP, sid);
    await cdp.sleep(2500);
    const s0 = await run(ST);
    ok(s0.animTicks > 20, `① 激进动画已运行（${s0.animTicks} 帧）`, { animTicks: s0.animTicks });
    await cdp.evalJs(api, STOP, sid);
    await cdp.sleep(400);
    const s = await run(ST);
    if (!s.img) { console.log('FAIL  前置：夹具 img 不存在'); process.exit(1); }
    console.log('几何: img=' + JSON.stringify(s.img.rect) + '  pos=' + s.img.pos);

    const vw = 0; // （占位防误用；视口几何一律用下面的 fixed 哨兵）
    // 坐标系坑：本页根 zoom(≈4)×vv.scale(0.25)≈1，但 position:fixed 元素的 rect
    // 相对「被 zoom 收缩后的包含块」（实测 358×704），与布局视口(1430×2812)不同坐标系。
    // 可靠做法：放一个 position:fixed;inset:0 的哨兵 div，量它的 rect 中心当「视口中心」，
    // 与 img 的 rect 中心（同为 fixed 坐标系）直接比 —— 零换算、无跨系误差。
    await run(`(()=>{ let s=document.getElementById('__lb-vp'); if(!s){ s=document.createElement('div');
      s.id='__lb-vp'; s.style.cssText='position:fixed;inset:0;visibility:hidden;pointer-events:none;'; document.body.appendChild(s);} return 1; })()`);
    const VW = await run(`JSON.stringify((()=>{ const s=document.getElementById('__lb-vp').getBoundingClientRect();
      return {x:s.left, y:s.top, w:s.width, h:s.height}; })())`);
    const w = VW.w, h = VW.h;
    const cx = s.img.rect.x + s.img.rect.w / 2, cy = s.img.rect.y + s.img.rect.h / 2;
    const dx = Math.abs(cx - (VW.x + w / 2)), dy = Math.abs(cy - (VW.y + h / 2));
    ok(dx <= w * 0.25 && dy <= h * 0.25,
      `② 图片中心在视口中央（dx=${Math.round(dx)}/${Math.round(w*0.25)}, dy=${Math.round(dy)}/${Math.round(h*0.25)}）`,
      { imgCenter: [Math.round(cx), Math.round(cy)], viewportCenter: [Math.round(VW.x + w/2), Math.round(VW.y + h/2)] });
    const r2 = s.img.rect;
    ok(r2.x >= VW.x - 1 && r2.y >= VW.y - 1 && r2.x + r2.w <= VW.x + w + 1 && r2.y + r2.h <= VW.y + h + 1,
      '③ 图片完整落在视口内（不出屏）', { rect: r2, viewport: [VW.x, VW.y, w, h] });
    ok(s.img.disp !== 'none' && s.img.rect.w > 50 && s.img.rect.h > 40,
      '④ 反向：图片可见且保有实际尺寸', { disp: s.img.disp, rect: r2 });
  } finally {
    if (freshTabId) { try { await api.send('Target.closeTarget', { targetId: freshTabId }); } catch (e) {} }
    api.close();
  }
  console.log(`\n===== 结果: ${pass} passed / ${fail} failed =====`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
