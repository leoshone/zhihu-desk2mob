// probe-fontsize.js — 量某页「正文文字」的实际字号（CSS 值与屏上值）
// 用法: node probe-fontsize.js <tab 子串>
// 输出：① 屏幕换算因子（zoom × scale，字号在屏上的实际大小 = CSS px × 它）
//       ② 关键选择器的 computed font-size / line-height
//       ③ 正文区域的「字号直方图」——只看自身直接带文字的可见叶子，避免被导航/按钮污染
'use strict';
const cdp = require('./cdp');

const SELS = ['.RichContent', '.RichText', '.Post-RichText', '.Post-content',
              '.ContentItem-excerpt', '.ContentItem-title', '.CommentContent', '.QuestionHeader-title'];

const S = `JSON.stringify((()=>{
  const zI = parseFloat(document.documentElement.style.zoom) || 1;
  const vv = window.visualViewport;
  const s = vv ? vv.scale : 1;
  const visFactor = zI * s;                       // 屏幕上实际字号 = CSS px × visFactor
  const vis = v => Math.round(v * visFactor * 100) / 100;

  const sel = ${JSON.stringify(SELS)}.map(q => {
    const e = document.querySelector(q);
    if (!e) return { sel: q, found: false };
    const cs = getComputedStyle(e);
    return { sel: q, found: true, fontSize: cs.fontSize, lineHeight: cs.lineHeight,
             visualPx: vis(parseFloat(cs.fontSize)) };
  });

  const scope = document.querySelector('main') || document.body;
  const tally = {}; const samples = {};
  for (const el of scope.querySelectorAll('*')) {
    // 只看「自身直接带文字」的可见叶子，排除纯容器
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    const key = cs.fontSize + ' / lh ' + cs.lineHeight;
    tally[key] = (tally[key] || 0) + 1;
    if (!samples[key]) samples[key] = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 26);
  }
  const buckets = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([k, n]) => ({ sizeLineHeight: k, count: n, sample: samples[k] }));

  return { url: location.href, zoom: +zI.toFixed(5), scale: +s.toFixed(5), visFactor: +visFactor.toFixed(5),
           scope: document.querySelector('main') ? 'main' : 'body', selectorProbe: sel, buckets };
})())`;

(async () => {
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, process.argv[2] || '');
    if (!tab) { console.log('NO matching tab'); return; }
    const sid = await cdp.attach(api, tab.targetId);
    const d = await cdp.evalJson(api, S, sid);
    console.log('URL: ' + d.url);
    console.log('zoom=' + d.zoom + '  scale=' + d.scale + '  屏幕换算因子=' + d.visFactor + '  普查范围=' + d.scope);
    console.log('--- 关键选择器 ---');
    d.selectorProbe.forEach(x => console.log('  ' + (x.found ? x.fontSize + '  lh=' + x.lineHeight + '  屏上≈' + x.visualPx + 'px  ' : '(未命中) ') + x.sel));
    console.log('--- 正文字号直方图（自身带文字的可见叶子）---');
    d.buckets.forEach(b => console.log('  ' + String(b.count).padStart(4) + ' 个  ' + b.sizeLineHeight + '   例: ' + b.sample));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
