// probe-topalign.js — 把目标元素顶部对齐到视口顶端，看它是否被浮层遮住
// 用法: node probe-topalign.js <tab 子串> <pageScaleFactor> <选择器> <截图名>
'use strict';
const { execSync } = require('child_process');
const cdp = require('./cdp');

const mk = sel => `JSON.stringify((()=>{
  const zI = parseFloat(document.documentElement.style.zoom) || 1;
  const vv = window.visualViewport;
  const t = document.querySelector(${JSON.stringify(sel)});
  if (!t) return { err: 'target not found' };
  const r = t.getBoundingClientRect();
  window.scrollBy(0, r.top);                    // rect 与 scrollTo 同一 CSS px 空间
  const bars = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed') continue;
    const b = el.getBoundingClientRect();
    if (b.top > 4 || b.height < 4 || b.width < 4) continue;
    bars.push({ cls: (el.className || '').toString().slice(0, 40), z: cs.zIndex, h: cs.height,
                rect: [0, Math.round(b.top), Math.round(b.width), Math.round(b.height)],
                txt: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 30) });
  }
  const r2 = t.getBoundingClientRect();
  return { sel: ${JSON.stringify(sel)}, zoom: +zI.toFixed(5), scale: +(vv ? vv.scale : 1).toFixed(5),
           scrollY: Math.round(window.scrollY),
           targetRectAfter: [Math.round(r2.left), Math.round(r2.top), Math.round(r2.width), Math.round(r2.height)],
           topBars: bars };
})())`;

(async () => {
  const [substr, factor, sel, shot] = process.argv.slice(2);
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, substr);
    if (!tab) { console.log('NO matching tab'); return; }
    const sid = await cdp.attach(api, tab.targetId);
    await api.send('Emulation.setPageScaleFactor', { pageScaleFactor: Number(factor) }, sid);
    await cdp.sleep(1500);
    for (let i = 0; i < 3; i++) {   // 对齐可能要几拍（吸顶/懒加载会改布局）
      console.log(JSON.stringify(await cdp.evalJson(api, mk(sel), sid)));
      await cdp.sleep(700);
    }
    execSync('adb exec-out screencap -p > "D:/AiSpaces/Code/Zhihu-Desk2Mob/_tmp/' + shot + '"', { shell: 'bash' });
    console.log('截图: _tmp/' + shot);
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
