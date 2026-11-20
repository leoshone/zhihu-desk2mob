// 深滚动后浮动栏状态检查
const CDP = require('./lib/cdp.js');
(async () => {
  for (let i = 0; i < 5; i++) {
    try {
      const api = await CDP.browserApi();
      const tab = (await CDP.getTargets(api)).filter(t => t.type === 'page' && (t.url || '').includes('/question/'))[0];
      const sid = await CDP.attach(api, tab.targetId);
      await CDP.evalJs(api, 'window.scrollTo(0, 12000); 1', sid);
      await CDP.sleep(1500);
      const expr = `(() => {
        const bars = [...document.querySelectorAll('.ContentItem-actions')].map(b => {
          const r = b.getBoundingClientRect();
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), cls: (b.className || '').toString().replace('ContentItem-actions', '').trim().slice(0, 30) };
        });
        return JSON.stringify({ vh: innerHeight, scrollY: Math.round(scrollY), bars });
      })()`;
      console.log(JSON.stringify(await CDP.evalJson(api, expr, sid)));
      await CDP.shot(api, sid, 'shots/deep-scroll.png');
      process.exit(0);
    } catch (e) {
      console.log('retry', i, e.message.slice(0, 40));
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  process.exit(1);
})();
