// probe-pinch-floor.js — dump 页面上的 viewport meta，并逐档扫 pageScaleFactor 看实际落点
// 用途：查「捏合下限」到底是浏览器限制还是脚本行为（实测下限 = 屏幕可用宽 ÷ innerWidth）。
// 用法: node probe-pinch-floor.js <tab 子串>
'use strict';
const cdp = require('./cdp');

const META = `JSON.stringify((()=>{
  const ms = [...document.querySelectorAll('meta[name="viewport"]')].map((m, i) => ({ i, content: m.getAttribute('content'), inHead: !!m.closest('head') }));
  return { url: location.href, count: ms.length, metas: ms,
           inlineZoom: document.documentElement.style.zoom || '',
           touchAction: getComputedStyle(document.documentElement).touchAction };
})())`;

const SCALE = `JSON.stringify((()=>{
  const vv = window.visualViewport;
  return { scale: vv ? +vv.scale.toFixed(5) : null, vvW: vv ? Math.round(vv.width) : null,
           innerW: window.innerWidth, inlineZoom: document.documentElement.style.zoom || '' };
})())`;

(async () => {
  const api = await cdp.browserApi();
  const tab = await cdp.findTab(api, process.argv[2] || '');
  if (!tab) { console.log('NO matching tab'); return; }
  await api.send('Target.activateTarget', { targetId: tab.targetId });
  await cdp.sleep(1000);
  const sid = await cdp.attach(api, tab.targetId);
  try {
    const m = await cdp.evalJson(api, META, sid);
    console.log('URL : ' + m.url);
    console.log('viewport metas: ' + m.count + '   touch-action: ' + m.touchAction + '   inlineZoom: ' + JSON.stringify(m.inlineZoom));
    m.metas.forEach(x => console.log('  [' + x.i + '] inHead=' + x.inHead + '  content=' + JSON.stringify(x.content)));
    console.log('--- pageScaleFactor 扫描 ---');
    for (const f of [1, 0.8, 0.6, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25]) {
      await api.send('Emulation.setPageScaleFactor', { pageScaleFactor: f }, sid);
      await cdp.sleep(700);
      const d = await cdp.evalJson(api, SCALE, sid);
      console.log('  请求 ' + f + ' -> scale=' + d.scale + ' vvW=' + d.vvW + ' (innerW=' + d.innerW +
                  ', 理论最小=' + (d.vvW && d.scale ? (d.vvW * d.scale / d.innerW).toFixed(5) : '?') + ')');
    }
    await api.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }, sid);
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
