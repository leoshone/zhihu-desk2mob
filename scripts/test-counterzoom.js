// test-counterzoom.js — 反缩放：内容必须"恰好铺满"，且加载期间不能出现视觉跳变
//
// 用法: node test-counterzoom.js --installed   测真机暴力猴里已安装的版本（**这是有判别力的用法**）
//       node test-counterzoom.js               重载并注入 src 下脚本（注入发生在加载之后，
//                                              跑不到加载期的跳变，仅用于快速看公式结果）
//
// 背景（真机实测）：
//   老公式 zoom = 1/scale 与「铺满所需」的比值恒为 1.0992 ——
//   因为屏幕可用 CSS 宽度是 357.5（1080 ÷ dpr 3.0235），而列宽 SW 取自 screen.width = 393。
//   后果就是用户看到的「打开后被放大一点点，得像双指捏合那样缩回」。
//   而浏览器在加载期会逐级调整缩放，级差恰好也是 ×0.9097 —— 于是老代码"上一级的 1/scale"
//   常常正好等于"这一级的铺满值"，看起来时对时不对（这解释了它为何难复现）。
//
// 断言：
//   ① 加载全程「内容 ÷ 可见宽度」≈ 1（= 不会比屏幕大，也就不需要捏合），且视觉尺寸不跳变；
//   ② 捏合**缩小**被限制在「恰好铺满」这个下限上（v1.1.0 起，用户要求「限制手工缩到很小」）——
//      不会被缩成半屏小字（实测旧版最小能缩到只占屏宽 49%）；
//   ③ 捏合**放大**不被干预，保留放大的用处。
// 注意 ②③ 与 v1.0.9 的行为相反：v1.0.9 的设计是「用户捏合一律不干预」，v1.1.0 只放开放大方向。
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const cdp = require('./cdp');

const SCRIPT = path.join(__dirname, '..', 'zhihu-desk2mob.user.js');
const INJECT_MODE = process.argv[2] !== '--installed';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const S = `JSON.stringify((()=>{
  if (!document.body) return { notReady: true };
  const vv = window.visualViewport;
  const z = parseFloat(document.documentElement.style.zoom) || 1;   // 内联 zoom 是唯一可信判据
  const s = vv ? vv.scale : 1;
  const visW = vv ? vv.width : window.innerWidth;
  const bodyW = document.body.getBoundingClientRect().width;
  return {
    zoom: +z.toFixed(4), scale: +s.toFixed(5),
    visualSize: +(z * s).toFixed(4),          // 正比于屏幕上看到的尺寸
    fitRatio: +(bodyW * z / visW).toFixed(4), // =1 即恰好铺满可见宽度
    oldOverFit: +((1 / s) / (visW / bodyW)).toFixed(4),  // 老公式相对「铺满」偏大多少
    inline: document.documentElement.style.zoom || '',
  };
})())`;

