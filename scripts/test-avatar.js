// test-avatar.js — 验证「发布框头像不再被拉高」
// 用法: node test-avatar.js            重载页面并注入 src 下脚本
//       node test-avatar.js --installed 测真机暴力猴里已安装的版本
//
// 前置事实（实测）：
//  · 发布框那一行（头像 + 「发布」按钮）要先把评论弹层打开、并聚焦输入框才会渲染；
//  · 拉高的原因：脚本 v1.0.0 的通用规则 `img { height: auto !important }` 覆盖了知乎给
//    头像的固定高度，而头像父行是 stretch（align-items: normal），于是被拉到整行高。
//    关掉脚本 CSS 后头像是 40×40。
// 断言：发布框头像为正方形、且高度不超过 48px；同时发布框本身仍在正常位置。
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const cdp = require('./cdp');

const SCRIPT = path.join(__dirname, '..', 'src', 'zhihu-desk2mob.user.js');
const INJECT_MODE = process.argv[2] !== '--installed';
const TAB_SUBSTR = 'www.zhihu.com';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const ST = `JSON.stringify((()=>{
  const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
  const rect = el => { const b = el.getBoundingClientRect();
    return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const isAv = el => el.tagName === 'IMG' && /(^|\\s)Avatar(\\s|$)/.test((el.className||'').toString());
  const btn = [...document.querySelectorAll('button')].find(b => norm(b.innerText) === '发布');
  let row = btn, av = null;
  while (row && row !== document.body && !(av = [...row.querySelectorAll('img')].filter(isAv)[0])) row = row.parentElement;
  if (row === document.body) { row = null; av = null; }
  const all = [...document.querySelectorAll('img')].filter(isAv);
  const others = all.filter(i => i !== av);
  const tally = {};
  others.forEach(i => { const k = rect(i)[2] + '×' + rect(i)[3]; tally[k] = (tally[k] || 0) + 1; });
  // 评论列表头像里最常见的那一档尺寸 —— 就是「其他评论者的头像大小」
  let commonSize = null, bestN = -1;
  Object.keys(tally).forEach(k => { if (tally[k] > bestN) { bestN = tally[k]; commonSize = k; } });
  const cs = av ? getComputedStyle(av) : null;
  const bcs = btn ? getComputedStyle(btn) : null;
  return {
    z2m: !!document.getElementById('z2m-style'),
    publishExists: !!btn,
    composerAvatar: av ? rect(av) : null,
    avatarCss: cs ? { h: cs.height, w: cs.width, alignSelf: cs.alignSelf, objectFit: cs.objectFit } : null,
    composerRow: row ? rect(row) : null,
    listSizes: tally,
    commonAvatarSize: commonSize,
    publish: btn ? { rect: rect(btn), whiteSpace: bcs.whiteSpace } : null,
    modalOpen: !!document.querySelector('.Modal-content'),
  };
})())`;

const OPEN_MODAL = `JSON.stringify((()=>{
  const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
  const vh = window.innerHeight;
  const c = [...document.querySelectorAll('button')].filter(el => /条评论/.test(norm(el.innerText)))
    .map(el => ({ el, top: el.getBoundingClientRect().top }))
    .filter(x => x.top >= 0 && x.top <= vh)
    .sort((a, b) => Math.abs(a.top - vh / 2) - Math.abs(b.top - vh / 2))[0];
  if (!c) return { err: 'no in-view comment button' };
  const t = norm(c.el.innerText); c.el.click(); return { clicked: t };
})())`;

const FOCUS = `JSON.stringify((()=>{
  const eds = [...document.querySelectorAll('[contenteditable="true"]')];
  if (!eds.length) return { err: 'no contenteditable' };
  const e = eds[eds.length - 1];
  e.scrollIntoView({ block: 'center' }); e.focus(); e.click();
  return { focused: document.activeElement === e };
})())`;

let api, sid;
const run = e => cdp.evalJson(api, e, sid);

// 打开评论弹层 → 聚焦输入框 → 等发布框那一行渲染出来
async function prepareComposer() {
  await run(`JSON.stringify((()=>{ window.scrollTo(0, 0); return 1; })())`);
  await cdp.sleep(1500);
  for (let attempt = 0; attempt < 4; attempt++) {
    await run(OPEN_MODAL);
    await cdp.sleep(2500);
    await run(FOCUS);
    await cdp.sleep(2000);
    await run(FOCUS);
    await cdp.sleep(1200);
    const s = await run(ST);
    if (s.publishExists && s.composerAvatar) return { ok: true, state: s };
    // 弹层没开成就在不同滚动位置再试
    await run(`JSON.stringify((()=>{ window.scrollTo(0, ${400 + attempt * 600}); return 1; })())`);
    await cdp.sleep(1200);
  }
  return { ok: false, state: await run(ST) };
}

