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
  };
})())`;

(async () => {
  const code = fs.readFileSync(SCRIPT, 'utf8');
  console.log('脚本: ' + SCRIPT.split(/[\\/]/).pop() + '  [' + (INJECT_MODE ? '注入模式' : '已安装版本') + ']');
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
    ok(all.length > 0 && all[0].L <= 4 && (s.bodyW - all[all.length - 1].R) <= 4, '按钮区用满整行（左右空档都 ≤4px）',
      { 左空: all[0] && all[0].L, 右空: all.length ? s.bodyW - all[all.length - 1].R : null });
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
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
