// test-image-viewer.js — 图片查看器（.ImageView）放大的图片居中显示
// 用法:
//   node test-image-viewer.js              重载页面并注入 src 下待测脚本（快速迭代）
//   node test-image-viewer.js --installed  测真机暴力猴里已安装的版本（最接近真实使用）
//
// 背景（2026-10-08 用户反馈「评论中点击图片，没有在屏幕中间显示放大的图片」）：
// 脚本给 html 设了根 zoom（≈2.49）做反缩放；知乎图片查看器的「居中+放大」全编码在
// img 的 transform（matrix(3.95,…,344,790)，逐帧重写），坐标按未反缩放的页面算，
// 根 zoom 把它推到屏幕外（只露左上角）。
// 修复（v1.4.6）：img 改 position:fixed + inset:0 + margin:auto + transform:none，
// 脱离知乎的 transform 动画布局，用 CSS 原生居中；尺寸按浮层 rect 的 94%/88% 约束。
//
// 断言（判别力已做改前/改后对照：v1.4.5 下 ②③ 必 FAIL，v1.4.6 下 PASS）：
//   ① 图片查看器浮层已打开且脚本已生效
//   ② 图片中心 ≈ 视口中心（容差：视口短边的 25%）
//   ③ 图片完整落在视口内（四边不出界）
//   ④ 反向：图片没有被隐藏或压成 0 尺寸来「假装居中」
//
// 触发方式（v1.4.7 起）：受控夹具（同 test-modal-layout.js 思路），不再用 adb tap 点真实查看器。
// 原因（2026-10-09 实测）：真实 tap 的坐标换算不可靠 —— CDP getBoundingClientRect 的布局 px
// 与屏幕物理 px 之间的比例随地址栏伸缩/页面缩放变化（实测同一页面上 dpr=3.02 与实测比例 1.37
// 并存），多次 tap 都落不到图上，还误触了「赞同/看山浮层」等无关 UI。而 fixImageViewer 的
// 处理只认「.ImageView 里出现 img.ImageView-img」这个 DOM 事实（真实打开与夹具构造等价），
// 所以夹具方案对「脚本是否把放大的图居中」这一问题同样有判别力。
//
// 旧的真实 tap 方式（留档，踩过的坑别再踩）：
//  · JS .click() / 合成 MouseEvent / 直接调 React props.onClick —— 都**不能**打开查看器。
//  · CDP Input.dispatchTouchEvent（布局 px 坐标）能产生 trusted click 命中 IMG，
//    但知乎的处理路径仍不打开查看器（机理未明，别再试）。
//  · adb shell input tap 是 trusted 输入，但坐标换算见上 —— 已放弃。
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const cdp = require('./cdp');

const SCRIPT = path.join(__dirname, '..', 'zhihu-desk2mob.user.js');
const INJECT_MODE = process.argv[2] !== '--installed';
const DOMAIN = '/answer/';
// 设备上没有回答页标签时自动开这一个（与 test-comment-back.js 同一页，正文带 2 张图）
const FALLBACK_ANSWER = 'https://www.zhihu.com/question/2087120107130598179/answer/2087228487664920091';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

// 状态查询：图片查看器几何信息（全部布局 px）
// 注：真实查看器开时会带 .is-active；夹具没有，这里放宽到「存在 .ImageView 即算」。
const ST = `JSON.stringify((()=>{
  const iv = document.querySelector('.ImageView.is-active') || document.querySelector('.ImageView');
  const rect = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left*10)/10, y: Math.round(r.top*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10 }; };
  const img = iv ? iv.querySelector('img.ImageView-img') : null;
  return {
    z2m: !!document.getElementById('z2m-style'),
    open: !!iv,
    ivRect: iv ? rect(iv) : null,
    img: img ? { rect: rect(img), disp: getComputedStyle(img).display, inline: (img.getAttribute('style')||'').slice(0, 200) } : null,
  };
})())`;

let api, sid, freshTabId = null;
const run = e => cdp.evalJson(api, e, sid);