(async () => {
  const code = fs.readFileSync(SCRIPT, 'utf8');
  console.log('脚本: ' + SCRIPT + '  (' + code.split('\n').length + ' 行)  [' + (INJECT_MODE ? '注入模式' : '已安装版本') + ']');
  api = await cdp.browserApi();
  try {
    const src = await cdp.findTab(api, TAB_SUBSTR) || await cdp.findTab(api);
    if (!src) throw new Error('未找到 www.zhihu.com 标签，请先在真机打开一个回答页');
    sid = await cdp.attach(api, src.targetId);

    console.log('\n[准备] 重载页面' + (INJECT_MODE ? '并注入脚本' : '（等暴力猴注入）'));
    await api.send('Page.navigate', { url: src.url }, sid);
    await cdp.waitReady(api, sid, 30);
    await cdp.sleep(3500);
    if (INJECT_MODE) {
      const r = await cdp.evalJs(api, `(()=>{ try { ${code}\n; return 'injected'; } catch(e){ return 'ERR:' + e.message; } })()`, sid);
      console.log('  注入 -> ' + JSON.stringify(r && r.value));
      await cdp.sleep(1500);
    } else {
      await cdp.sleep(2000);
    }

    const prep = await prepareComposer();
    const s = prep.state;
    console.log('\n发布框头像: ' + JSON.stringify(s.composerAvatar) +
      '  css=' + JSON.stringify(s.avatarCss));
    console.log('发布框所在行: ' + JSON.stringify(s.composerRow) +
      '   弹层内=' + s.modalOpen);
    console.log('评论列表头像尺寸分布: ' + JSON.stringify(s.listSizes) +
      '  → 最常见档位 ' + s.commonAvatarSize);
    console.log('「发布」按钮: ' + JSON.stringify(s.publish));
    ok(s.z2m, '脚本已生效（#z2m-style 存在）', s.z2m);
    ok(prep.ok, '已打开评论弹层并聚焦，发布框那一行已渲染', { publishExists: s.publishExists, avatar: s.composerAvatar });

    if (s.composerAvatar) {
      const [x, y, w, h] = s.composerAvatar;
      ok(Math.abs(w - h) <= 2, '发布框头像是正方形（' + w + '×' + h + '）', s.composerAvatar);
      ok(h <= 48, '发布框头像高度未被拉高（' + h + 'px ≤ 48px）', s.composerAvatar);
      ok(h >= 16, '发布框头像没有被压扁（' + h + 'px ≥ 16px）', s.composerAvatar);
      // 用户的要求：与评论里其他人的头像一样大
      if (s.commonAvatarSize) {
        const cw = parseInt(s.commonAvatarSize.split('×')[0], 10);
        ok(Math.abs(w - cw) <= 2 && Math.abs(h - cw) <= 2,
          '发布框头像与评论列表头像同尺寸（' + w + '×' + h + ' vs 列表最常见 ' + s.commonAvatarSize + '）',
          { composer: s.composerAvatar, list: s.commonAvatarSize });
      }
    }

    // 弹层内的「发布」按钮：没被压成竖排（竖排时高度会明显大于宽度）
    if (s.publish) {
      const [, , pw, ph] = s.publish.rect;
      ok(s.publish.whiteSpace === 'nowrap', '「发布」按钮 white-space=nowrap（弹层内也生效）', s.publish.whiteSpace);
      ok(ph <= 40, '「发布」按钮未被压成竖排（' + pw + '×' + ph + '）', s.publish.rect);
    }

    const p = 'D:/AiSpaces/Work/2026-09-29-10-18-12/shots/19-avatar-after.png';
    await api.send('Page.bringToFront', {}, sid);
    execSync('adb exec-out screencap -p > "' + p + '"', { shell: 'bash' });
    console.log('\n截图: ' + p);
    console.log('\n===== 结果: ' + pass + ' passed / ' + fail + ' failed =====');
    process.exitCode = fail ? 1 : 0;
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
