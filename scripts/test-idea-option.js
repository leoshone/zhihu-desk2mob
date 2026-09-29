// test-idea-option.js — 验证「隐藏发布框里的『同时发布到想法』选项」
// 用法: node test-idea-option.js             重载页面并注入 src 下脚本（快速迭代）
//       node test-idea-option.js --installed  不注入，测真机暴力猴里已安装的版本
//
// 关键前置事实（实测得出）：「同时发布到想法」这个选项**只在评论输入框获得焦点后**
// 才会渲染出来（未聚焦时 DOM 里根本没有它）。所以基线测量必须先点进输入框。
//
// 断言：选项连同 radio 图标被隐藏；发布框高度明显下降；「发布」按钮未被误伤。
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const cdp = require('./cdp');

const SCRIPT = path.join(__dirname, '..', 'src', 'zhihu-desk2mob.user.js');
const INJECT_MODE = process.argv[2] !== '--installed';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

// 点进评论输入框，让「同时发布到想法」渲染出来
const FOCUS = `JSON.stringify((()=>{
  const eds = [...document.querySelectorAll('[contenteditable="true"]')];
  if (!eds.length) return { err: 'no contenteditable' };
  const e = eds[eds.length - 1];
  e.scrollIntoView({ block: 'center' });
  e.focus(); e.click();
  return { focused: document.activeElement === e, count: eds.length };
})())`;

const ST = `JSON.stringify((()=>{
  const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
  const strip = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, '');
  const Q = '同时发布到想法';
  const rect = el => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  let leaf = null, box = null;
  try {
    const snap = document.evaluate("//*[contains(., '" + Q + "')]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < snap.snapshotLength; i++) { const el = snap.snapshotItem(i); if (strip(el.textContent) === Q) leaf = el; }
    if (leaf) { box = leaf; while (box.parentElement && strip(box.parentElement.textContent).replace(Q, '') === '') box = box.parentElement; }
  } catch (e) {}
  const styleOf = el => { if (!el) return null; const cs = getComputedStyle(el); return { disp: cs.display, rect: rect(el) }; };
  // 发布框（聚焦态下的 composer 行）：含「理性发言」的最近祖先
  let outer = leaf;
  while (outer && outer !== document.body && !norm(outer.innerText).includes('理性发言')) outer = outer.parentElement;
  const btn = [...document.querySelectorAll('button')].find(b => norm(b.innerText) === '发布');
  const ed = [...document.querySelectorAll('[contenteditable="true"]')].pop();
  const vw = Math.round(document.body.getBoundingClientRect().width);
  const br = btn ? btn.getBoundingClientRect() : null;
  return {
    z2m: !!document.getElementById('z2m-style'),
    viewportW: vw,
    optionExists: !!leaf,
    optionBox: styleOf(box),
    optionLeafRect: leaf ? rect(leaf) : null,
    outerRect: outer && outer !== document.body ? rect(outer) : null,
    publishBtn: styleOf(btn),
    publishVisibleW: br ? Math.round(Math.max(0, Math.min(br.right, vw) - Math.max(br.left, 0))) : null,
    publishRightOverflow: br ? Math.round(br.right - vw) : null,
    editableFocused: document.activeElement === ed,
    insideMain: leaf ? !!leaf.closest('main') : null,
  };
})())`;

