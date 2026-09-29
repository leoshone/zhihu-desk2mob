// probe-composer.js — dump 评论区发布框（composer）的完整结构，定位「同时发布到想法」该隐藏哪一层
'use strict';
const { execSync } = require('child_process');
const cdp = require('./cdp');

const JS = `JSON.stringify((()=>{
  const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
  const Q = '同时发布到想法';
  const desc = el => {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    return { tag: el.tagName, type: el.getAttribute && el.getAttribute('type'),
             cls: (el.className || '').toString().slice(0, 90),
             clsStable: (el.className || '').toString().split(/\\s+/).filter(c => c && !/^css-[a-z0-9]{4,8}$/.test(c)).join(' '),
             disp: cs.display, pos: cs.position, flexWrap: cs.flexWrap, flex: cs.flex, minW: cs.minWidth, w: cs.width,
             rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
             txt: norm(el.innerText).slice(0, 40) };
  };
  const leaf = [...document.querySelectorAll('span')].find(el => norm(el.innerText) === Q);
  if (!leaf) return { err: 'leaf not found' };
  // 该 label 的包裹层（不含「发布」按钮的最小祖先）
  let wrap = leaf;
  while (wrap.parentElement && norm(wrap.parentElement.innerText).includes('发布') &&
         norm(wrap.parentElement.innerText).replace(Q, '').includes('发布') === false) {
    wrap = wrap.parentElement;
  }
  // 更稳的判定：向上找「文本里不含『发布』二字」的最大祖先
  let box = leaf;
  while (box.parentElement && !/发布\\s*$/m.test(norm(box.parentElement.innerText)) &&
         norm(box.parentElement.innerText).replace(Q, '').trim() === '') {
    box = box.parentElement;
  }
  // 该 label 子树里的 input（radio/checkbox）
  const inputs = [...leaf.parentElement.querySelectorAll('input')].map(desc);
  // composer 根：文本含「理性发言」的最近祖先
  let root = leaf;
  while (root.parentElement && !root.parentElement.innerText.includes('理性发言')) root = root.parentElement;
  // 根下两层的结构
  const tree = [];
  const walk = (el, d) => {
    if (d > 2) return;
    tree.push('  '.repeat(d) + JSON.stringify(desc(el)));
    [...el.children].forEach(c => walk(c, d + 1));
  };
  walk(root, 0);
  return { url: location.href, leaf: desc(leaf), labelWrap: desc(box), inputs, root: desc(root), tree };
})())`;

(async () => {
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, 'zhuanlan') || await cdp.findTab(api);
    const sid = await cdp.attach(api, tab.targetId);
    // 先把发布框滚到视口中央，便于截图核对
    await cdp.evalJson(api, `JSON.stringify((()=>{
      const norm = s => (s||'').replace(/[\\s\\u200b]+/g,' ').trim();
      const leaf = [...document.querySelectorAll('span')].find(el => norm(el.innerText) === '同时发布到想法');
      if (leaf) leaf.scrollIntoView({ block: 'center' });
      return leaf ? 'scrolled' : 'not found';
    })())`, sid);
    await cdp.sleep(1500);
    const d = await cdp.evalJson(api, JS, sid);
    if (d.err) { console.log(JSON.stringify(d)); return; }
    console.log('页面: ' + d.url);
    console.log('\nlabel 叶子: ' + JSON.stringify(d.leaf));
    console.log('label 包裹层: ' + JSON.stringify(d.labelWrap));
    console.log('\nlabel 子树里的 input:');
    d.inputs.forEach(i => console.log('  ' + JSON.stringify(i)));
    console.log('\ncomposer 根: ' + JSON.stringify(d.root));
    console.log('\n结构树:');
    d.tree.forEach(l => console.log(l));
    await api.send('Page.bringToFront', {}, sid);
    execSync('adb exec-out screencap -p > "D:/AiSpaces/Work/2026-09-29-10-18-12/shots/13-composer-before.png"', { shell: 'bash' });
    console.log('\n截图: shots/13-composer-before.png');
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
