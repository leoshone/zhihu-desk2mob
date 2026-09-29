// probe-element.js — 按文本定位页面元素并 dump 结构（找稳定选择器用）
// 用法: node probe-element.js "要查找的文本" [--tab <URL 子串>]
//   --tab 用于在多标签页里挑目标，传任意 URL 子串；不传则取第一个页面标签。
// 输出：所有命中元素的自身/祖先信息 + 同级兄弟，便于判断「该隐藏哪一层」以及有无稳定类名。
'use strict';
const cdp = require('./cdp');

const query = process.argv[2];
if (!query) { console.error('用法: node probe-element.js "要查找的文本" [--tab <URL 子串>]'); process.exit(1); }
const TAB_SUBSTR = process.argv.includes('--tab') ? (process.argv[process.argv.indexOf('--tab') + 1] || '') : '';

const JS = `JSON.stringify((()=>{
  const Q = ${JSON.stringify(query)};
  const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
  const desc = el => {
    if (!el || !el.tagName) return null;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    return { tag: el.tagName, id: el.id || '', cls: (el.className || '').toString().slice(0, 150),
             clsStable: (el.className || '').toString().split(/\\s+/).filter(c => c && !/^css-[a-z0-9]{4,8}$/.test(c)).join(' '),
             disp: cs.display, pos: cs.position, flex: cs.flexDirection + '/' + cs.flexWrap, alignItems: cs.alignItems,
             rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
             txt: norm(el.innerText).slice(0, 50) };
  };
  // 1) 叶子命中：自身文本（含子文本）包含关键词
  const hits = [...document.querySelectorAll('body *')].filter(el => norm(el.innerText).includes(Q));
  // 2) 取每个命中链上「最小」的若干层：从最深往上 4 层
  const out = [];
  const seen = new Set();
  hits.slice(-40).forEach(el => {
    if (el.children.length === 0) {
      const chain = []; let n = el;
      while (n && n !== document.body && chain.length < 5) { chain.push(desc(n)); n = n.parentElement; }
      const key = chain.map(c => c.tag + c.cls).join('>');
      if (seen.has(key)) return; seen.add(key);
      const p = el.parentElement;
      out.push({ leaf: desc(el),
                 chain,
                 siblings: p ? [...p.children].map(c => desc(c)) : [] });
    }
  });
  // 3) 兜底：没有叶子命中时，给出最接近的容器
  if (!out.length && hits.length) {
    const el = hits[hits.length - 1];
    const chain = []; let n = el;
    while (n && n !== document.body && chain.length < 6) { chain.push(desc(n)); n = n.parentElement; }
    out.push({ leaf: desc(el), chain, siblings: [] });
  }
  return { query: Q, url: location.href, hitCount: hits.length, groups: out.slice(0, 6) };
})())`;

(async () => {
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, TAB_SUBSTR) || await cdp.findTab(api);
    if (!tab) throw new Error('no tab');
    const sid = await cdp.attach(api, tab.targetId);
    const d = await cdp.evalJson(api, JS, sid);
    console.log('页面: ' + d.url);
    console.log('命中元素数: ' + d.hitCount);
    d.groups.forEach((g, i) => {
      console.log('\n===== 命中组 ' + i + ' =====');
      console.log('  叶子: ' + JSON.stringify(g.leaf));
      console.log('  祖先链（由内向外）:');
      g.chain.forEach((c, j) => console.log('    ' + j + ' ' + JSON.stringify(c)));
      if (g.siblings.length) {
        console.log('  同级兄弟:');
        g.siblings.forEach(s => console.log('    ' + JSON.stringify(s)));
      }
    });
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
