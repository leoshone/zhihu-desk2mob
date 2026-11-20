// test-comment-back.js — 真机端到端测试：评论弹层「返回键关闭」与「溢出定位修正」
// 用法:
//   node test-comment-back.js              重载页面并注入 src 下待测脚本（快速迭代）
//   node test-comment-back.js --installed  不注入，测真机暴力猴里已安装的版本（最接近真实使用）
//
// 四轮场景：
//   轮1 打开弹层 → 返回键关闭        哨兵压入 / 返回被消费 / 关层 / 落回原始条目
//   轮2 打开弹层 → Escape 关闭        哨兵应被主动撤回，不留残余
//   轮3 打开弹层 → 点原生关闭按钮关闭   同上
//   轮4 关闭后再次打开 → 返回键仍可关闭  验证守卫可重复使用
// 另断言定位修正：卡片不超出容器宽度，且卡片顶部与容器顶部对齐。
//
// 注意（踩过的坑）：
//  · 知乎答案列表是虚拟化的，「N 条评论」按钮会随滚动增删；必须选「当前在视口内」的
//    那个按钮并轮询确认弹层是否真的打开，否则测试会假失败。
//  · 不能用 history.length 判断哨兵是否生效：pushState 会截断前进项，back() 也不会让
//    length 减少。history.state 上的标记才是权威判据。
'use strict';
const fs = require('fs');
const path = require('path');
const cdp = require('./cdp');

const SCRIPT = path.join(__dirname, '..', 'zhihu-desk2mob.user.js');
const INJECT_MODE = process.argv[2] !== '--installed';
const DOMAIN = '/answer/';
// 设备上若没有回答页标签就自动开这一个（回答页才走弹层；首页是内联展开）
const FALLBACK_ANSWER = 'https://www.zhihu.com/question/2087120107130598179/answer/2087228487664920091';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const ST = `JSON.stringify((()=>{
  const mc = document.querySelector('.Modal-content');
  let layer = null, card = null;
  if (mc) {
    let n = mc;
    while (n && n !== document.body) { const cs = getComputedStyle(n); if (cs.position === 'fixed' && (parseInt(cs.zIndex,10)||0) >= 50) { layer = n; break; } n = n.parentElement; }
    let c = mc.parentElement;
    while (c && c !== layer && c !== document.body) { if (getComputedStyle(c).maxHeight !== 'none') break; c = c.parentElement; }
    card = (c && c !== layer && c !== document.body) ? c : null;
  }
  const rect = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  return {
    open: !!mc, histLen: history.length, histState: history.state,
    z2mStyle: !!document.getElementById('z2m-style'),
    hasCloseBtn: !!document.querySelector('[aria-label="关闭"]'),
    layer: layer ? rect(layer) : null, card: card ? rect(card) : null,
    layerJustify: layer ? getComputedStyle(layer).justifyContent : null,
  };
})())`;

// 点击「当前在视口内、离中心最近的」N 条评论按钮；rot 用于重试时错开候选
const CLICK_NEAREST = rot => `JSON.stringify((()=>{
  const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
  // 可见高度必须换算成 CSS px：rect 是 CSS px，而 innerHeight 是布局 px（两者差一个 html{zoom}）。
  // 不换算的话，zoom 大时该判断恒真（等于没过滤）、zoom 小时又会把候选全滤掉。
  const vh = Math.round((window.visualViewport ? visualViewport.height : window.innerHeight) / (parseFloat(document.documentElement.style.zoom) || 1));
  const cands = [...document.querySelectorAll('button')]
    .filter(el => /条评论/.test(norm(el.innerText)))
    .map(el => { const r = el.getBoundingClientRect(); return { el, top: r.top, inView: r.top >= 0 && r.top <= vh }; })
    // 刻意**不**按 inView 过滤：JS .click() 对不在视口内的元素同样有效，
    // 过滤掉反而会在虚拟化列表换节点的瞬间把候选丢成 0（实测就是这么假失败的）。
    // 这里只用它排序，优先点视口中心附近的。
    .sort((a, b) => Math.abs(a.top - vh / 2) - Math.abs(b.top - vh / 2));
  const c = cands[${rot} % Math.max(1, cands.length)];
  if (!c) return { err: 'no in-view comment button', total: cands.length };
  const before = norm(c.el.innerText);
  c.el.click();
  return { before, cls: (c.el.className || '').toString().slice(0, 40), inView: cands.length };
})())`;

