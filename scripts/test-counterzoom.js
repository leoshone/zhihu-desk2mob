// test-counterzoom.js — 反缩放必须「跟得住加载期的变化，且不跟用户抢」
// 用法: node test-counterzoom.js             重载并注入 src 下脚本
//       node test-counterzoom.js --installed 测真机暴力猴里已安装的版本
//
// 背景（实测）：老代码只在 window.resize 时重算，而浏览器的缩放变化（含加载后恢复用户上次
// 记录的捏合比例）**只触发 visualViewport.resize**（实测 window.resize 计数恒为 0）。
// 结果：加载时按 scale≈0.275 定了 zoom≈3.64，随后 scale 变回 ≈1 而 zoom 留在 3.64
// → 整页被放大数倍，用户只能双指捏合缩回去。
//
// 断言：
//   ① 加载后确实应用了反缩放（zoom > 1）；
//   ② 稳定窗口之后，中等幅度改变 scale **不得**改动我们的 zoom（不跟用户抢捏合）；
//   ③ scale 回到正常（>=0.9）时，**必须撤掉**我们的 zoom（这是本次修的核心）。
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const cdp = require('./cdp');

const SCRIPT = path.join(__dirname, '..', 'src', 'zhihu-desk2mob.user.js');
const INJECT_MODE = process.argv[2] !== '--installed';
const TAB_SUBSTR = 'www.zhihu.com';
const SETTLE_MS = 3000;   // 与脚本里的稳定窗口一致

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const S = `JSON.stringify((()=>{
  const vv = window.visualViewport;
  const inline = document.documentElement.style.zoom || '';
  // 注意：不能用 getComputedStyle(html).zoom 判断「我们有没有施加 zoom」——
  // 未设置内联 zoom 时它会返回 dpr（实测 3.02348），看着像有 zoom 其实没有。
  // 判据只能是 documentElement 的内联 style.zoom。
  return { inlineZoom: inline, zoomNum: parseFloat(inline) || 1,
           scale: vv ? +vv.scale.toFixed(5) : null, vvW: vv ? Math.round(vv.width) : null,
           innerW: window.innerWidth, bodyW: Math.round(document.body.getBoundingClientRect().width) };
})())`;

const setScale = (api, sid, f) => api.send('Emulation.setPageScaleFactor', { pageScaleFactor: f }, sid);

(async () => {
  const code = fs.readFileSync(SCRIPT, 'utf8');
  console.log('脚本: ' + SCRIPT.split(/[\\/]/).pop() + '  [' + (INJECT_MODE ? '注入模式' : '已安装版本') + ']');
  const api = await cdp.browserApi();
  let sid;
  try {
    const tab = await cdp.findTab(api, TAB_SUBSTR) || await cdp.findTab(api);
    sid = await cdp.attach(api, tab.targetId);
    // 先把比例设成「桌面模式的缩小态」，再加载 —— 这样加载期 applyZoom 一定会施加反缩放，
    // 才有可撤的对象（否则若加载时比例已是 1，老代码也不会施加 zoom，测不出差别）。
    await setScale(api, sid, 0.3);
    await cdp.sleep(800);
    await api.send('Page.navigate', { url: 'https://www.zhihu.com/' }, sid);
    await cdp.waitReady(api, sid, 30);
    await cdp.sleep(2500);
    if (INJECT_MODE) {
      const r = await cdp.evalJs(api, `(()=>{ try { ${code}\n; return 'injected'; } catch(e){ return 'ERR:' + e.message; } })()`, sid);
      console.log('注入 -> ' + JSON.stringify(r && r.value));
    }
    await cdp.sleep(4000);   // 等过稳定窗口（脚本内 SETTLE_MS = 3000）

    const a = await cdp.evalJson(api, S, sid);
    console.log('\n① 加载稳定后:  ' + JSON.stringify(a));
    ok(a.zoomNum > 1, '加载后应用了反缩放（内联 zoom > 1）', a);
    ok(a.scale !== null && a.scale < 0.9, '此时浏览器比例是缩小态（<0.9），反缩放确有必要', a.scale);

    // ② 稳定窗口之后：把比例改成 0.5（用户捏合的形态）→ 不该动我们的 zoom
    await setScale(api, sid, 0.5);
    await cdp.sleep(1500);
    const b = await cdp.evalJson(api, S, sid);
    console.log('② 稳定期后 scale→0.5: ' + JSON.stringify(b));
    ok(Math.abs(b.zoomNum - a.zoomNum) < 0.02,
      '中等幅度改 scale 不改动我们的 zoom（不跟用户抢）', { before: a.zoomNum, after: b.zoomNum });

    // ③ 比例回到正常 → 必须撤掉 zoom（本次修的核心）
    await setScale(api, sid, 1);
    await cdp.sleep(1500);
    const c = await cdp.evalJson(api, S, sid);
    console.log('③ scale→1（正常）:    ' + JSON.stringify(c));
    ok(c.zoomNum <= 1.0001, '比例恢复正常后已撤掉 zoom（不再整页放大）', c);
    ok(c.inlineZoom === '', 'html 上的内联 zoom 已被移除', c.inlineZoom);

    await api.send('Page.bringToFront', {}, sid);
    execSync('adb exec-out screencap -p > "D:/AiSpaces/Work/2026-09-29-10-18-12/shots/27-zoom-after-fix.png"', { shell: 'bash' });
    console.log('\n截图: shots/27-zoom-after-fix.png');

    // 收尾：恢复到缩小态，免得把页面留在被改过缩放的怪状态
    await setScale(api, sid, 1);
    await cdp.sleep(300);
    await api.send('Page.navigate', { url: 'https://www.zhihu.com/' }, sid);
    console.log('\n===== 结果: ' + pass + ' passed / ' + fail + ' failed =====');
    process.exitCode = fail ? 1 : 0;
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
