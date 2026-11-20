// dump 写想法卡片（WriteArea）结构
const CDP = require('./lib/cdp.js');
(async () => {
  const api = await CDP.browserApi();
  const tab = (await CDP.getTargets(api)).filter(t => t.type === 'page' && t.url === 'https://www.zhihu.com/')[0];
  const sid = await CDP.attach(api, tab.targetId);
  const expr = `(() => {
    const card = document.querySelector('.WriteArea');
    if (!card) return 'no-card';
    const walk = (el, depth, out) => {
      if (depth > 4) return;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const txt = (el.innerText || '').trim();
      out.push('  '.repeat(depth) + el.tagName + ' .' + (el.className || '').toString().split(' ').slice(0, 2).join('.') + ' [' + Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.right) + ',' + Math.round(r.bottom) + '] ' + cs.display + (txt && txt.length < 30 ? ' <<' + txt.slice(0, 20) + '>>' : ''));
      [...el.children].slice(0, 8).forEach(c => walk(c, depth + 1, out));
    };
    const out = [];
    walk(card, 0, out);
    return out.join('\\n');
  })()`;
  const r = await CDP.evalJs(api, expr, sid);
  console.log(r.value);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
