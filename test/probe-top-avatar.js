// 验证：注入改后的 reflowHeader 逻辑，确认头像回到屏幕内右缘
const CDP = require('./lib/cdp.js');
const fs = require('fs');
(async () => {
  const api = await CDP.browserApi();
  const tab = (await CDP.getTargets(api)).filter(t => t.type === 'page' && t.url === 'https://www.zhihu.com/')[0];
  const sid = await CDP.attach(api, tab.targetId);
  // 先清掉旧偏移，再模拟新逻辑执行（新脚本要 reload 才生效，这里先在页面内直接验证算法）
  const expr = `(() => {
    const bar = document.querySelector('.LeanAppHeaderBar');
    const avWrap = bar.querySelector('[class*="css-1ww4ngr"]');
    // 用新算法重算
    const wb = avWrap.getBoundingClientRect();
    const naturalRight = wb.right - (parseFloat(avWrap.style.left) || 0);
    const wantLeft = (393 - 16) - naturalRight;
    avWrap.style.setProperty('left', wantLeft + 'px', 'important');
    const r = avWrap.getBoundingClientRect();
    const btn = bar.querySelector('button[class*="AppHeader-profile"]');
    const br = btn.getBoundingClientRect();
    return JSON.stringify({ left: wantLeft, avWrap: [Math.round(r.left), Math.round(r.right)], btn: [Math.round(br.left), Math.round(br.right)], inScreen: br.right > 0 && br.left < 393 });
  })()`;
  console.log(JSON.stringify(await CDP.evalJson(api, expr, sid)));
  await new Promise(r => setTimeout(r, 500));
  await CDP.shot(api, sid, 'shots/top-avatar-after.png');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
