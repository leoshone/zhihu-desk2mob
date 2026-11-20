// 在暴力猴 options 页读取已装脚本列表（确认版本），并尝试通过 UI 更新脚本
const CDP = require('./lib/cdp.js');
(async () => {
  const api = await CDP.browserApi();
  const tab = (await CDP.getTargets(api)).filter(t => t.type === 'page' && (t.url || '').includes('jinjac'))[0];
  const sid = await CDP.attach(api, tab.targetId);
  await CDP.sleep(1500);
  const expr = `(() => {
    const items = [...document.querySelectorAll('.script, [class*=script]')].slice(0, 10).map(e => (e.innerText || '').split('\\n').slice(0, 3).join(' | '));
    return JSON.stringify({ url: location.hash, items });
  })()`;
  console.log(JSON.stringify(await CDP.evalJson(api, expr, sid)));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
