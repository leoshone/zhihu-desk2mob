// test-modal-layout.js — 评论弹层「溢出定位修正」的受控夹具单元测试
//
// 为什么需要夹具：线上弹层的卡片高度取决于已加载的评论条数，垂直溢出分支时有时无，
// 无法稳定复现；而这两个分支（垂直居中致顶部不可达 / 卡片过宽致右侧裁切）是本脚本
// 的核心修正，必须可确定性地验证。这里人工构造出「卡片比容器大」的弹层结构，
// 调用脚本导出的 window.__z2mSync() 走真实修正逻辑，再断言结果。
//
// 用法: node test-modal-layout.js        （需真机上已安装 1.0.3 并打开过知乎页面）
'use strict';
const cdp = require('./cdp');

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

// 构造夹具：layer(position:fixed, z>=50, flex 垂直居中) > card(有限高) > .Modal-content
const MK_FIXTURE = (cardW, cardH) => `JSON.stringify((()=>{
  const old = document.getElementById('z2m-fixture'); if (old) old.remove();
  const layer = document.createElement('div');
  layer.id = 'z2m-fixture';
  layer.style.cssText = 'position:fixed;left:0;top:0;right:0;height:600px;z-index:9999;display:flex;flex-direction:column;' +
    'justify-content:center;overflow:hidden auto;box-sizing:border-box;';
  const card = document.createElement('div');
  // flex:0 0 auto 是关键：默认 flex-shrink:1 会把卡片压缩到容器高度，造不出溢出。
  // 知乎真实弹层的卡片靠 min-height:auto（内容固有高度）撑开，效果等价。
  card.style.cssText = 'position:relative;flex:0 0 auto;max-height:' + ${cardH} + 'px;height:' + ${cardH} + 'px;width:' + ${cardW} + 'px;';
  const mc = document.createElement('div');
  mc.className = 'Modal-content';
  mc.innerHTML = '<div class="CommentContent">夹具评论</div>';
  card.appendChild(mc); layer.appendChild(card);
  document.body.appendChild(layer);
  const lr = layer.getBoundingClientRect(), cr = card.getBoundingClientRect();
  return { layerW: Math.round(lr.width), layerH: Math.round(lr.height), cardW: Math.round(cr.width), cardH: Math.round(cr.height) };
})())`;

const SYNC = `JSON.stringify((()=>{
  const layer = document.getElementById('z2m-fixture');
  if (!layer) return { err: 'fixture gone' };
  const card = layer.firstElementChild;
  const mc = card.querySelector('.Modal-content');
  if (window.__z2mSync) window.__z2mSync();      // 走脚本真实的修正逻辑
  const lr = layer.getBoundingClientRect(), cr = card.getBoundingClientRect();
  return {
    layerJustify: getComputedStyle(layer).justifyContent,
    cardInlineMaxW: card.style.getPropertyValue('max-width'),
    cardInlineWidth: card.style.getPropertyValue('width'),
    layerRect: { x: Math.round(lr.left), y: Math.round(lr.top), w: Math.round(lr.width), h: Math.round(lr.height) },
    cardRect: { x: Math.round(cr.left), y: Math.round(cr.top), w: Math.round(cr.width), h: Math.round(cr.height) },
    mcPresent: !!mc,
  };
})())`;

const CLEAN = `JSON.stringify((()=>{ const f = document.getElementById('z2m-fixture'); if (f) f.remove(); return 'cleaned'; })())`;

(async () => {
  const api = await cdp.browserApi();
  let tabId = null;
  try {
    const src = await cdp.findTab(api, '/answer/') || await cdp.findTab(api);
    if (!src) throw new Error('未找到知乎页面标签');
    tabId = (await api.send('Target.createTarget', { url: src.url })).targetId;
    await cdp.sleep(3000);
    const sid = await cdp.attach(api, tabId);
    await cdp.waitReady(api, sid, 30);
    await cdp.sleep(3000);
    const run = e => cdp.evalJson(api, e, sid);

    const hasSync = await run(`JSON.stringify({ sync: typeof window.__z2mSync, style: !!document.getElementById('z2m-style') })`);
    ok(hasSync.style, '脚本已注入（#z2m-style 存在）', hasSync);
    if (!hasSync.style || hasSync.sync !== 'function') {
      console.log('\n  跳过：未检测到脚本（请在真机装好 1.0.3 后重试）');
      return;
    }

    // ---- 用例1：卡片高于且宽于容器（原始病态）----
    console.log('\n[用例1] 卡片 688×1500 / 容器 约393×600（垂直+水平双溢出）');
    console.log('  夹具 -> ' + JSON.stringify(await run(MK_FIXTURE(688, 1500))));
    const a = await run(SYNC);
    console.log('  修正后: ' + JSON.stringify(a));
    ok(a.layerJustify === 'flex-start', '容器由垂直居中改为顶部对齐（顶部不再被推到屏幕外）', a.layerJustify);
    ok(a.cardRect.y === a.layerRect.y, '卡片顶部与容器顶部对齐（原会被上移）', { card: a.cardRect, layer: a.layerRect });
    ok(a.cardRect.w <= a.layerRect.w + 1, '卡片宽度收进容器（右侧不再被裁切）', { card: a.cardRect, layer: a.layerRect });
    ok(a.cardInlineMaxW === '100%', '卡片已写入 max-width:100%', a.cardInlineMaxW);
    ok(a.mcPresent, '夹具的 .Modal-content 仍在（未误删内容）');
    await run(CLEAN);
    await cdp.sleep(600);

    // ---- 用例2：卡片只高不宽（验证垂直分支独立生效）----
    console.log('\n[用例2] 卡片 300×1500 / 容器 约393×600（只垂直溢出）');
    console.log('  夹具 -> ' + JSON.stringify(await run(MK_FIXTURE(300, 1500))));
    const b = await run(SYNC);
    console.log('  修正后: ' + JSON.stringify(b));
    ok(b.layerJustify === 'flex-start', '只垂直溢出时也改为顶部对齐', b.layerJustify);
    ok(b.cardRect.y === b.layerRect.y, '卡片顶部与容器顶部对齐', { card: b.cardRect, layer: b.layerRect });
    await run(CLEAN);
    await cdp.sleep(600);

    // ---- 用例3（否定用例）：卡片不溢出 → 不得改动 ----
    console.log('\n[用例3] 卡片 300×400 / 容器 约393×600（不溢出，应保持原样）');
    console.log('  夹具 -> ' + JSON.stringify(await run(MK_FIXTURE(300, 400))));
    const c = await run(SYNC);
    console.log('  修正后: ' + JSON.stringify(c));
    ok(c.layerJustify === 'center', '不溢出时保持知乎原有的垂直居中（不越权改动）', c.layerJustify);
    ok(c.cardInlineMaxW === '', '不溢出时未写入 max-width（保持原状）', c.cardInlineMaxW);
    await run(CLEAN);

    console.log('\n===== 结果: ' + pass + ' passed / ' + fail + ' failed =====');
    process.exitCode = fail ? 1 : 0;
  } finally {
    try { if (tabId) await api.send('Target.closeTarget', { targetId: tabId }); } catch (e) {}
    api.close();
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
