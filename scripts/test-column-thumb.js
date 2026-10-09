// test-column-thumb.js — 验证「专栏页 /column-square 推荐专栏列表：右侧文章预览图按正文行数定高 + 正文第 4 行起回落全宽」
// 用法: node test-column-thumb.js             重载专栏广场并注入 src 下脚本
//       node test-column-thumb.js --installed 测真机暴力猴里已安装的版本
//
// 背景：/column-square 的「推荐专栏」卡片 .recommend-column-content > .subscrib-card > a > .card-content
//       > .article-content(flex) > [ p.article-text , img.article-image ]。
//       知乎原生：图在右侧（190 或 94 宽），文字被挤在左侧 ~124px 窄列、且**一路都是窄列**
//       （.article-text 是 -webkit-box + overflow:hidden，既不绕浮动、也不在浮动下方回宽）。
//       修法三件事一起（见 userscript 内「专栏推荐列表」CSS 段 + fitColumnPreview）：
//         ① .article-content 改 display:block（flex 忽略 float）；
//         ② img float:right + 高 = N 行字形盒（沿用封面口径 Nx28-13）+ width:auto 保比例；
//         ③ .article-text 改 block + overflow:visible（解 BFC）→ 前 N 行绕右、第 N+1 行起全宽；
//         ④ JS 把 img 移到 .article-content 首位（图在 DOM 里排在文字之后，不重排就沉到正文下方）。
//       断言：① 脚本样式已注入；② 页面有带图卡片；③ 图片高 = 3 行字形盒高（71px 附近）；
//             ④ 图片 float:right；⑤ 图片是 .article-content 的**首个子元素**（DOM 重排，区别于「沉底」坏情况）；
//             ⑥ 带图卡片中确有 ≥4 行正文的样本：其前 3 行在图片右侧呈窄列、第 4 行起回到接近整列宽。
'use strict';
const fs = require('fs');
const path = require('path');
const cdp = require('./cdp');

const SCRIPT = path.join(__dirname, '..', 'zhihu-desk2mob.user.js');
const INJECT_MODE = process.argv[2] !== '--installed';
const TAB_URL = 'https://www.zhihu.com/column-square';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const ST = `JSON.stringify((()=>{
  const box = document.querySelector('.recommend-column-content');
  if (!box) return { err: 'no .recommend-column-content', z2m: !!document.getElementById('z2m-style') };
  const imgs = [...box.querySelectorAll('.article-content > .article-image')];
  const N = 3;                       // CFG.columnThumbLines 期望值（本回归对应 3 行）
  const lh = 28;                     // 正文 16px 字体的行框（--z2m-line）
  // 字形盒高（canvas 量「国」）：16px 字体实测 ascent+descent ≈ 15px
  const cv = document.createElement('canvas').getContext('2d');
  const tcs = getComputedStyle(box.querySelector('.article-text') || document.body);
  cv.font = tcs.fontWeight + ' ' + tcs.fontSize + ' ' + tcs.fontFamily;
  const mm = cv.measureText('\\u56fd');
  const glyphBox = mm.actualBoundingBoxAscent + mm.actualBoundingBoxDescent;
  const expectH = (N - 1) * lh + glyphBox;   // (N-1) x 行框 + 字形盒 = N x 行框 - 13

  let imgHs = [], imgWs = [], floatRight = 0, firstChild = 0, fullSample = 0, narrowBad = 0, fullBad = 0;
  for (const img of imgs) {
    const b = img.getBoundingClientRect();
    imgHs.push(b.height); imgWs.push(b.width);
    if (getComputedStyle(img).float === 'right') floatRight++;
    const ac = img.parentElement;
    if (ac && ac.firstElementChild === img) firstChild++;
    // 正文行框：取 .article-text 文本节点的逐行 rect
    const p = ac && ac.querySelector('.article-text');
    if (!p) continue;
    const tn = [...p.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    if (!tn) continue;
    const rg = document.createRange();
    rg.selectNodeContents(tn);
    const rects = [...rg.getClientRects()];
    const acB = ac.getBoundingClientRect();
    const floatBottom = b.top + b.height;                       // 浮动底边（视口坐标，与 rects 同空间）
    let narrowMaxRight = 0, belowMaxRight = 0, hasNarrow = false, hasBelow = false, lines = rects.length;
    if (lines >= 4) {
      fullSample++;
      rects.forEach((rc) => {
        if (rc.bottom <= floatBottom + 2) {                     // 浮动右侧的窄行：右缘被「容器右 − 图宽 − 间距」限制
          hasNarrow = true;
          narrowMaxRight = Math.max(narrowMaxRight, rc.right);
        } else if (rc.top >= floatBottom - 2) {                 // 浮动下方的整宽行：右缘不受浮动约束
          hasBelow = true;
          belowMaxRight = Math.max(belowMaxRight, rc.right);
        }
      });
    }
    // ⑦ 顶部确有「窄列」（前 N 行被图挤窄）：窄列最右明显小于整列右缘
    if (hasNarrow && narrowMaxRight > acB.right - 25) narrowBad++;
    // ⑧ 第 N+1 行起回落全宽：存在浮动下方的行，且其最右明显宽于窄列（有「窄→宽」过渡即说明已解 BFC）
    if (!(hasBelow && (belowMaxRight - narrowMaxRight) >= 25)) fullBad++;
  }
  const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
  return {
    z2m: !!document.getElementById('z2m-style'),
    cardCount: imgs.length,
    glyphBox: Math.round(glyphBox * 10) / 10,
    expectH: Math.round(expectH * 10) / 10,
    avgImgH: Math.round(avg(imgHs) * 10) / 10,
    avgImgW: Math.round(avg(imgWs) * 10) / 10,
    floatRight, firstChild,
    fullSample, narrowBad, fullBad
  };
})())`;