// 只点「回答卡片」里的评论按钮（ContentItem-action）——对应大卡弹层（会溢出）
const CLICK_ANSWER = rot => `JSON.stringify((()=>{
  const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
  // 可见高度必须换算成 CSS px：rect 是 CSS px，而 innerHeight 是布局 px（两者差一个 html{zoom}）。
  // 不换算的话，zoom 大时该判断恒真（等于没过滤）、zoom 小时又会把候选全滤掉。
  const vh = Math.round((window.visualViewport ? visualViewport.height : window.innerHeight) / (parseFloat(document.documentElement.style.zoom) || 1));
  const cands = [...document.querySelectorAll('button')]
    .filter(el => /(^|\\s)ContentItem-action(\\s|$)/.test((el.className||'').toString()) && /条评论/.test(norm(el.innerText)))
    .map(el => { const r = el.getBoundingClientRect(); return { el, top: r.top, inView: r.top >= 0 && r.top <= vh }; })
    // 刻意**不**按 inView 过滤：JS .click() 对不在视口内的元素同样有效，
    // 过滤掉反而会在虚拟化列表换节点的瞬间把候选丢成 0（实测就是这么假失败的）。
    // 这里只用它排序，优先点视口中心附近的。
    .sort((a, b) => Math.abs(a.top - vh / 2) - Math.abs(b.top - vh / 2));
  const c = cands[${rot} % Math.max(1, cands.length)];
  if (!c) return { err: 'no in-view answer comment button', total: cands.length };
  const before = norm(c.el.innerText);
  c.el.click();
  return { before, cls: (c.el.className || '').toString().slice(0, 40), inView: cands.length };
})())`;

const TOP = `JSON.stringify((()=>{ window.scrollTo(0,0); return 'top'; })())`;
const CLOSE_BTN = `JSON.stringify((()=>{ const b = document.querySelector('[aria-label="关闭"]'); if (!b) return 'no btn'; b.click(); return 'clicked'; })())`;
const ESCAPE = `JSON.stringify((()=>{ const t=document.activeElement||document.body; const ev=new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true}); t.dispatchEvent(ev); document.dispatchEvent(ev); return 'esc'; })())`;
const GO_BACK = `JSON.stringify((()=>{ history.back(); return 'back'; })())`;

let api, sid;
const run = e => cdp.evalJson(api, e, sid);

// 稳定地打开评论弹层：滚到顶 → 逐个尝试视口内的候选按钮 → 轮询确认弹层出现
// 把第一个「回答卡片」的评论按钮滚进视口中央（知乎答案列表虚拟化，必须先滚到位）
const SCROLL_ANSWER_BTN = `JSON.stringify((()=>{
  const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
  const els = [...document.querySelectorAll('button')]
    .filter(el => /(^|\\s)ContentItem-action(\\s|$)/.test((el.className||'').toString()) && /条评论/.test(norm(el.innerText)));
  if (!els.length) return { err: 'no answer comment button' };
  els[0].scrollIntoView({ block: 'center' });
  return { scrolledTo: norm(els[0].innerText), total: els.length };
})())`;

// 统计「当前在视口内」的评论按钮数量（不限是不是回答卡片）
const COUNT_INVIEW_ALL = `JSON.stringify((()=>{
  const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
  const zoom = parseFloat(document.documentElement.style.zoom) || 1;
  const vh = Math.round(((window.visualViewport ? visualViewport.height : window.innerHeight)) / zoom);
  const n = [...document.querySelectorAll('button')]
    .filter(el => /条评论/.test(norm(el.innerText)))
    .filter(el => { const t = el.getBoundingClientRect().top; return t >= 0 && t <= vh; }).length;
  return { inView: n, scrollY: Math.round(window.scrollY) };
})())`;

// 统计「回答卡片里、当前在视口内」的评论按钮数量
const COUNT_INVIEW_ANSWER = `JSON.stringify((()=>{
  const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
  // 可见高度必须换算成 CSS px：rect 是 CSS px，而 innerHeight 是布局 px（两者差一个 html{zoom}）。
  // 不换算的话，zoom 大时该判断恒真（等于没过滤）、zoom 小时又会把候选全滤掉。
  const vh = Math.round((window.visualViewport ? visualViewport.height : window.innerHeight) / (parseFloat(document.documentElement.style.zoom) || 1));
  const n = [...document.querySelectorAll('button')]
    .filter(el => /(^|\\s)ContentItem-action(\\s|$)/.test((el.className||'').toString()) && /条评论/.test(norm(el.innerText)))
    .filter(el => { const t = el.getBoundingClientRect().top; return t >= 0 && t <= vh; }).length;
  return { inView: n, scrollY: Math.round(window.scrollY) };
})())`;

