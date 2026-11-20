// 复现用户场景：页面顶部时浮动赞同栏的位置
const CDP = require('./lib/cdp.js');
(async () => {
  const api = await CDP.browserApi();
  const tab = (await CDP.getTargets(api)).filter(t => t.type === 'page' && (t.url || '').includes('/question/'))[0];
  const sid = await CDP.attach(api, tab.targetId);
  await CDP.evalJs(api, 'window.scrollTo(0, 0); 1', sid);
  await CDP.sleep(1500);
  const expr = `(() => {
    const all = [...document.querySelectorAll('.ContentItem-actions')].map(s => {
      const r = s.getBoundingClientRect();
      const cs = getComputedStyle(s);
      return { cls: (s.className || '').toString().replace('ContentItem-actions', '').trim().slice(0, 44), top: Math.round(r.top), bottom: Math.round(r.bottom), pos: cs.position, inVp: r.bottom > 0 && r.top < innerHeight };
    }).filter(x => x.inVp);
    const qh = document.querySelector('.QuestionHeader');
    const qhr = qh ? qh.getBoundingClientRect() : null;
    return JSON.stringify({ vh: innerHeight, q: qhr ? [Math.round(qhr.top), Math.round(qhr.bottom)] : null, visible: all });
  })()`;
  console.log(JSON.stringify(await CDP.evalJson(api, expr, sid)));
  await CDP.shot(api, sid, 'shots/qpage-top.png');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
