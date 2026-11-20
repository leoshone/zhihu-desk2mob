// test-question-actions.js — 验证「关注问题 / 写回答 / 邀请回答」三个按钮在同一行显示
// 用法: node test-question-actions.js             重载当前问题页并注入 src 下脚本
//       node test-question-actions.js --installed 测真机暴力猴里已安装的版本
//
// 背景（实测）：知乎把「关注问题 + 写回答」放在 .QuestionButtonGroup、
// 「邀请回答」单独放在 .QuestionHeaderActions —— 两个容器各自成块，桌面版靠并排排布，
// 到手机宽度就会上下堆叠：「邀请回答」被挤到第 2 行、和「好问题 / 评论」混在一起。
// 本脚本把 .QuestionHeaderActions 用 display: contents 解散、外层改成可换行的横向 flex。
// 三个按钮合计 96+16+96+8+111 = 327（含边距约 351）≤ 358，一行放得下。
// 断言：① 三者同一行；② 都在屏幕内（不越界、不被裁）；③ 反向保护：按钮与统计文字都还在。
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const cdp = require('./cdp');

const SCRIPT = path.join(__dirname, '..', 'zhihu-desk2mob.user.js');
const INJECT_MODE = process.argv[2] !== '--installed';
const TAB_SUBSTR = 'question';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const ST = `JSON.stringify((()=>{
  const g = el => { const r = el.getBoundingClientRect();
    return { L: Math.round(r.left), R: Math.round(r.right), T: Math.round(r.top), W: Math.round(r.width), H: Math.round(r.height) }; };
  const vis = el => { if (!el) return false;
    if (typeof el.checkVisibility === 'function') return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const foot = document.querySelector('.QuestionHeader-footer') || document.querySelector('.QuestionHeader');
  const pick = kw => foot ? [...foot.querySelectorAll('button')]
    .find(b => (b.innerText||'').replace(/\\s+/g,'').indexOf(kw) >= 0) : null;
  const b1 = pick('关注问题') || pick('已关注'), b2 = pick('写回答'), b3 = pick('邀请回答');
  const rows = [b1, b2, b3].filter(Boolean).map(b => Math.round(b.getBoundingClientRect().top));
  return {
    z2m: !!document.getElementById('z2m-style'),
    bodyW: Math.round(document.body.getBoundingClientRect().width),
    hasFooter: !!foot,
    缺哪个: [['关注问题/已关注', b1], ['写回答', b2], ['邀请回答', b3]].filter(x => !x[1]).map(x => x[0]),
    关注问题: b1 ? g(b1) : null, 写回答: b2 ? g(b2) : null, 邀请回答: b3 ? g(b3) : null,
    三者行数: new Set(rows).size,
    统计还在: { 好问题: !!(foot && [...foot.querySelectorAll('*')].some(e => (e.textContent||'').includes('好问题'))),
                分享: !!(foot && [...foot.querySelectorAll('*')].some(e => (e.textContent||'').includes('分享'))) },
    inner: (() => { const i = document.querySelector('.QuestionHeader-footer-inner');
      return i ? { dir: getComputedStyle(i).flexDirection, wrap: getComputedStyle(i).flexWrap } : null; })(),
    actsDisp: (() => { const a = document.querySelector('.QuestionHeaderActions');
      return a ? getComputedStyle(a).display : null; })(),
    // 正文文字区（用来核对按钮区没有超出它）：回答卡片 / 正文
    文字区: (() => { const e = document.querySelector('.AnswerItem') || document.querySelector('.List-item')
        || document.querySelector('.AnswerItem .RichText') || document.querySelector('.RichContent .RichText');
      if (!e) return null; const r = e.getBoundingClientRect();
      return { L: Math.round(r.left), R: Math.round(r.right) }; })(),
    // 页首里所有按钮按 T 分行（用来核对「好问题/评论/分享」那行也是一行、行间距、右缘对齐）
    按钮行: (() => { const main = document.querySelector('.QuestionHeader-footer-main');
      if (!main) return null; const rows = {};
      [...main.querySelectorAll('button')].forEach(x => { const r = x.getBoundingClientRect();
        if (r.height <= 0) return; const t = Math.round(r.top); (rows[t] = rows[t] || []).push(x); });
      return Object.keys(rows).map(Number).sort((a, b) => a - b).map(t => {
        const rs = rows[t].map(x => x.getBoundingClientRect());
        return { T: Math.round(Math.min(...rs.map(r => r.top))), B: Math.round(Math.max(...rs.map(r => r.bottom))),
          L: Math.round(Math.min(...rs.map(r => r.left))), R: Math.round(Math.max(...rs.map(r => r.right))),
          项: rows[t].map(x => (x.innerText || '').replace(/\s+/g, '').slice(0, 8)) }; }); })(),
  };
})())`;