(async () => {
  const code = fs.readFileSync(SCRIPT, 'utf8');
  console.log('脚本: ' + SCRIPT.split(/[\\/]/).pop() + '  [' + (INJECT_MODE ? '注入模式' : '已安装版本') + ']');
  const api = await cdp.browserApi();
  try {
    let tab = await cdp.findTab(api, 'zhihu.com/column-square');
    if (!tab) {
      console.log('未找到专栏广场标签，新开一个……');
      tab = await cdp.openTab(api, TAB_URL).then(() => cdp.sleep(1200)).then(async () => cdp.findTab(api, 'zhihu.com/column-square'));
      if (!tab) throw new Error('专栏广场标签打不开');
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
    if (!d || d.err) { console.log('FAIL  前置：拿不到推荐专栏列表 ' + JSON.stringify(d)); process.exit(1); }
    console.log(`带图卡片 ${d.cardCount}  字形盒 ${d.glyphBox}  期望图高 ${d.expectH}  实测均高 ${d.avgImgH}  均宽 ${d.avgImgW}  float:right ${d.floatRight}/${d.cardCount}  首位子元素 ${d.firstChild}/${d.cardCount}  够长样本 ${d.fullSample}  窄列坏 ${d.narrowBad}  整宽坏 ${d.fullBad}`);

    ok(d.z2m, '① 脚本样式已注入（#z2m-style 存在）');
    ok(d.cardCount > 0, '② 页面有带图推荐卡片', d.cardCount);
    ok(Math.abs(d.avgImgH - d.expectH) <= 3, '③ 图片高度 = 3 行字形盒高(±3px)', { expect: d.expectH, got: d.avgImgH });
    ok(d.floatRight === d.cardCount, '④ 图片全部 float:right', { right: d.floatRight, total: d.cardCount });
    ok(d.firstChild === d.cardCount, '⑤ 图片全部为 .article-content 首个子元素（DOM 重排，区别于沉底坏情况）', { first: d.firstChild, total: d.cardCount });
    ok(d.fullSample > 0, '⑥ 存在 ≥4 行正文的带图卡片（可验证绕排）', d.fullSample);
    ok(d.narrowBad === 0, '⑦ 前 3 行在图片右侧呈窄列（未被整宽挤占）', d.narrowBad);
    ok(d.fullBad === 0, '⑧ 第 4 行起回到接近整列宽（解 BFC 回落全宽）', d.fullBad);
  } finally {
    try { await api.close(); } catch (e) {}
  }
  console.log(`\n结果: ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
