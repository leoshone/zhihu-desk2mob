#!/usr/bin/env node
// 快速体检：脚本是否**真的注入**到了真机上。
//
// 为什么需要它：整套 CSS 写在一个 JS 模板串里（`st.textContent = \`...\`;`）。
// 只要在注释或规则里混入反引号，模板串就会被**提前闭合** —— 后果是 #z2m-style
// 根本插不进去、样式全失效，而 `node --check` **可能照样通过**
// （反引号成对时语法恰好合法），错误一路带到真机。
// 本项目已踩三次（最近一次 2026-10-01，改「关注者 | 被浏览」竖线时）。
//
// 静态检查做不可靠（模板串内有故意的嵌套模板串），所以这里做运行时体检：
// 重载页面后直接查 #z2m-style 是否存在 —— 改完 CSS 先跑这个，几秒钟出结果。
//
// 用法：node scripts/check-injected.js [url子串]
'use strict';
const cdp = require('../.workbuddy/skills/kiwi-violentmonkey-cdp/scripts/cdp.js');

const substr = process.argv[2] || 'zhihu.com';

(async () => {
  const api = await cdp.browserApi();
  const ts = await cdp.getTargets(api);
  const tab = ts.find(t => t.type === 'page' && (t.url || '').includes(substr));
  if (!tab) { console.error('!! 没找到匹配页面:', substr); api.close(); process.exit(1); }
  const sid = await cdp.attach(api, tab.targetId);
  await api.send('Page.navigate', { url: tab.url }, sid);
  await cdp.waitReady(api, sid, 30);
  await cdp.sleep(3000);
  const r = await cdp.evalJson(api, `JSON.stringify({
    style: !!document.getElementById('z2m-style'),
    styleRules: (() => { const el = document.getElementById('z2m-style'); if (!el || !el.sheet) return null; try { return el.sheet.cssRules.length; } catch (e) { return 'ERR'; } })(),
    tick: typeof window.__z2mTick,
    url: location.href.slice(0, 50)
  })`, sid, 12000);
  api.close();
  console.log(r);
  const ok = r.style && r.tick === 'function' && typeof r.styleRules === 'number' && r.styleRules > 50;
  if (ok) {
    console.log(`OK: 已注入，样式表 ${r.styleRules} 条规则 ✓`);
  } else {
    console.error('!! 注入异常 —— 若刚改过 CSS，先检查模板串里是否混入了反引号（注释里也不行）');
    process.exit(1);
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
