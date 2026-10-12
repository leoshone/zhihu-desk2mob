// test-ring-comment.js — 验证「圈子（/ring-feeds，PinItem）图文网格缩略图不再溢出格子、盖住下方「评论」动作栏」
// 用法: node test-ring-comment.js             重载圈子页并注入 src 下脚本
//       node test-ring-comment.js --installed 测真机暴力猴里已安装的版本
//
// 背景：圈子每条 PinItem 的图文网格，知乎把每个格子做成**固定方框**
//       （父层 .css-1ld0bim: position:absolute; height:77.5px），img.Image-Preview 用
//       object-fit:cover 填满。但脚本全局的 `img:not(.Avatar){ height:auto }` 顶掉了知乎
//       写死的高度 —— 竖图按原始宽高比撑到 ~158px，溢出 78px 的格子，把下方的
//       「评论 / 喜欢 / 分享」动作栏盖住（用户 2026-10-12 反馈）。
//       修法：把 height:auto 也对 .Image-Preview 豁免（max-width 仍生效），交回知乎自己定尺。
// 断言：① 脚本样式已注入；② 页面有 .Image-Preview 缩略图；
//       ③ 没有缩略图高过所在格子（imgH ≤ 格子H+2）；
//       ④ 缩略图基本填满格子（|imgH − 格子H| ≤ 2，即恢复了 object-fit:cover 的方框）；
//       ⑤ 没有缩略图与任何动作栏（.ContentItem-action，含「评论」）相交。
'use strict';
const fs = require('fs');
const path = require('path');
const cdp = require('./cdp');

const SCRIPT = path.join(__dirname, '..', 'zhihu-desk2mob.user.js');
const INJECT_MODE = process.argv[2] !== '--installed';
const TAB_URL = 'https://www.zhihu.com/ring-feeds';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const ST = `JSON.stringify((()=>{
  const imgs = [...document.querySelectorAll('img.Image-Preview')];
  const actions = [...document.querySelectorAll('.ContentItem-action')];
  let overflowBad = 0, fillBad = 0, maxOverflow = 0, maxFillDelta = 0;
  const samples = [];
  for (const im of imgs) {
    const cell = im.parentElement;
    const ir = im.getBoundingClientRect();
    const cr = cell ? cell.getBoundingClientRect() : null;
    if (cr && cr.height > 10) {
      const over = ir.height - cr.height;
      const delta = Math.abs(ir.height - cr.height);
      if (over > 2) { overflowBad++; maxOverflow = Math.max(maxOverflow, over); }
      if (delta > 2) { fillBad++; maxFillDelta = Math.max(maxFillDelta, delta); }
      if (samples.length < 4) samples.push({ imgH: Math.round(ir.height), cellH: Math.round(cr.height), ok: over <= 2 && delta <= 2 });
    }
  }
  // 直接症状：缩略图 bbox 与动作栏 bbox 相交
  let overlap = 0; const overlaps = [];
  for (const im of imgs) {
    const ir = im.getBoundingClientRect();
    for (const a of actions) {
      const ar = a.getBoundingClientRect();
      const ox = Math.max(0, Math.min(ir.right, ar.right) - Math.max(ir.left, ar.left));
      const oy = Math.max(0, Math.min(ir.bottom, ar.bottom) - Math.max(ir.top, ar.top));
      if (ox > 2 && oy > 2) { overlap++; if (overlaps.length < 4) overlaps.push({ ox: Math.round(ox), oy: Math.round(oy), action: (a.textContent||'').trim().slice(0,10) }); }
    }
  }
  return { z2m: !!document.getElementById('z2m-style'), imgCount: imgs.length, actionCount: actions.length,
           overflowBad, fillBad, maxOverflow: Math.round(maxOverflow), maxFillDelta: Math.round(maxFillDelta),
           overlap, overlaps, samples };
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
    // 滚一下，让更多 PinItem 的图进入 DOM（懒加载），提高样本量
    await cdp.evalJs(api, `(()=>{ window.scrollTo(0, 900); return 1; })()`, sid).catch(()=>{});
    await cdp.sleep(1500);
    await cdp.evalJs(api, `(()=>{ window.scrollTo(0, 0); return 1; })()`, sid).catch(()=>{});
    await cdp.sleep(800);
    if (INJECT_MODE) {
      const r = await cdp.evalJs(api, `(()=>{ try { ${code}\n; return 'injected'; } catch(e){ return 'ERR:' + e.message; } })()`, sid);
      console.log('注入 -> ' + JSON.stringify(r && r.value));
      await cdp.sleep(2500);
    }
    const d = await cdp.evalJson(api, ST, sid);
    if (!d || d.err) { console.log('FAIL  前置：扫描失败 ' + JSON.stringify(d)); process.exit(1); }
    console.log(`缩略图 ${d.imgCount}  动作栏 ${d.actionCount}  溢出坏 ${d.overflowBad}(max ${d.maxOverflow}px)  未填满 ${d.fillBad}(maxΔ ${d.maxFillDelta}px)  与动作栏相交 ${d.overlap}`);
    console.log('样本: ' + JSON.stringify(d.samples));
    if (d.overlaps.length) console.log('相交样本: ' + JSON.stringify(d.overlaps));

    ok(d.z2m, '① 脚本样式已注入（#z2m-style 存在）');
    ok(d.imgCount > 0, '② 页面有 .Image-Preview 缩略图（且有动作栏）', { imgs: d.imgCount, actions: d.actionCount });
    ok(d.overflowBad === 0, '③ 缩略图不再高过所在格子（不溢出）', { bad: d.overflowBad, maxOverflow: d.maxOverflow });
    ok(d.fillBad === 0, '④ 缩略图基本填满格子（恢复 object-fit:cover 方框）', { bad: d.fillBad, maxDelta: d.maxFillDelta });
    ok(d.overlap === 0, '⑤ 缩略图不再与「评论」等动作栏相交', { overlap: d.overlap, samples: d.overlaps });
  } finally {
    try { await api.close(); } catch (e) {}
  }
  console.log(`\n结果: ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
