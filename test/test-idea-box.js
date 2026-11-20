// test-idea-box.js — 验证「圈子（/ring-feeds）底部『与圈友分享你的想法…』浮动框：下移 + 居中」
// 用法: node test-idea-box.js             重载圈子页并注入 src 下脚本
//       node test-idea-box.js --installed 测真机暴力猴里已安装的版本
//
// 背景：圈子页底部那个「与圈友分享你的想法…」输入框，知乎把它做成 position:fixed 的浮动框
//       （left:40px; right:0; bottom:70px），占位文字左偏（实测 l84 r220、宽 136，落在列里），
//       看起来像没居中、又离底部太远。用户 2026-10-12 要求：再往下一些、并居中。
//       修法（v1.4.12）：把浮动框 top 改 auto、bottom 收小到 CFG.ideaBoxBottom(默认 20)，
//       让 left/right 铺满；再让最内层含文案的元素铺满 + 文字居中（不依赖 emotion hash，
//       按文案 XPath 找最内层节点，向上走到第一个 position:fixed 祖先）。
// 断言：① 脚本样式已注入；② 存在「与圈友分享」浮动框且为 fixed；
//       ③ 浮动框**在页面上水平居中**（框中心 ≈ 其容器中心，容差 15px —— 用「相对容器中心」
//          而非「相对视口中心」，因为该框是 position:fixed 且位于被 zoom 的容器里，
//          getBoundingClientRect 是布局坐标，相对视口不可靠）；
//       ④ 浮动框对称内缩、不顶手机两边（左右内缩均 >0、左右差 ≤5px、两侧内缩合计 ≥30px）——
//          即收窄且居中，框内图标/文字保持默认；
//       ⑤ 浮动框距其包含块底部已收小：解析出的 computed `bottom` ≈ CFG.ideaBoxBottom
//          （默认 20px，落在 [10,30]）—— 改前为 70px，必 FAIL。
//       改前（v1.4.11）：right:0（右侧内缩 0）→ ④FAIL；bottom=70 → ⑤FAIL；框偏右 → ③FAIL。
'use strict';
const fs = require('fs');
const path = require('path');
const cdp = require('./cdp');

const SCRIPT = path.join(__dirname, '..', 'zhihu-desk2mob.user.js');
const INJECT_MODE = process.argv[2] !== '--installed';
const TAB_URL = 'https://www.zhihu.com/ring-feeds';
const EXP_BOTTOM = 20;       // 与 CFG.ideaBoxBottom 默认一致
const TOL_CENTER = 15;       // 框中心相对容器中心的容差（改前偏 ~20px，必 FAIL）
const BOTTOM_LO = 10, BOTTOM_HI = 30;  // bottom 解析值应落在这段（改前 70，必 FAIL）
const MIN_INSET = 30;        // 左右内缩合计至少 30px（≥ 两侧留白，且远小于「顶到边」的 0）

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const ST = `JSON.stringify((()=>{
  const vw = innerWidth, vh = innerHeight;
  function findEl(){
    try {
      const snap = document.evaluate("//*[contains(., '与圈友分享')]", document, null, 7, null);
      const all = []; for (let i=0;i<snap.snapshotLength;i++) all.push(snap.snapshotItem(i));
      const isAnc=(a,b)=>{let p=b;while(p){if(p===a)return true;p=p.parentElement;}return false;};
      return all.find(m=>!all.some(o=>o!==m&&isAnc(m,o)))||null;
    } catch(e){ return null; }
  }
  const el = findEl();
  if (!el) return { found:false, vw, vh };
  // 向上走到第一个 position:fixed 的祖先（即浮动框本身）
  let box = el;
  while (box && box !== document.body){
    if (getComputedStyle(box).position === 'fixed') break;
    box = box.parentElement;
  }
  if (!box || box === document.body) return { found:true, boxFixed:false };
  const br = box.getBoundingClientRect();
  // 真实的包含块：position:fixed 在该页位于一个被 zoom 的容器里，最近的有 transform 的祖先才是
  // 它的包含块（直接 parentElement 几何不稳，会随滚动漂移）。找不到就用视口。
  let cb = box.parentElement;
  while (cb && cb !== document.body){ if (getComputedStyle(cb).transform !== 'none') break; cb = cb.parentElement; }
  const cr = cb ? cb.getBoundingClientRect() : { left:0, right:vw, top:0, bottom:vh };
  const cs = getComputedStyle(box);
  const leftCss  = parseFloat(cs.left);
  const rightCss = parseFloat(cs.right);
  let bottomCss = parseFloat(cs.bottom); if (isNaN(bottomCss)) bottomCss = null;
  const boxCenterX = Math.round((br.left + br.right)/2);
  const cbCenterX  = Math.round((cr.left + cr.right)/2);
  return {
    found:true, vw, vh, boxFixed:true,
    boxRect: { l:Math.round(br.left), r:Math.round(br.right), t:Math.round(br.top), b:Math.round(br.bottom) },
    contRect: { l:Math.round(cr.left), r:Math.round(cr.right) },
    boxCenterX, cbCenterX, leftCss, rightCss, bottomCss,
    text: (el.textContent||'').trim().slice(0,30)
  };
})())`;

