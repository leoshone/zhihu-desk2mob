// dump「提问题」等 4 个动作项内部结构
const CDP = require('./lib/cdp.js');
(async () => {
  const api = await CDP.browserApi();
  const tab = (await CDP.getTargets(api)).filter(t => t.type === 'page' && t.url === 'https://www.zhihu.com/')[0];
  const sid = await CDP.attach(api, tab.targetId);
  const expr = `(() => {
    const row = document.querySelector('.WriteArea .css-19tvx7b');
    if (!row) return 'no-row';
    const item = row.children[0];
    const walk = (el, d, out) => {
      if (d > 4) return;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const t = (el.innerText || '').trim();
      out.push('  '.repeat(d) + el.tagName + (el.className ? '.' + el.className.toString().split(' ')[0] : '') + ' [' + Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.right) + ',' + Math.round(r.bottom) + '] ' + cs.display + '/' + cs.fontSize + (t && t.length < 10 ? ' <<' + t + '>>' : ''));
      [...el.children].forEach(c => walk(c, d + 1, out));
    };
    const out = [];
    walk(item, 0, out);
    return out.join('\\n');
  })()`;
  const r = await CDP.evalJs(api, expr, sid);
  console.log(r.value);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