(async () => {
  const code = fs.readFileSync(SCRIPT, 'utf8');
  console.log('脚本: ' + SCRIPT.split(/[\\/]/).pop() + '  [' + (INJECT_MODE ? '注入模式（测不到加载期）' : '已安装版本') + ']');
  const api = await cdp.browserApi();
  let sid;
  try {
    const tab = await cdp.findTab(api, 'www.zhihu.com') || await cdp.findTab(api);
    sid = await cdp.attach(api, tab.targetId);

    // 记下「进测试前浏览器自身的比例」。②③④ 会 Emulation.setPageScaleFactor 改写它，
    // 而 CDP **没有清除 pageScaleFactor 的接口**（Emulation.clearDeviceMetricsOverride 实测也清不掉），
    // 所以必须在收尾时把它设回原值 —— 否则这张标签会残留一个被改写过的比例，症状有两个：
    //   ① 页面能横向平移、右侧出现一片空白（visW < innerWidth，实测 715 vs 891）；
    //   ② 紧接着重跑本测试时①步拿到 0 个样本（残留 scale=1 时 Z=visW/SW 恰等于 curZ 初值）。
    const pinch0 = await cdp.evalJson(api,
      `JSON.stringify((()=>{const vv=window.visualViewport; return vv ? +vv.scale.toFixed(5) : null;})())`, sid, 8000);

    // ① 从导航一开始就密集采样，盯住「内容/可见宽度」与「视觉尺寸」
    await api.send('Page.navigate', { url: 'https://www.zhihu.com/' }, sid);
    const series = [];
    for (let i = 0; i < 22; i++) {
      await cdp.sleep(220);
      let d;
      try { d = await cdp.evalJson(api, S, sid); } catch (e) { d = { err: e.message }; }
      if (!d.err && !d.notReady && d.inline) series.push(d);   // 只在脚本已施加 zoom 后统计
    }
    if (INJECT_MODE && series.length === 0) {
      const r = await cdp.evalJs(api, `(()=>{ try { ${code}\n; return 'injected'; } catch(e){ return 'ERR:' + e.message; } })()`, sid);
      console.log('注入 -> ' + JSON.stringify(r && r.value));
      await cdp.sleep(1500);
      const d = await cdp.evalJson(api, S, sid);
      if (!d.err && !d.notReady) series.push(d);
    }
    console.log('\n① 采样 ' + series.length + ' 次（每 220ms）');
    console.log('   fitRatio: ' + JSON.stringify(series.map(x => x.fitRatio)));
    console.log('   visual  : ' + JSON.stringify(series.map(x => x.visualSize)));
    const fits = series.map(x => x.fitRatio);
    const vis = series.map(x => x.visualSize);
    const worstFit = fits.length ? Math.max(...fits.map(v => Math.abs(v - 1))) : null;
    const jitter = vis.length ? Math.max(...vis) / Math.min(...vis) - 1 : null;
    ok(fits.length >= 3, '拿到足够样本（' + fits.length + ' 个）', fits.length);
    ok(worstFit !== null && worstFit <= 0.03,
      '全程内容不超过可见宽度 3%（不需要捏合）', { worstFit });
    ok(jitter !== null && jitter <= 0.03,
      '全程视觉尺寸稳定（抖动 ≤3%，无「放大再缩小」）', { jitter: jitter && +(jitter * 100).toFixed(1) + '%' });
    const o = series.length ? series[series.length - 1].oldOverFit : null;
    console.log('   （对照）老公式 1/scale 比「铺满」大 ' + (o !== null ? Math.round((o - 1) * 100) + '%' : '?') +
      ' ← 这就是那个「一点点」');

    // ② 捏合**缩小**必须被限制：内容不得小于「恰好铺满」（判据是屏幕上的实际尺寸不变）
    const before = await cdp.evalJson(api, S, sid);
    await api.send('Emulation.setPageScaleFactor', { pageScaleFactor: 0.5 }, sid);
    await cdp.sleep(1600);
    const sh = await cdp.evalJson(api, S, sid);
    ok(Math.abs(sh.fitRatio - 1) <= 0.03,
      '捏合缩小后内容仍恰好铺满（不会被缩成半屏小字）', { fitRatio: sh.fitRatio, scale: sh.scale });
    ok(Math.abs(sh.visualSize - before.visualSize) <= 0.03,
      '捏合缩小不改变屏幕上的实际尺寸（视觉上被限制住）', { before: before.visualSize, after: sh.visualSize });

    // ③ 缩到极限仍停在铺满（夹住的是下限，不是「一律抢回」）
    await api.send('Emulation.setPageScaleFactor', { pageScaleFactor: 0.35 }, sid);   // 浏览器会夹到 ~0.40
    await cdp.sleep(1400);
    const lim = await cdp.evalJson(api, S, sid);
    ok(Math.abs(lim.visualSize - before.visualSize) <= 0.03,
      '缩到浏览器下限时仍停在铺满', { visualSize: lim.visualSize, scale: lim.scale });

    // ④ 捏合**放大**不该被干预（否则字就放不大了）
    await api.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }, sid);
    await cdp.sleep(1400);
    const en = await cdp.evalJson(api, S, sid);
    ok(en.visualSize > before.visualSize * 1.2,
      '捏合放大仍然有效（不会被脚本抢回）', { before: before.visualSize, after: en.visualSize });

    // 还原浏览器自身比例（见上面 pinch0 的注释）—— 必须在收尾导航之前做，
    // 且要赶在截图之前，这样截图反映的也是还原后的状态。
    if (pinch0) {
      await api.send('Emulation.setPageScaleFactor', { pageScaleFactor: pinch0 }, sid).catch(() => {});
      await cdp.sleep(900);
      const back = await cdp.evalJson(api,
        `JSON.stringify((()=>{const vv=window.visualViewport;return{scale:vv?+vv.scale.toFixed(5):null,visW:vv?Math.round(vv.width):null,innerW:window.innerWidth};})())`, sid, 8000);
      console.log('  已还原比例 -> ' + JSON.stringify(back) +
        (back && back.visW === back.innerW ? '（不再可横向平移 ✓）' : '（⚠️ 仍与 innerWidth 不等）'));
    }

    await api.send('Page.bringToFront', {}, sid);
    execSync('adb exec-out screencap -p > "shots/29-fit.png"', { shell: 'bash' });
    console.log('\n截图: shots/29-fit.png');

    await api.send('Page.navigate', { url: 'https://www.zhihu.com/' }, sid);   // 收尾还原
    console.log('\n===== 结果: ' + pass + ' passed / ' + fail + ' failed =====');
    process.exitCode = fail ? 1 : 0;
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
