// 量 logo 位置与其容器链（为「logo 往左靠」做准备）
const CDP = require('./lib/cdp.js');
(async () => {
  const api = await CDP.browserApi();
  const tab = (await CDP.getTargets(api)).filter(t => t.type === 'page' && t.url === 'https://www.zhihu.com/')[0];
  const sid = await CDP.attach(api, tab.targetId);
  const expr = `(() => {
    const bar = document.querySelector('.LeanAppHeaderBar');
    const logo = bar.querySelector('a svg') ? bar.querySelector('a svg').closest('a') : null;
    const chain = [];
    let p = logo && logo.parentElement;
    while (p && p !== bar) { const r = p.getBoundingClientRect(); const cs = getComputedStyle(p); chain.push({ tag: p.tagName, cls: (p.className||'').toString().slice(0,40), rect: [Math.round(r.left), Math.round(r.right)], pos: cs.position, ml: cs.marginLeft, pl: cs.paddingLeft }); p = p.parentElement; }
    const r = logo.getBoundingClientRect();
    const card = document.querySelector('.Topstory-mainColumnCard');
    const cr = card ? card.getBoundingClientRect() : null;
    return JSON.stringify({ logo: [Math.round(r.left), Math.round(r.right)], href: logo && logo.getAttribute('href'), chain, cardLeft: cr ? Math.round(cr.left) : null, zoom: document.documentElement.style.zoom });
  })()`;
  console.log(JSON.stringify(await CDP.evalJson(api, expr, sid)));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
