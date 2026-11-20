// test-reco-carousel.js — 验证「专栏文章底部『推荐阅读』横滑轮播：第一张对齐正文、其余右滑可见」
// 用法: node test-reco-carousel.js             重载文章页并注入 src 下脚本
//       node test-reco-carousel.js --installed 测真机暴力猴里已安装的版本
//
// 背景：文章底部「推荐阅读」是桌面横滑轮播（.Recommendations-List 为 display:flex +
//       justify-content:center）。4 张卡片总宽远超窄列时，居中对齐按「unsafe」规则向两端
//       等量溢出 —— 实测第一张 offsetLeft≈-427，几乎完全落到屏幕左边外，再被外层
//       .Recommendations-Main 的 overflow-x:hidden 裁掉（用户看到「第一个方块被挡住」）。
//       桌面的 PagingButton 翻页箭头也随之跑到屏幕外。
//       修法（v1.4.14，纯 CSS、稳定语义类名）：列表改 justify-content:flex-start + overflow-x:auto，
//       隐藏 PagingButton，去掉标题负 margin，卡片 transform 归位。
// 断言：① 找到「推荐阅读」卡片行（≥3 张卡）；
//       ② 第一张卡片左缘与正文左内缩一致、不顶手机边缘（|第一张左缘 − 正文左内缩| ≤ 6 ——
//          正文左内缩动态取正文段落文字左缘的众数，实测 ~20px；改前第一张在 0，必 FAIL）；
//       ③ 列表可横向滑动（overflow-x==auto 且 scrollWidth>clientWidth —— 改前 overflow-x:visible，必 FAIL）；
//       ④ 桌面翻页箭头已隐藏（.PagingButton 全 display:none —— 改前可见，必 FAIL）；
//       ⑤ 其余卡片确实溢出到右侧、可滑出（最后一张右缘 > 列表右缘）；
//       ⑥ 「推荐阅读」标题文字左缘也与正文左内缩一致（|标题文字左缘 − 正文左内缩| ≤ 6 —— 改前在 0，必 FAIL）。
'use strict';
const fs = require('fs');
const path = require('path');
const cdp = require('./cdp');

const SCRIPT = path.join(__dirname, '..', 'zhihu-desk2mob.user.js');
const INJECT_MODE = process.argv[2] !== '--installed';
const TAB_RE = 'zhuanlan.zhihu.com/p/';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const ST = `JSON.stringify((()=>{
  const list = document.querySelector('.Recommendations-List');
  if (!list) return { found:false };
  const lr = list.getBoundingClientRect();
  const cs = getComputedStyle(list);
  const cards = [...list.querySelectorAll('.PostItem')];
  const btns = [...list.querySelectorAll('.PagingButton')];
  const heading = document.querySelector('.Recommendations-BlockTitle');
  const first = cards[0] ? cards[0].getBoundingClientRect() : null;
  const last  = cards.length ? cards[cards.length-1].getBoundingClientRect() : null;
  const btnDisplays = btns.map(b => getComputedStyle(b).display);
  // 正文左内缩：取正文段落文字左缘的众数（四舍五入到 5px）；无正文则退 20
  function textLeft(el){ try{ const rg=document.createRange(); rg.selectNodeContents(el);
      const rs=rg.getClientRects(); for(const rr of rs){ if(rr.width>2) return Math.round(rr.left); } }catch(e){}
    const r=el.getBoundingClientRect(); return Math.round(r.left); }
  const ps=[...document.querySelectorAll('.Post-content .RichText p, .Post-content p')]
    .filter(p=>((p.textContent||'').replace(/\\s+/g,'').length)>=6);
  const hist={}; for(const p of ps){ const k=Math.round(textLeft(p)/5)*5; hist[k]=(hist[k]||0)+1; }
  const srt=Object.entries(hist).sort((a,b)=>b[1]-a[1]);
  const bodyInset = srt.length ? parseInt(srt[0][0]) : 20;
  const headingTextLeft = heading ? textLeft(heading) : null;
  return {
    found:true,
    cardCount: cards.length,
    listLeft: Math.round(lr.left), listRight: Math.round(lr.right),
    clientW: list.clientWidth, scrollW: list.scrollWidth,
    overflowX: cs.overflowX, justifyContent: cs.justifyContent,
    bodyInset,
    firstCardLeft: first ? Math.round(first.left) : null,
    headingTextLeft,
    lastCardDeltaRight: last ? Math.round(last.right - lr.right) : null,
    btnCount: btns.length, btnDisplays
  };
})())`;