(async () => {
  const code = fs.readFileSync(SCRIPT, 'utf8');
  console.log('脚本: ' + SCRIPT + '  (' + code.split('\n').length + ' 行)  [' + (INJECT_MODE ? '注入模式' : '已安装版本') + ']');
  const api = await cdp.browserApi();
  try {
    const src = await cdp.findTab(api, 'zhuanlan.zhihu.com') || await cdp.findTab(api);
    if (!src) throw new Error('未找到知乎专栏页标签，请先在真机打开一篇专栏文章');
    const sid = await cdp.attach(api, src.targetId);
    const run = e => cdp.evalJson(api, e, sid);

    console.log('\n[准备] 重载专栏页' + (INJECT_MODE ? '（稍后注入脚本）' : '（脚本已实装）'));
    await api.send('Page.navigate', { url: src.url }, sid);
    await cdp.waitReady(api, sid, 30);
    await cdp.sleep(3500);

    console.log('[基线] 点进评论输入框，让选项渲染出来');
    console.log('  聚焦 -> ' + JSON.stringify(await run(FOCUS)));
    await cdp.sleep(2500);
    const base = await run(ST);
    const baseH = base.outerRect ? base.outerRect[3] : 0;
    console.log('  基线: 选项存在=' + base.optionExists + ' 选项包裹层=' + JSON.stringify(base.optionBox) +
      ' 文案尺寸=' + JSON.stringify(base.optionLeafRect) + ' 发布框高=' + baseH +
      ' 发布按钮=' + JSON.stringify(base.publishBtn && base.publishBtn.rect) +
      ' 选项在 main 内=' + base.insideMain);
    ok(base.optionExists, '聚焦后「同时发布到想法」选项确实存在');
    ok(!!base.publishBtn && base.publishBtn.disp !== 'none', '基线中「发布」按钮存在');

    if (INJECT_MODE) {
      const r = await cdp.evalJs(api, `(()=>{ try { ${code}\n; return 'injected'; } catch(e){ return 'ERR:' + e.message; } })()`, sid);
      console.log('\n注入 -> ' + JSON.stringify(r && r.value));
      await cdp.sleep(2000);
    } else {
      console.log('\n（已安装版本，等待脚本处理）');
      await cdp.sleep(2000);
    }

    // 脚本隐藏后会改变布局，重新聚焦一次保持聚焦态
    await run(FOCUS);
    await cdp.sleep(1500);
    const after = await run(ST);
    const afterH = after.outerRect ? after.outerRect[3] : 0;
    console.log('\n  应用后: 选项存在=' + after.optionExists + ' 包裹层=' + JSON.stringify(after.optionBox) +
      ' 发布框高=' + afterH + ' 发布按钮=' + JSON.stringify(after.publishBtn && after.publishBtn.rect));

    ok(after.z2m, '脚本已生效（#z2m-style 存在）', after.z2m);
    ok(after.optionExists && after.optionBox && after.optionBox.disp === 'none',
      '「同时发布到想法」已被隐藏（包裹层 display:none）', after.optionBox);
    // 注意：若真机上已装本版脚本，则「基线」也已是修复态（注入前脚本就在跑），
    // 此时没有可比对象，改为断言绝对值。参考：修复前实测 185px，修复后 94px。
    const baseAlreadyFixed = !!(base.optionBox && base.optionBox.disp === 'none');
    if (!baseAlreadyFixed) {
      ok(afterH > 0 && afterH < baseH, '发布框高度明显下降（' + baseH + 'px -> ' + afterH + 'px）', { before: baseH, after: afterH });
    } else {
      ok(afterH > 0 && afterH <= 130, '发布框保持紧凑高度（实测 ' + afterH + 'px ≤ 130px；基线已为修复态）', afterH);
    }
    ok(!!after.publishBtn && after.publishBtn.disp !== 'none' && after.publishBtn.rect[3] > 0,
      '「发布」按钮未被误伤，仍可见', after.publishBtn);
    // 「发布」按钮必须完整落在屏幕内（修复前 62px 只露出 42px、右溢 20px）
    ok(after.publishRightOverflow !== null && after.publishRightOverflow <= 0,
      '「发布」按钮完整落在屏幕内（右溢 ' + after.publishRightOverflow + 'px，可见 ' +
      after.publishVisibleW + '/' + (after.publishBtn && after.publishBtn.rect[2]) + 'px）',
      { overflow: after.publishRightOverflow, visible: after.publishVisibleW });

    await api.send('Page.bringToFront', {}, sid);
    execSync('adb exec-out screencap -p > "D:/AiSpaces/Work/2026-09-29-10-18-12/shots/15-idea-option-after.png"', { shell: 'bash' });
    console.log('\n截图: shots/15-idea-option-after.png');
    console.log('\n===== 结果: ' + pass + ' passed / ' + fail + ' failed =====');
    process.exitCode = fail ? 1 : 0;
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
