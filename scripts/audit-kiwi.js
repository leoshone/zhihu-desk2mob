// audit-kiwi.js — MuMu Kiwi 页面走查：模拟「桌面版网站」视口 + UA，
// 复用已有知乎标签页导航，注入最新版脚本后输出诊断 + 截图。
// 用法: node scripts/audit-kiwi.js <url> <shotName.png> [waitMs] [scrollY]
// ⚠️ 实测坑：Chrome137 (Kiwi) 上 Page.addScriptToEvaluateOnNewDocument 不生效，
//    必须在 navigate 之后直接 Runtime.evaluate 脚本体（脚本自身有 __z2mStop 幂等保护）。
'use strict';
const fs = require('fs');
const path = require('path');
const cdp = require('./lib/cdp.js');

const SCRIPT_PATH = path.join(__dirname, '..', 'zhihu-desk2mob.user.js');
const OUT_DIR = path.join(__dirname, '..', '..', '_tmp-shots');

const DIAG = `JSON.stringify((()=>{
  const rect = el => { const b = el.getBoundingClientRect(); return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)]; };
  const vis = e => { const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && e.getBoundingClientRect().width > 0; };
  const overflows = [...document.querySelectorAll('body *')].filter(e=>{
    const b=e.getBoundingClientRect(); const cs=getComputedStyle(e);
    return b.width>0 && b.right > Math.min(window.innerWidth, 400) + 2 && cs.position!=='fixed' && cs.visibility!=='hidden' && cs.display!=='none';
  }).slice(0,8).map(e=>e.tagName+'.'+(e.className&&e.className.toString().slice(0,50))+' r='+Math.round(e.getBoundingClientRect().right));
  return {
    url: location.href.slice(0,90),
    innerW: window.innerWidth,
    zoom: document.documentElement.style.zoom || '',
    hasStyle: !!document.getElementById('z2m-style'),
    docW: document.documentElement.scrollWidth,
    overflows,
  };
})())`;

(async () => {
  const [url, shotName, waitMsArg, scrollYArg] = process.argv.slice(2);
  if (!url || !shotName) { console.error('usage: node audit-kiwi.js <url> <shotName.png> [waitMs] [scrollY]'); process.exit(1); }
  const waitMs = parseInt(waitMsArg || '8000', 10);
  const scrollY = parseInt(scrollYArg || '0', 10);
  const userJs = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const shot = path.join(OUT_DIR, shotName);
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const api = await cdp.browserApi();
  try {
    // 复用已有知乎标签页（CDP 新建的 target 在 Kiwi 里导航不可靠，实测）
    let t = await cdp.findTab(api, 'zhihu.com');
    if (!t) t = await cdp.findTab(api, '');
    const sid = await cdp.attach(api, t.targetId);
    // 布局验证模式：视口 891x1987（zoom 后 SW=358 与真机一致）。
    // 真机的视觉验证（zoom≈2.26 + 浏览器页面缩小）emulation 无法正确呈现
    // （setPageScaleFactor 与 html zoom 不耦合，截图会偏移）——这里只测 DOM 布局正确性，
    // 截图时用 clip + scale=1/zoom 把布局坐标压回视觉尺寸。
    await api.send('Emulation.setDeviceMetricsOverride', { width: 891, height: 1987, deviceScaleFactor: 3.0235, mobile: true }, sid);
    await api.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36' }, sid);
    await api.send('Page.navigate', { url }, sid);
    await cdp.waitReady(api, sid, 40);
    const r1 = await api.send('Runtime.evaluate', { expression: userJs, returnByValue: false }, sid);
    if (r1.exceptionDetails) console.log('  inject exception:', JSON.stringify(r1.exceptionDetails).slice(0, 200));
    await cdp.sleep(waitMs);
    if (scrollY > 0) {
      await cdp.evalJson(api, `window.scrollTo(0, ${scrollY})`, sid);
      await cdp.sleep(1500);
    }
    const diag = await cdp.evalJson(api, DIAG, sid);
    console.log(typeof diag === 'string' ? JSON.stringify(JSON.parse(diag), null, 1) : diag);
    // 截图：把布局坐标（SW 列宽系）压回视觉尺寸（clip 宽 = SW，scale = 1，但页面有
    // html zoom —— captureScreenshot 的 clip 是 CSS 布局坐标×zoom 后的视觉坐标，
    // 直接 clip {0,0,393,873} 即视觉窗口；再从结果图裁掉放大）。
    // 简化：整页截图交给人工比对（多列平铺伪影 = 内容超宽的信号）。
    await cdp.shot(api, sid, shot);
    console.log('SHOT ' + shot);
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