(async () => {
  const code = fs.readFileSync(SCRIPT, 'utf8');
  console.log('脚本: ' + SCRIPT.split(/[\\/]/).pop() + '  [' + (INJECT_MODE ? '注入模式' : '已安装版本') + ']');
  // 断言的数值（两行 / 左右留白 20px）是按**竖屏**列的宽算的；横屏下列宽会变、7 项会挤进同一行。
  // 所以跑之前强制竖屏，跑完恢复自动旋转 —— 手机本身横竖都不影响结果。
  const rot = (acc, user) => { try {
    execSync('adb shell settings put system accelerometer_rotation ' + acc, { shell: 'bash' });
    if (user !== undefined) execSync('adb shell settings put system user_rotation ' + user, { shell: 'bash' });
  } catch (e) { console.log('（设置旋转失败，忽略：' + e.message.split('\n')[0] + '）'); } };
  rot(0, 0);
  await new Promise(r => setTimeout(r, 2500));
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, TAB_SUBSTR) || await cdp.findTab(api);
    if (!tab) throw new Error('未找到知乎问题页标签（请先在真机上打开一个问题页）');
    const sid = await cdp.attach(api, tab.targetId);
    console.log('目标: ' + tab.url);
    await api.send('Page.navigate', { url: tab.url }, sid);
    await cdp.waitReady(api, sid, 30);
    await cdp.sleep(3500);
    if (INJECT_MODE) {
      const r = await cdp.evalJs(api, `(()=>{ try { ${code}\n; return 'injected'; } catch(e){ return 'ERR:' + e.message; } })()`, sid);
      console.log('注入 -> ' + JSON.stringify(r && r.value));
      await cdp.sleep(2500);
    }
    await cdp.evalJs(api, `(()=>{ if (window.__z2mTick) window.__z2mTick(); return 1; })()`, sid);
    await cdp.sleep(1200);
    await cdp.evalJs(api, `(()=>{ if (window.__z2mTick) window.__z2mTick(); return 1; })()`, sid);
    await cdp.sleep(800);

    const s = await cdp.evalJson(api, ST, sid);
    console.log('\nbody 宽=' + s.bodyW + '  inner 方向=' + JSON.stringify(s.inner) + '  .QuestionHeaderActions.display=' + s.actsDisp);
    console.log('  关注问题 ' + JSON.stringify(s.关注问题));
    console.log('  写回答   ' + JSON.stringify(s.写回答));
    console.log('  邀请回答 ' + JSON.stringify(s.邀请回答));
    console.log('  三者行数=' + s.三者行数 + '   统计还在=' + JSON.stringify(s.统计还在));

    ok(s.z2m, '脚本已生效（#z2m-style 存在）', s.z2m);
    ok(s.hasFooter, '找到问题页页首（.QuestionHeader-footer）', s.hasFooter);
    ok(s.缺哪个.length === 0, '三个按钮都在（关注问题/已关注、写回答、邀请回答）', s.缺哪个);
    // ① 同一行
    ok(s.三者行数 === 1, '三个按钮在同一行显示（行数=1）', { 行数: s.三者行数, T: [s.关注问题, s.写回答, s.邀请回答].map(x => x && x.T) });
    // ② 都在屏幕内
    const all = [s.关注问题, s.写回答, s.邀请回答].filter(Boolean);
    // ②b 均匀分布：两处间距接近（原先右侧间距是 0，两个按钮贴在一起）
    const gap1 = all.length >= 2 ? all[1].L - all[0].R : null;
    const gap2 = all.length >= 3 ? all[2].L - all[1].R : null;
    ok(gap1 != null && gap2 != null && Math.abs(gap1 - gap2) <= 4, '三按钮间距均匀（两处间距差 ≤4px）', { gap1, gap2 });
    ok(gap1 !== null && gap1 > 0 && gap2 !== null && gap2 > 0, '两处间距都为正（没有贴在一起）', { gap1, gap2 });
    // ②c 两侧要留白，且不超出正文文字区（用户：按钮区不该顶到屏幕边缘）
    const leftPad = all.length ? all[0].L : null;
    const rightPad = all.length ? s.bodyW - all[all.length - 1].R : null;
    ok(leftPad !== null && leftPad >= 8 && rightPad !== null && rightPad >= 8, '按钮区两侧都有留白（≥8px，不顶屏幕边）',
      { 左空: leftPad, 右空: rightPad });
    if (s.文字区) {
      ok(all.length > 0 && all[0].L >= s.文字区.L - 1 && all[all.length - 1].R <= s.文字区.R + 1,
        '按钮区没有超出正文文字区（' + s.文字区.L + '..' + s.文字区.R + '）',
        { 按钮区: all.length ? [all[0].L, all[all.length - 1].R] : null, 文字区: s.文字区 });
    } else {
      console.log('  SKIP  页面上没找到正文（无法核对「不超出文字区」）');
    }
    // ②d 下面的纯文字按钮（好问题 / 评论 / 分享…）也要在同一行
    if (s.按钮行) {
      ok(s.按钮行.length <= 2, '页首按钮总共只有 2 行（主按钮行 + 文字按钮行）',
        s.按钮行.map(r => r.T + ': ' + r.项.join(' / ')));
      // 直接盯「好问题」与「分享」是否同行（它们分别是这批文字按钮的首尾）
      const rowOf = kw => (s.按钮行.find(r => r.项.some(t => t.indexOf(kw) >= 0)) || {}).T;
      const rGood = rowOf('好问题'), rShare = rowOf('分享');
      ok(rGood !== undefined && rShare !== undefined && rGood === rShare,
        '「好问题」与「分享」在同一行（文字按钮没被拆成两行）', { 好问题所在行: rGood, 分享所在行: rShare });
      // ②e 两行之间要有间距（竖屏不挤）+ 文字按钮行右缘贴齐正文右界
      const row1 = s.按钮行[0], row2 = s.按钮行[1];
      if (row1 && row2) {
        ok(row2.T - row1.B >= 8, '两行之间有间距（≥8px，竖屏不挤）', { 间距: row2.T - row1.B });
        // 文字按钮行右缘要贴齐正文右界（v1.3.4 用 .QuestionHeader-actions:empty { display: none } 实现；
        // ⚠️ 必须带 :empty 限定，无条件隐藏/解散它曾把页面横向撑爆过）
        if (s.文字区) {
          ok(Math.abs(row2.R - s.文字区.R) <= 2, '文字按钮行右缘贴齐正文右界（差 ≤2px）',
            { 文字按钮行右缘: row2.R, 正文右界: s.文字区.R });
          ok(Math.abs(row2.L - s.文字区.L) <= 2, '文字按钮行左缘与正文左界齐平（「好问题」位置不动）',
            { 文字按钮行左缘: row2.L, 正文左界: s.文字区.L });
        }
      }
    } else {
      console.log('  SKIP  没找到 .QuestionHeader-footer-main');
    }
    ok(all.every(b => b.L >= 0), '三个按钮都没有被左侧裁掉（L>=0）', all.map(b => b.L));
    ok(all.every(b => b.R <= s.bodyW + 1), '三个按钮都没有越出右缘（R<=列宽）', { bodyW: s.bodyW, R: all.map(b => b.R) });
    ok(all.every(b => b.W > 40 && b.H > 20), '三个按钮尺寸正常（没被压扁）', all.map(b => [b.W, b.H]));
    // ③ 反向保护：统计文字没被误伤
    ok(s.统计还在.好问题, '反向：仍能找到「好问题」统计', s.统计还在);
    ok(s.统计还在.分享, '反向：仍能找到「分享」入口', s.统计还在);

    await api.send('Page.bringToFront', {}, sid);
    const p = 'shots/31-question-actions.png';
    execSync('adb exec-out screencap -p > "' + p + '"', { shell: 'bash' });
    console.log('\n截图: ' + p);
    console.log('\n===== 结果: ' + pass + ' passed / ' + fail + ' failed =====');
    process.exitCode = fail ? 1 : 0;
  } finally { api.close(); rot(1); }   // 恢复自动旋转（手机横竖由用户决定）
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
