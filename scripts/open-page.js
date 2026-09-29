// open-page.js — 开一个新标签并报告它是否处于「桌面模式」（即脚本会否生效）
// 用途：跑测试前准备好所需页面（专栏页 / 回答页）—— 缺了它们测试会退到别的页面、
//       表现成「发布框打不开」这类前置失败。本机实测 CDP 新建的标签会自动是桌面模式。
// 用法: node open-page.js <url> [--desktop]     （--desktop 才强制 setDeviceMetricsOverride）
'use strict';
const cdp = require('./cdp');

const S = `JSON.stringify((()=>{
  const z = parseFloat(document.documentElement.style.zoom) || 1;
  return { url: location.href, innerW: window.innerWidth, hasStyle: !!document.getElementById('z2m-style'),
           inlineZoom: document.documentElement.style.zoom || '', factor: +(z * (window.visualViewport ? window.visualViewport.scale : 1)).toFixed(5) };
})())`;

(async () => {
  const [url, flag] = process.argv.slice(2);
  const api = await cdp.browserApi();
  try {
    const t = await api.send('Target.createTarget', { url });
    const sid = await cdp.attach(api, t.targetId);
    if (flag === '--desktop') {                 // CDP 新建的标签可能是移动模式，强制成桌面视口
      await api.send('Emulation.setDeviceMetricsOverride', { width: 980, height: 1743, deviceScaleFactor: 3.0235, mobile: false }, sid);
      await api.send('Page.navigate', { url }, sid);
    }
    await cdp.waitReady(api, sid, 30);
    await cdp.sleep(4000);
    console.log(JSON.stringify(await cdp.evalJson(api, S, sid)));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