// 虚拟化列表：按固定偏移逐档扫描，先滚到「视口内有评论按钮」的位置再点。
// 这段原先只有 answer 路径有；普通路径靠的是一个**单位写错、因而恒真**的 inView 判断
// （rect 是 CSS px、innerHeight 是布局 px），等于没过滤才碰巧能点到。单位修正后
// 过滤真的生效了，就必须先滚到位 —— 否则全新标签页在滚动到顶时视口内确实一个按钮都没有。
async function scrollUntilBtnInView(picker) {
  const COUNT = picker === 'answer' ? COUNT_INVIEW_ANSWER : COUNT_INVIEW_ALL;
  for (const off of [0, 300, 600, 900, 1300, 1700, 2200, 2800, 3400, 4200, 5000]) {
    await run(`JSON.stringify((()=>{ window.scrollTo(0, ${off}); return ${off}; })())`);
    await cdp.sleep(900);
    const p = await run(COUNT);
    if (p.inView > 0) return { off, ...p };
  }
  return null;
}

async function openModal(kind) {
  await run(TOP);
  await cdp.sleep(1500);
  const clickExpr = kind === 'answer' ? CLICK_ANSWER : CLICK_NEAREST;
  // 先滚到「视口内有可点按钮」的位置（虚拟化列表必须先滚到位，见上）
  const hitAt = await scrollUntilBtnInView(kind);
  console.log('    滚动扫描 -> ' + JSON.stringify(hitAt || { inView: 0 }));
  for (let rot = 0; rot < 8; rot++) {
    const r = await run(clickExpr(rot));
    for (let i = 0; i < 12; i++) {
      await cdp.sleep(220);
      const s = await run(ST);
      if (s.open) return { ok: true, clicked: r, state: s };
    }
    await cdp.sleep(300);
  }
  return { ok: false, clicked: null, state: await run(ST) };
}
async function waitClosed(ms = 3500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const s = await run(ST); if (!s.open) return s; await cdp.sleep(200); }
  return await run(ST);
}

