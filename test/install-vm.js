// 通过暴力猴的安装页把新脚本装进真机：打开 raw URL 触发安装确认页，自动点确认
const CDP = require('./lib/cdp.js');
const RAW = 'https://raw.githubusercontent.com/leoshone/zhihu-desk2mob/main/zhihu-desk2mob.user.js';
(async () => {
  const api = await CDP.browserApi();
  // 暴力猴拦截 .user.js 会开安装页
  await api.send('Target.createTarget', { url: RAW });
  await CDP.sleep(6000);
  const ts = (await CDP.getTargets(api)).filter(t => t.type === 'page');
  const inst = ts.find(t => (t.url || '').includes('jinjac') || (t.url || '').includes(RAW));
  if (!inst) { console.log('no install tab; tabs:', ts.map(t => t.url.slice(0, 60)).join(' | ')); process.exit(1); }
  const sid = await CDP.attach(api, inst.targetId);
  await CDP.sleep(2000);
  // dump 安装页按钮
  const expr = `(() => {
    const btns = [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean);
    return JSON.stringify({ url: location.href.slice(0, 80), btns });
  })()`;
  console.log(JSON.stringify(await CDP.evalJson(api, expr, sid)));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