(async () => {
  const code = fs.readFileSync(SCRIPT, 'utf8');
  console.log('脚本: ' + SCRIPT.split(/[\\/]/).pop() + '  [' + (INJECT_MODE ? '注入模式' : '已安装版本') + ']');
  const api = await cdp.browserApi();
  try {
    let tab = await cdp.findTab(api, TAB_RE);
    if (!tab) throw new Error('未找到专栏文章页标签（请先开一个 zhuanlan.zhihu.com/p/... 标签）');
    const sid = await cdp.attach(api, tab.targetId);
    await api.send('Page.navigate', { url: tab.url }, sid);
    await cdp.waitReady(api, sid, 30);
    await cdp.sleep(3500);
    // 滚到底部触发懒加载（推荐阅读在文章末尾）
    await cdp.evalJs(api, `(()=>{window.scrollTo(0, document.body.scrollHeight);return 1;})()`, sid).catch(()=>{});
    await cdp.sleep(2500);
    if (INJECT_MODE) {
      const r = await cdp.evalJs(api, `(()=>{ try { ${code}\n; return 'injected'; } catch(e){ return 'ERR:' + e.message; } })()`, sid);
      console.log('注入 -> ' + JSON.stringify(r && r.value));
      await cdp.sleep(2000);
    }
    const d = await cdp.evalJson(api, ST, sid);
    if (!d || !d.found) { console.log('FAIL  未找到 .Recommendations-List（页面未加载到「推荐阅读」？）'); process.exit(1); }
    console.log('几何: ' + JSON.stringify(d));

    ok(d.cardCount >= 3, `① 找到「推荐阅读」卡片行（${d.cardCount} 张）`, { cardCount: d.cardCount });
    const cardErr = (d.firstCardLeft != null) ? Math.abs(d.firstCardLeft - d.bodyInset) : 999;
    ok(d.firstCardLeft != null && cardErr <= 6,
      `② 第一张卡片左缘与正文左内缩一致、不顶边（第一张 ${d.firstCardLeft}px vs 正文 ${d.bodyInset}px，误差 ${cardErr}px ≤ 6）`,
      { firstCardLeft: d.firstCardLeft, bodyInset: d.bodyInset });
    ok(d.overflowX === 'auto' && d.scrollW > d.clientW + 4,
      `③ 列表可横向滑动（overflowX=${d.overflowX}, scrollW=${d.scrollW} > clientW=${d.clientW}）`, { overflowX: d.overflowX, scrollW: d.scrollW, clientW: d.clientW });
    ok(d.btnCount > 0 && d.btnDisplays.every(x => x === 'none'),
      `④ 桌面翻页箭头已隐藏（${d.btnCount} 个 .PagingButton 全 display:none）`, { btnCount: d.btnCount, btnDisplays: d.btnDisplays });
    ok(d.lastCardDeltaRight != null && d.lastCardDeltaRight > 4,
      `⑤ 其余卡片溢出到右侧、可滑出（最后一张右缘超列表右缘 ${d.lastCardDeltaRight}px）`, { lastCardDeltaRight: d.lastCardDeltaRight });
    const headErr = (d.headingTextLeft != null) ? Math.abs(d.headingTextLeft - d.bodyInset) : 999;
    ok(d.headingTextLeft != null && headErr <= 6,
      `⑥ 「推荐阅读」标题文字左缘与正文左内缩一致（标题 ${d.headingTextLeft}px vs 正文 ${d.bodyInset}px，误差 ${headErr}px ≤ 6）`,
      { headingTextLeft: d.headingTextLeft, bodyInset: d.bodyInset });
  } finally {
    try { await api.close(); } catch (e) {}
  }
  console.log(`\n结果: ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