// 滚到第一张正文图处并等它加载完成，返回它的视觉中心（物理像素，给 adb input tap 用）
async function scrollAndAwaitImage() {
  for (let attempt = 0; attempt < 3; attempt++) {
    await run(`JSON.stringify((()=>{
      const img = document.querySelector('img.zh-lightbox-thumb');
      if (img) img.scrollIntoView({ block: 'center' });
      return 1;
    })())`);
    // 等图片真正加载（懒加载 + 条件渲染，实测 1~2s）
    for (let i = 0; i < 16; i++) {
      await cdp.sleep(500);
      const p = await run(`JSON.stringify((()=>{
        const img = document.querySelector('img.zh-lightbox-thumb');
        if (!img) return { err: 'no thumb' };
        const rc = img.getBoundingClientRect();
        const Z = parseFloat(document.documentElement.style.zoom) || 1;
        const vv = window.visualViewport;
        return { complete: img.complete, nw: img.naturalWidth,
          w: Math.round(rc.width), h: Math.round(rc.height),
          // 视觉中心 CSS px（相对视觉视口）：rect 中心 × Z × scale（rect 是布局 px）
          vcx: (rc.x + rc.width/2) * Z * (vv ? vv.scale : 1),
          vcy: (rc.y + rc.height/2) * Z * (vv ? vv.scale : 1) };
      })())`);
      if (p.err) return p;
      if (p.complete && p.nw > 0 && p.h > 100) return p;
    }
    // 没就绪：再滚一次触发 lazy（attempt 循环）
  }
  return { err: 'image never loaded' };
}

// 用 adb 硬件级 tap 点视觉坐标 (vcx, vcy)。物理 = 视觉CSS × dpr。
// dpr 取 window.devicePixelRatio（脚本反缩放不改变它）；tap 前把目标标签带到前台。
async function tapVisual(vcx, vcy, targetId) {
  const dpr = await run(`JSON.stringify(window.devicePixelRatio || 1)`);
  try { await api.send('Target.activateTarget', { targetId }); } catch (e) {}
  await cdp.sleep(400);
  const px = Math.round(vcx * dpr), py = Math.round(vcy * dpr);
  execSync(`adb shell input tap ${px} ${py}`, { stdio: 'ignore' });
  return { px, py, dpr };
}

// 稳定打开图片查看器：等图加载 → adb tap → 轮询等 .ImageView.is-active
async function openImageViewer() {
  const p = await scrollAndAwaitImage();
  if (p.err) return { ok: false, err: p.err };
  const t = await tapVisual(p.vcx, p.vcy, freshTabId);
  console.log('    tap 物理 (' + t.px + ',' + t.py + ') dpr=' + t.dpr);
  for (let i = 0; i < 15; i++) {
    await cdp.sleep(350);
    const s = await run(ST);
    if (s.open && s.img) return { ok: true, target: p, state: s };
  }
  return { ok: false, err: 'viewer not opened after tap', target: p };
}

