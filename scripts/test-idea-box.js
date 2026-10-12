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
//       ③ 占位文字水平居中（最内层元素中心 ≈ 浮动框中心，容差 20px ——
//          用「相对浮动框中心」而非「相对视口中心」，因为该框是 position:fixed 且位于
//          被 zoom 的容器里，getBoundingClientRect 是布局坐标，相对视口不可靠）；
//       ④ 浮动框距其包含块底部已收小：解析出的 computed `bottom` ≈ CFG.ideaBoxBottom
//          （默认 20px，落在 [10,30]）—— 改前为 70px，必 FAIL。
//       改前（v1.4.11）：文字左偏（中心距框中心 ~47px）→ ③FAIL；bottom=70 → ④FAIL。
'use strict';
const fs = require('fs');
const path = require('path');
const cdp = require('./cdp');

const SCRIPT = path.join(__dirname, '..', 'zhihu-desk2mob.user.js');
const INJECT_MODE = process.argv[2] !== '--installed';
const TAB_URL = 'https://www.zhihu.com/ring-feeds';
const EXP_BOTTOM = 20;       // 与 CFG.ideaBoxBottom 默认一致
const TOL_CENTER = 20;       // 文字中心相对浮动框中心的容差（改前偏 ~47px，必 FAIL）
const BOTTOM_LO = 10, BOTTOM_HI = 30;  // bottom 解析值应落在这段（改前 70，必 FAIL）

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
  const er = el.getBoundingClientRect();
  // 向上走到第一个 position:fixed 的祖先
  let box = el, pos='static';
  while (box && box !== document.body){
    const cs = getComputedStyle(box);
    if (cs.position === 'fixed'){ pos='fixed'; break; }
    box = box.parentElement;
  }
  const hasFixed = !!box && box !== document.body;
  const br = hasFixed ? box.getBoundingClientRect() : null;
  let bottomCss = null;
  if (hasFixed) { try { bottomCss = parseFloat(getComputedStyle(box).bottom); } catch(e){ bottomCss = null; } }
  const boxCenterX = br ? Math.round((br.left + br.right)/2) : null;
  // 居中要看「图标 + 占位文字」整组的中心，而不是只量文字（文字左侧常有一个图标，
  // 只量文字会让组心看起来偏右）。取 el 所在 flex 行里所有子元素的并集中心。
  let cx0 = 1e9, cx1 = -1e9;
  const row = el.parentElement;
  if (row && row.children && row.children.length) {
    for (const c of row.children) {
      const r = c.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { cx0 = Math.min(cx0, r.left); cx1 = Math.max(cx1, r.right); }
    }
  }
  if (cx0 > cx1) { cx0 = er.left; cx1 = er.right; }
  const contentCenterX = Math.round((cx0 + cx1)/2);
  const elCenterX = Math.round((er.left + er.right)/2);
  return {
    found:true, vw, vh,
    elRect: { l:Math.round(er.left), r:Math.round(er.right), t:Math.round(er.top), b:Math.round(er.bottom), w:Math.round(er.width) },
    elCenterX, contentCenterX,
    boxFixed: hasFixed && pos==='fixed',
    boxRect: br ? { l:Math.round(br.left), r:Math.round(br.right), t:Math.round(br.top), b:Math.round(br.bottom) } : null,
    boxCenterX,
    bottomCss,
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
    const centerErr = (d.found && d.boxCenterX != null) ? Math.abs(d.contentCenterX - d.boxCenterX) : 999;
    ok(d.found && d.boxCenterX != null && centerErr <= TOL_CENTER, `③ 占位框（图标+文字）水平居中（整组中心误差 ${centerErr}px ≤ ${TOL_CENTER}）`, { contentCenterX: d.contentCenterX, boxCenterX: d.boxCenterX });
    const bottomOk = (d.found && d.bottomCss != null && d.bottomCss >= BOTTOM_LO && d.bottomCss <= BOTTOM_HI);
    ok(bottomOk, `④ 浮动框已下移（computed bottom ${d.bottomCss}px ∈ [${BOTTOM_LO},${BOTTOM_HI}]，默认 ${EXP_BOTTOM}）`, { bottomCss: d.bottomCss });
  } finally {
    try { await api.close(); } catch (e) {}
  }
  console.log(`\n结果: ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