(async () => {
  const code = fs.readFileSync(SCRIPT, 'utf8');
  console.log('脚本: ' + SCRIPT + '  (' + code.split('\n').length + ' 行)  [' + (INJECT_MODE ? '注入模式' : '已安装版本') + ']');
  api = await cdp.browserApi();
  let freshTabId = null;
  try {
    // 关键：在「全新标签页」里测。同一标签页反复跑测试会在会话历史里累积哨兵条目，
    // 使 history.state 基线不可信（曾因此产生大量假失败）。
    // 而且**必须**是回答页：首页的「N 条评论」是内联展开、不开弹层，
    // 若静默回退到首页，每一轮都会以「点不到/弹层没开」假失败（今天就这样白排查了一轮）。
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
    ok(s0.z2mStyle, '脚本已生效（#z2m-style 存在）', s0);
    ok(!s0.open, '起点：评论弹层关闭');
    const BASE_STATE = s0.histState;
    const isSentinel = v => !!(v && v.z2mComment === 1);
    console.log('  基线 history.length=' + s0.histLen + ' state=' + JSON.stringify(BASE_STATE));

    // ---- 轮1：打开 → 返回键关闭 ----
    console.log('\n[轮1] 打开弹层 → 返回键关闭');
    const r1 = await openModal();
    ok(r1.ok, '弹层已打开（点到的按钮：' + (r1.clicked && r1.clicked.before) + '）', r1.state);
    const o1 = r1.state;
    ok(isSentinel(o1.histState), '打开时压入了哨兵历史（history.state.z2mComment=1）', o1.histState);
    // 定位修正的不变式：修完之后卡片不得再「比容器大」到被裁切/顶部不可达。
    // 注意知乎有两种评论弹层：整屏大卡（688×1832，必然溢出）与刚好铺满的小卡（393×773，不溢出）。
    // 小卡本来就不溢出，此时不做任何改动才是正确行为，因此按是否溢出分支断言。
    if (o1.layer && o1.card) {
      ok(o1.card.w <= o1.layer.w + 1, '卡片宽度不超出容器（右侧不再被裁切）', { card: o1.card, layer: o1.layer });
      if (o1.card.h > o1.layer.h + 1) {
        ok(o1.layerJustify === 'flex-start', '卡片高于容器 → 容器已改为顶部对齐', o1.layerJustify);
        ok(Math.abs(o1.card.y - o1.layer.y) <= 2, '卡片顶部与容器顶部对齐（不再上移）', { card: o1.card, layer: o1.layer });
      } else {
        ok(o1.layerJustify === 'center', '卡片未高于容器 → 保持知乎原有居中（不做多余改动）', o1.layerJustify);
      }
    } else { ok(false, '未定位到容器/卡片', o1); }

    await run(GO_BACK);
    const b1 = await waitClosed();
    ok(!b1.open, '返回键关闭了弹层', b1);
    ok(!isSentinel(b1.histState) && JSON.stringify(b1.histState) === JSON.stringify(BASE_STATE),
      '返回后落回原始历史条目（哨兵已被消费）', b1.histState);

    // ---- 轮2：打开 → Escape 关闭 ----
    console.log('\n[轮2] 打开弹层 → Escape 关闭（验证哨兵不残留）');
    const r2 = await openModal();
    ok(r2.ok, '弹层已打开', r2.state);
    ok(isSentinel(r2.state.histState), '哨兵已压入', r2.state.histState);
    await run(ESCAPE);
    const c2 = await waitClosed();
    ok(!c2.open, 'Escape 关闭了弹层', c2);
    ok(!isSentinel(c2.histState) && JSON.stringify(c2.histState) === JSON.stringify(BASE_STATE),
      '弹层被其它方式关闭后，哨兵被主动撤回并落回原始条目', c2.histState);

    // ---- 轮3：打开 → 原生关闭按钮关闭 ----
    console.log('\n[轮3] 打开弹层 → 原生「关闭」按钮关闭');
    const r3 = await openModal();
    ok(r3.ok, '弹层已打开', r3.state);
    ok(r3.state.hasCloseBtn, '原生「关闭」按钮存在', r3.state.hasCloseBtn);
    ok(isSentinel(r3.state.histState), '哨兵已压入', r3.state.histState);
    await run(CLOSE_BTN);
    const c3 = await waitClosed();
    ok(!c3.open, '原生关闭按钮关闭了弹层', c3);
    ok(!isSentinel(c3.histState) && JSON.stringify(c3.histState) === JSON.stringify(BASE_STATE),
      '哨兵被主动撤回并落回原始条目', c3.histState);

    // ---- 轮4：关闭后再打开，确认守卫可重复使用 ----
    console.log('\n[轮4] 关闭后再次打开 → 返回键仍可关闭');
    const r4 = await openModal();
    ok(r4.ok, '第二次打开弹层成功', r4.state);
    ok(isSentinel(r4.state.histState), '哨兵再次压入', r4.state.histState);
    await run(GO_BACK);
    const b4 = await waitClosed();
    ok(!b4.open, '返回键再次关闭了弹层', b4);

    // ---- 轮5：回答内评论（大卡，必然溢出）→ 定位修正 + 返回关闭 ----
    console.log('\n[轮5] 回答内「N 条评论」（大卡弹层）→ 定位修正 + 返回键关闭');
    const r5 = await openModal('answer');
    ok(r5.ok, '回答的评论弹层已打开（按钮：' + (r5.clicked && r5.clicked.before) + '）', r5.state);
    const o5 = r5.state;
    if (o5.layer && o5.card) {
      const overflowV = o5.card.h > o5.layer.h + 1;
      const overflowH = o5.card.w > o5.layer.w + 1;
      console.log('  卡片 ' + JSON.stringify(o5.card) + '  容器 ' + JSON.stringify(o5.layer) +
        '  垂直溢出=' + overflowV + ' 水平溢出=' + overflowH + ' justify=' + o5.layerJustify);
      ok(!overflowH, '修正后卡片宽度不超出容器（右侧不再被裁切）', { card: o5.card, layer: o5.layer });
      if (overflowV) {
        ok(o5.layerJustify === 'flex-start', '大卡高于容器 → 容器已改为顶部对齐', o5.layerJustify);
        ok(Math.abs(o5.card.y - o5.layer.y) <= 2, '大卡顶部与容器顶部对齐（顶部不再不可达）', { card: o5.card, layer: o5.layer });
      } else {
        console.log('  （该回答评论较少，卡片未溢出，此轮不覆盖溢出分支）');
      }
    } else { ok(false, '未定位到容器/卡片', o5); }
    await run(GO_BACK);
    const b5 = await waitClosed();
    ok(!b5.open, '返回键关闭了大卡弹层', b5);

    console.log('\n===== 结果: ' + pass + ' passed / ' + fail + ' failed =====');
    process.exitCode = fail ? 1 : 0;
  } finally {
    try { if (freshTabId) await api.send('Target.closeTarget', { targetId: freshTabId }); } catch (e) {}
    api.close();
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
