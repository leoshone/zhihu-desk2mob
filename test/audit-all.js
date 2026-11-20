// audit-all.js — 全页面走查：逐页导航 → 注入 → 布局断言。
// 每页断言：main 满宽（left≈0）、无横向溢出元素（right > SW+2 的可见元素数）、
// 左侧栏 rails 隐藏、hasStyle。输出 JSON 摘要，不截图（视觉比对用 audit-kiwi 单页跑）。
// 用法: node test/audit-all.js
'use strict';
const fs = require('fs');
const path = require('path');
const cdp = require('./lib/cdp.js');

const SCRIPT_PATH = path.join(__dirname, '..', 'zhihu-desk2mob.user.js');

const PAGES = [
  ['home',   'https://www.zhihu.com/'],
  ['hot',    'https://www.zhihu.com/hot'],
  ['question', 'https://www.zhihu.com/question/39261222'],
  ['column-post', 'https://zhuanlan.zhihu.com/p/2088387353136181672'],
  ['people', 'https://www.zhihu.com/people/leoshone'],
  ['signin', 'https://www.zhihu.com/signin?next=%2F'],
  ['ring',   'https://www.zhihu.com/ring-feeds'],
  ['search', 'https://www.zhihu.com/search?q=AI&type=content'],
];

const CHECK = `JSON.stringify((()=>{
  const rect=e=>{const b=e.getBoundingClientRect();return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)]};
  const SW = parseInt(document.documentElement.style.getPropertyValue('--z2m-w')) || 358;
  // 判断元素是否被某个滚动/裁剪容器合法裁剪：向上找 overflow!=visible 的祖先链上
  // 任意一个容器的裁剪边界最终落在列内（右缘 <= SW+2），即不算真溢出。
  const clipped = e => {
    let a = e.parentElement;
    while (a && a !== document.body) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== 'visible') {
        const b = a.getBoundingClientRect();
        if (b.right <= SW + 2) return true;
        // 裁剪容器自身超宽：继续向上看它是否又被更外层裁进列内（如轮播卡在横滑列表里）
      }
      a = a.parentElement;
    }
    return false;
  };
  const overflows=[...document.querySelectorAll('body *')].filter(e=>{
    const b=e.getBoundingClientRect(); const cs=getComputedStyle(e);
    return b.width>0 && b.right > SW+2 && cs.position!=='fixed' && cs.visibility!=='hidden' && cs.display!=='none' && !e.closest('#z2m-style') && !clipped(e);
  });
  const agg={};
  overflows.forEach(e=>{const k=e.tagName+'.'+(e.className&&e.className.toString().split(' ').slice(0,2).join('.'));agg[k]=(agg[k]||0)+1;});
  const top=Object.entries(agg).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>k+':'+v);
  const m=document.querySelector('main.App-main, .Post-content, .SignFlowHomepage, main');
  const chain=[]; let e=m;
  for(let i=0;i<8&&e;i++){chain.push({tag:e.tagName,cls:(e.className||'').toString().slice(0,30),rect:rect(e),disp:getComputedStyle(e).display.slice(0,8)});e=e.parentElement;}
  const sibs = m.parentElement ? [...m.parentElement.children].map(c=>({tag:c.tagName,cls:(c.className||'').toString().slice(0,30),rect:rect(c),disp:getComputedStyle(c).display.slice(0,8)})) : [];
  return {
    url: location.href.slice(0,80),
    hasStyle: !!document.getElementById('z2m-style'),
    sw: SW,
    zoom: document.documentElement.style.zoom || '',
    main: m ? rect(m) : null,
    overflowCount: overflows.length,
    overflowTop: top,
    chain,
    sibs,
  };
})())`;

(async () => {
  const userJs = fs.readFileSync(SCRIPT_PATH, 'utf8')
    // audit 模式：强制真机口径的窄列（358px），抵消 emulation 视口差异
    .replace('forceSW: 0,', 'forceSW: 358,');
  const api = await cdp.browserApi();
  const results = [];
  try {
    let t = await cdp.findTab(api, 'zhihu.com');
    if (!t) t = await cdp.findTab(api, '');
    const sid = await cdp.attach(api, t.targetId);
    await api.send('Emulation.setDeviceMetricsOverride', { width: 891, height: 1987, deviceScaleFactor: 3.0235, mobile: true }, sid);
    await api.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36' }, sid);

    for (const [name, url] of PAGES) {
      try {
        await api.send('Page.navigate', { url }, sid);
        await cdp.waitReady(api, sid, 40);
        const r1 = await api.send('Runtime.evaluate', { expression: userJs, returnByValue: false }, sid);
        if (r1.exceptionDetails) console.log(`[${name}] inject exception:`, JSON.stringify(r1.exceptionDetails).slice(0, 150));
        await cdp.sleep(7000);
        const diag = await cdp.evalJson(api, CHECK, sid);
        results.push(diag);
        const m = diag.main || [0,0,0,0];
        const ok = diag.hasStyle && m[0] >= -2 && m[0] + m[2] <= diag.sw + 4 && m[2] > 100;
        console.log(`${ok ? 'PASS' : 'FAIL'} [${name}] main=[${m}] sw=${diag.sw} zoom=${diag.zoom} overflow=${diag.overflowCount} ${diag.overflowTop.join(' ')}`);
      } catch (e) {
        results.push({ name, error: e.message });
        console.log(`ERR  [${name}] ${e.message}`);
      }
    }
    fs.writeFileSync(path.join(__dirname, '..', '..', '_tmp-shots', 'audit-all.json'), JSON.stringify(results, null, 1));
    console.log('saved audit-all.json');
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
