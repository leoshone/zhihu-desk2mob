// test-hot-thumb.js — 验证「热榜条目缩略图按标题行数定高 + metrics 行收回文档流」
// 用法: node test-hot-thumb.js             重载热榜并注入 src 下脚本
//       node test-hot-thumb.js --installed 测真机暴力猴里已安装的版本
//
// 背景：热榜条目 .HotItem 是 flex row（序号 | 内容 | 图片 190x105）。图片缩小后卡片被文字压矮，
// 而「N 万热度/分享」行是 position:absolute; bottom:16px 锚在卡片底 —— 会叠到摘要上
// （脚本必须把 .HotItem-metrics--bottom 改回 static 才算修好）。
// 断言：① 图片高度 = 3 行字形盒高（73px 附近，即 3x28-11）；② 图片宽 < 150（不再是 190）；
//       ③ metrics 行 position 为 static；④ metrics 与标题/摘要无垂直重叠（改前 28 条全重叠）；
//       ⑤ 图片顶与标题第 1 行内联盒顶偏差在 8px 内（对齐口径）；
//       ⑥ 「N 万热度」文本不折行（折行会上下叠字，改前 2 个行框）；
//       ⑦ 「分享」按钮不被 .HotItem-content 的 overflow:hidden 裁掉（改前 30/30 被裁）。
'use strict';
const fs = require('fs');
const path = require('path');
const cdp = require('./cdp');

const SCRIPT = path.join(__dirname, '..', 'zhihu-desk2mob.user.js');
const INJECT_MODE = process.argv[2] !== '--installed';
const TAB_URL = 'https://www.zhihu.com/hot';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const ST = `JSON.stringify((()=>{
  const items = [...document.querySelectorAll('.HotItem')];
  if (!items.length) return { err: 'no HotItem', z2m: !!document.getElementById('z2m-style') };
  const lh = 28;   // 标题 18px 字体的行框（.HotItem-title 实测 28px）
  // 字形盒高（canvas 量「国」）：18px 字体实测 ascent 15 + descent 1 = 16px
  const cv = document.createElement('canvas').getContext('2d');
  const tcs = getComputedStyle(items[0].querySelector('.HotItem-title'));
  cv.font = tcs.fontWeight + ' ' + tcs.fontSize + ' ' + tcs.fontFamily;
  const mm = cv.measureText('\\u56fd');
  const glyphBox = mm.actualBoundingBoxAscent + mm.actualBoundingBoxDescent;
  const expectH = 2 * lh + glyphBox;   // (N-1) x 行框 + 字形盒，N=3

  let imgHs = [], imgWs = [], staticMetrics = 0, absMetrics = 0, overlap = 0, topDevMax = 0, wrappedText = 0, btnClipped = 0;
  for (const it of items) {
    const img = it.querySelector('.HotItem-img');
    if (img) {
      const b = img.getBoundingClientRect();
      imgHs.push(b.height); imgWs.push(b.width);
      const title = it.querySelector('.HotItem-title');
      if (title) {
        const range = document.createRange();
        range.selectNodeContents(title);
        const fl = range.getClientRects()[0];
        if (fl) topDevMax = Math.max(topDevMax, Math.abs(b.top - fl.top));
      }
    }
    const mx = it.querySelector('.HotItem-metrics--bottom');
    if (mx) {
      (getComputedStyle(mx).position === 'static') ? staticMetrics++ : absMetrics++;
      const m = mx.getBoundingClientRect();
      const ex = it.querySelector('.HotItem-excerpt');
      const t = it.querySelector('.HotItem-title');
      const ref = (ex || t).getBoundingClientRect();
      if (m.top < ref.bottom - 1) overlap++;
      // 「N 万热度」文本节点折行检测：行框数 > 1 即上下叠字
      const tn = [...mx.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
      if (tn) {
        const r2 = document.createRange();
        r2.selectNodeContents(tn);
        if (r2.getClientRects().length > 1) wrappedText++;
      }
      // 「分享」按钮被 content 的 overflow:hidden 裁剪检测
      const btn = it.querySelector('.ShareMenu-toggler button');
      const c = it.querySelector('.HotItem-content');
      if (btn && c) {
        const br = btn.getBoundingClientRect(); const cr = c.getBoundingClientRect();
        if (getComputedStyle(c).overflow !== 'visible' && br.right > cr.right + 1) btnClipped++;
      }
    }
  }
  const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
  return {
    z2m: !!document.getElementById('z2m-style'),
    itemCount: items.length,
    withImg: imgHs.length,
    glyphBox: Math.round(glyphBox * 10) / 10,
    expectH: Math.round(expectH * 10) / 10,
    avgImgH: Math.round(avg(imgHs) * 10) / 10,
    avgImgW: Math.round(avg(imgWs) * 10) / 10,
    staticMetrics, absMetrics, overlap,
    topDev: Math.round(topDevMax * 10) / 10,
    wrappedText, btnClipped
  };
})())`;

(async () => {
  const code = fs.readFileSync(SCRIPT, 'utf8');
  console.log('脚本: ' + SCRIPT.split(/[\\/]/).pop() + '  [' + (INJECT_MODE ? '注入模式' : '已安装版本') + ']');
  const api = await cdp.browserApi();
  try {
    let tab = await cdp.findTab(api, 'zhihu.com/hot');
    if (!tab) {
      console.log('未找到热榜标签，新开一个……');
      tab = await cdp.openTab(api, TAB_URL).then(() => cdp.sleep(1200)).then(async () => cdp.findTab(api, 'zhihu.com/hot'));
      if (!tab) throw new Error('热榜标签打不开');
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
    if (!d || d.err) { console.log('FAIL  前置：拿不到热榜条目 ' + JSON.stringify(d)); process.exit(1); }
    console.log(`条目 ${d.itemCount}（带图 ${d.withImg}）  字形盒 ${d.glyphBox}  期望图高 ${d.expectH}  实测均高 ${d.avgImgH}  均宽 ${d.avgImgW}  metrics static ${d.staticMetrics}/${d.staticMetrics + d.absMetrics}  重叠 ${d.overlap}  顶偏差 ${d.topDev}  热度文本折行 ${d.wrappedText}  按钮被裁 ${d.btnClipped}`);

    ok(d.z2m, '① 脚本样式已注入（#z2m-style 存在）');
    ok(d.withImg > 0, '② 页面上有带图热榜条目', d.withImg);
    ok(Math.abs(d.avgImgH - d.expectH) <= 2, '③ 图片高度 = 3 行字形盒高(±2px)', { expect: d.expectH, got: d.avgImgH });
    ok(d.avgImgW > 0 && d.avgImgW < 150, '④ 图片宽已收窄（<150，原 190）', d.avgImgW);
    ok(d.absMetrics === 0 && d.staticMetrics > 0, '⑤ metrics 行全部为 static（收回文档流）', { static: d.staticMetrics, abs: d.absMetrics });
    ok(d.overlap === 0, '⑥ metrics 行与摘要/标题零重叠', d.overlap);
    ok(d.topDev <= 8, '⑦ 图片顶与标题第 1 行内联盒顶偏差 ≤8px', d.topDev);
    ok(d.wrappedText === 0, '⑧ 「N 万热度」文本不折行（折行即叠字）', d.wrappedText);
    ok(d.btnClipped === 0, '⑨ 「分享」按钮不被 content 的 overflow:hidden 裁掉', d.btnClipped);
  } finally {
    try { await api.close(); } catch (e) {}
  }
  console.log(`\n结果: ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
