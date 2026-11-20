// dump header DOM tree with rects
const CDP = require('./lib/cdp.js');
(async () => {
  const api = await CDP.browserApi();
  const tab = (await CDP.getTargets(api)).filter(t => t.type === 'page' && t.url === 'https://www.zhihu.com/')[0];
  const sid = await CDP.attach(api, tab.targetId);
  const expr = `(() => {
    const bar = document.querySelector('.LeanAppHeaderBar');
    const walk = (el, depth, out) => {
      if (depth > 5) return;
      const r = el.getBoundingClientRect();
      const cls = (el.className || '').toString().split(' ').slice(0, 2).join('.');
      out.push('  '.repeat(depth) + el.tagName + ' .' + cls + ' [' + Math.round(r.left) + ',' + Math.round(r.right) + ']');
      [...el.children].slice(0, 6).forEach(c => walk(c, depth + 1, out));
    };
    const out = [];
    walk(bar, 0, out);
    return out.join('\\n');
  })()`;
  const r = await CDP.evalJs(api, expr, sid);
  console.log(r.value);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
