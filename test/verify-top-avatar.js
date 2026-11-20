// 通过暴力猴外部更新机制不可行；改为验证模式：
// 1) 在已装暴力猴脚本的首页标签上，把旧脚本的 reflowHeader 行为「就地替换」——
//    直接停掉旧注入行为不可行（无清理钩子），因此最终验证方案：
//    用 Target.createTarget 开【无脚本干扰】的验证页不可行（暴力猴对全站生效）。
// 2) 实际方案：暴力猴支持「从 URL 更新」——用它 options 页的更新按钮不可靠（UI 自动化脆弱）。
//    改用「编辑器替换」：暴力猴把脚本存 IndexedDB，直接写库太侵入。
// 3) 最实用：用户在手机暴力猴里手动点一次更新（脚本 @updateURL 指向 raw）。
//    本探针只负责：清掉被污染的标签、reload 首页、报告现状（等待用户更新后跑）。
const CDP = require('./lib/cdp.js');
(async () => {
  const api = await CDP.browserApi();
  const tab = (await CDP.getTargets(api)).filter(t => t.type === 'page' && t.url === 'https://www.zhihu.com/')[0];
  if (!tab) { console.log('no home tab'); process.exit(0); }
  const sid = await CDP.attach(api, tab.targetId);
  await api.send('Page.navigate', { url: 'https://www.zhihu.com/' }, sid);
  await CDP.waitReady(api, sid);
  await CDP.sleep(4000);
  const expr = `(() => {
    const bar = document.querySelector('.LeanAppHeaderBar');
    if (!bar) return JSON.stringify({ err: 'no bar' });
    const avWrap = bar.querySelector('[class*="css-1ww4ngr"]');
    if (!avWrap) return JSON.stringify({ err: 'no avWrap' });
    const r = avWrap.getBoundingClientRect();
    const btn = bar.querySelector('button[class*="AppHeader-profile"]');
    const br = btn ? btn.getBoundingClientRect() : null;
    const nav = bar.querySelector('nav');
    const nr = nav ? nav.getBoundingClientRect() : null;
    return JSON.stringify({
      left: Math.round(parseFloat(avWrap.style.left) || 0),
      avRight: Math.round(r.right),
      btn: br ? [Math.round(br.left), Math.round(br.right)] : null,
      navRight: nr ? Math.round(nr.right) : null,
      zoom: document.documentElement.style.zoom,
      inScreenOk: br && br.right <= 980 && br.left > (nr ? nr.right : 0)
    });
  })()`;
  console.log(JSON.stringify(await CDP.evalJson(api, expr, sid)));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