(async () => {
  const code = fs.readFileSync(SCRIPT, 'utf8');
  console.log('脚本: ' + SCRIPT.split(/[\\/]/).pop() + '  [' + (INJECT_MODE ? '注入模式' : '已安装版本') + ']');
  api = await cdp.browserApi();
  freshTabId = null;
  try {
    // 全新标签页里测（复用 test-comment-back 的理由：会话历史/虚拟化列表互不干扰）
    let src = await cdp.findTab(api, DOMAIN);
    if (!src) {
      console.log('  设备上没有回答页标签，自动开一个（' + FALLBACK_ANSWER + '）');
      const nt = await cdp.openTab(api, FALLBACK_ANSWER);
      await cdp.sleep(7000);
      src = { targetId: nt.targetId, url: FALLBACK_ANSWER };
    }
    if (!src) throw new Error('未找到知乎回答页标签，且自动打开失败');
    const url = src.url;
    freshTabId = (await api.send('Target.createTarget', { url })).targetId;
    await cdp.sleep(3000);
    const tab = { targetId: freshTabId, url };
    sid = await cdp.attach(api, tab.targetId);
    console.log('测试标签页: ' + freshTabId);

    console.log('\n[准备] 等页面加载' + (INJECT_MODE ? '并注入脚本' : '（等暴力猴注入）'));
    await cdp.waitReady(api, sid, 30);
    await cdp.sleep(3000);
    if (INJECT_MODE) {
      const r = await cdp.evalJs(api, `(()=>{ try { ${code}\n; return 'injected'; } catch(e){ return 'ERR:' + e.message; } })()`, sid);
      console.log('  注入 -> ' + JSON.stringify(r && r.value));
      await cdp.sleep(1200);
    } else {
      await cdp.sleep(2000);
    }

    const s0 = await run(ST);
    ok(s0.z2m, '脚本已生效（#z2m-style 存在）');

    console.log('\n[触发] 放入 .ImageView 受控夹具（结构同真实查看器）');
    // 夹具与真实查看器同构：fixed 全屏遮罩(z=203, overflow:hidden) > inner(overflow:auto) > img(带知乎的动画 transform)。
    // fixImageViewer 只认这个 DOM 事实，处理动作与真实打开时完全一致。
    await run(`JSON.stringify((()=>{
      const old = document.querySelector('.ImageView');
      if (old) old.remove();
      const iv = document.createElement('div');
      iv.className = 'ImageView';
      iv.style.cssText = 'position:fixed;inset:0;z-index:203;background:rgba(0,0,0,.8);overflow:hidden;';
      const inner = document.createElement('div');
      inner.className = 'ImageView-inner';
      inner.style.cssText = 'overflow:auto;height:100%;';
      const img = document.createElement('img');
      img.className = 'ImageView-img';
      // 用一张真实存在的知乎图（data URI 不可靠），初始状态模拟知乎的「缩略图 + 动画 transform」
      img.src = 'https://picx.zhimg.com/80/v2-1a3f17bd3f3a2f8dec1e12a1e46b7873_720w.jpg?source=20261009';
      img.style.cssText = 'width:202px;transform:matrix(3.95,0,0,3.95,344,790);';
      inner.appendChild(img); iv.appendChild(inner); document.body.appendChild(iv);
      // body 子树已变化 —— 观察它的 MutationObserver 回调会跑 fixImageViewer；
      // 再 poke 一次确保触发（属性变化不观察，追加一个子节点触发 childList）。
      const poke = document.createElement('span');
      poke.style.display = 'none';
      document.body.appendChild(poke);
      setTimeout(() => poke.remove(), 100);
      return 1;
    })())`);
    // fixImageViewer 的写入路径：observer 回调（同步）+ tick（300ms 去抖）。等 2s 足够。
    await cdp.sleep(2000);
    const s = await run(ST);
    ok(s.open && s.img, '夹具已放入且 img 存在', s);
    if (!s.open || !s.img) {
      console.log('\n===== 前置失败：夹具构造异常（测试自身问题）=====');
      process.exitCode = 1;
      return;
    }
    // 前置：fixImageViewer 必须已经写入内联样式（改前对照：v1.4.5 下这里保持知乎原样 ⇒ FAIL）
    const inline = s.img.inline || '';
    ok(inline.includes('position: fixed') && inline.includes('margin: auto'),
      'fixImageViewer 已接管 img 内联样式（fixed + margin:auto）', inline.slice(0, 120));

    console.log('\n几何: 浮层=' + JSON.stringify(s.ivRect) + '  img=' + JSON.stringify(s.img.rect));

    // ② 图片中心 ≈ 视口中心（浮层 rect 即视口 CSS px）
    const vw = s.ivRect.w, vh = s.ivRect.h;
    const cx = s.img.rect.x + s.img.rect.w / 2, cy = s.img.rect.y + s.img.rect.h / 2;
    const dx = Math.abs(cx - vw / 2), dy = Math.abs(cy - vh / 2);
    ok(dx <= vw * 0.25 && dy <= vh * 0.25,
      '图片中心在视口中央（dx=' + Math.round(dx) + '/' + Math.round(vw * 0.25) + ', dy=' + Math.round(dy) + '/' + Math.round(vh * 0.25) + '）',
      { imgCenter: [Math.round(cx), Math.round(cy)], viewportCenter: [Math.round(vw / 2), Math.round(vh / 2)] });

    // ③ 图片完整落在视口内
    const r2 = s.img.rect;
    ok(r2.x >= -1 && r2.y >= -1 && r2.x + r2.w <= vw + 1 && r2.y + r2.h <= vh + 1,
      '图片完整落在视口内（不出屏）',
      { rect: r2, viewport: [vw, vh] });

    // ④ 反向：没有被隐藏/压成 0 来假装居中
    ok(s.img.disp !== 'none' && s.img.rect.w > 50 && s.img.rect.h > 40,
      '反向：图片可见且保有实际尺寸（没被隐藏/压扁）', { disp: s.img.disp, rect: s.img.rect });

    await cdp.shot(api, sid, 'shots/33-image-viewer.png', 8000);
    console.log('\n截图: shots/33-image-viewer.png');
    console.log('\n===== 结果: ' + pass + ' passed / ' + fail + ' failed =====');
  } finally {
    if (freshTabId) { try { await api.send('Target.closeTarget', { targetId: freshTabId }); } catch (e) {} }
    api.close();
  }
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