(async () => {
  const code = fs.readFileSync(SCRIPT, 'utf8');
  console.log('脚本: ' + SCRIPT.split(/[\\/]/).pop() + '  [' + (INJECT_MODE ? '注入模式' : '已安装版本') + ']');
  const api = await cdp.browserApi();
  try {
    let tab = await cdp.findTab(api, 'zhihu.com/ring-feeds');
    if (!tab) {
      console.log('未找到圈子标签，新开一个……');
      tab = await cdp.openTab(api, TAB_URL).then(() => cdp.sleep(1200)).then(async () => cdp.findTab(api, 'zhihu.com/ring-feeds'));
      if (!tab) throw new Error('圈子标签打不开');
    }
    const sid = await cdp.attach(api, tab.targetId);
    await api.send('Page.navigate', { url: TAB_URL }, sid);
    await cdp.waitReady(api, sid, 30);
    await cdp.sleep(3500);
    if (INJECT_MODE) {
      const r = await cdp.evalJs(api, `(()=>{ try { ${code}\n; return 'injected'; } catch(e){ return 'ERR:' + e.message; } })()`, sid);
      console.log('注入 -> ' + JSON.stringify(r && r.value));
      await cdp.sleep(2500);
    }
    const d = await cdp.evalJson(api, ST, sid);
    if (!d) { console.log('FAIL  前置：扫描失败'); process.exit(1); }
    console.log('几何: ' + JSON.stringify(d));
    if (!d.found) { console.log('未找到「与圈友分享」浮动框（可能页面还没渲染出来）'); }

    ok(d.found, '① 脚本样式已注入（能定位到「与圈友分享」元素）');
    ok(d.found && d.boxFixed, '② 浮动框存在且为 position:fixed', d.found ? { boxFixed: d.boxFixed, boxRect: d.boxRect } : undefined);
    const centerErr = (d.found && d.boxCenterX != null && d.cbCenterX != null) ? Math.abs(d.boxCenterX - d.cbCenterX) : 999;
    ok(d.found && d.boxCenterX != null && d.cbCenterX != null && centerErr <= TOL_CENTER,
      `③ 浮动框在页面上水平居中（相对包含块中心误差 ${centerErr}px ≤ ${TOL_CENTER}）`, { boxCenterX: d.boxCenterX, cbCenterX: d.cbCenterX });
    const symErr = (isFinite(d.leftCss) && isFinite(d.rightCss)) ? Math.abs(d.leftCss - d.rightCss) : 999;
    const bothGap = isFinite(d.leftCss) && isFinite(d.rightCss) && d.leftCss > 0 && d.rightCss > 0 && symErr <= 5 && (d.leftCss + d.rightCss) >= MIN_INSET;
    ok(bothGap,
      `④ 浮动框对称内缩、不顶手机两边（左内缩 ${d.leftCss}px / 右内缩 ${d.rightCss}px，差 ${symErr}px ≤ 5，合计 ≥ ${MIN_INSET}）`,
      { leftCss: d.leftCss, rightCss: d.rightCss });
    const bottomOk = (d.found && d.bottomCss != null && d.bottomCss >= BOTTOM_LO && d.bottomCss <= BOTTOM_HI);
    ok(bottomOk, `⑤ 浮动框已下移（computed bottom ${d.bottomCss}px ∈ [${BOTTOM_LO},${BOTTOM_HI}]，默认 ${EXP_BOTTOM}）`, { bottomCss: d.bottomCss });
  } finally {
    try { await api.close(); } catch (e) {}
  }
  console.log(`\n结果: ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
