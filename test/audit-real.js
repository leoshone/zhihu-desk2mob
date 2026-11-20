// audit-real.js — 真实走查（暴力猴已装 v1.5.0）：不注入、不模拟视口，
// 纯观察 Kiwi 原生桌面模式 + 暴力猴脚本的实际效果。
// 逐页导航（SPA 内部直接 navigate 会整页加载，暴力猴会重新注入），断言 + 截图。
// 用法: node test/audit-real.js [页名]   无参数 = 全部页
'use strict';
const fs = require('fs');
const path = require('path');
const cdp = require('./lib/cdp.js');

const OUT_DIR = path.join(__dirname, '..', '..', '_tmp-shots');

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
  const clipped = e => {
    let a = e.parentElement;
    while (a && a !== document.body) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== 'visible') {
        const b = a.getBoundingClientRect();
        if (b.right <= SW + 2) return true;
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
  return {
    url: location.href.slice(0,80),
    hasStyle: !!document.getElementById('z2m-style'),
    sw: SW,
    zoom: document.documentElement.style.zoom || '',
    vvW: visualViewport ? Math.round(visualViewport.width) : null,
    main: m ? rect(m) : null,
    overflowCount: overflows.length,
    overflowTop: top,
  };
})())`;

async function auditPage(api, name, url, shot) {
  const t = await cdp.findTab(api, 'zhihu.com') || await cdp.findTab(api, 'zhuanlan');
  if (!t) throw new Error('no zhihu tab');
  const sid = await cdp.attach(api, t.targetId);
  await api.send('Page.navigate', { url }, sid);
  await cdp.waitReady(api, sid, 40);
  await cdp.sleep(8000);   // 给暴力猴注入 + SPA 渲染足够时间
  const diag = await cdp.evalJson(api, CHECK, sid);
  await cdp.shot(api, sid, shot);
  return diag;
}

(async () => {
  const only = process.argv[2];
  const pages = only ? PAGES.filter(([n]) => n === only) : PAGES;
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const api = await cdp.browserApi();
  const results = [];
  try {
    for (const [name, url] of pages) {
      try {
        const shot = path.join(OUT_DIR, `real-${name}.png`);
        const d = await auditPage(api, name, url, shot);
        results.push(d);
        const m = d.main || [0, 0, 0, 0];
        const ok = d.hasStyle && m[0] >= -2 && m[0] + m[2] <= d.sw + 4 && m[2] > 100;
        console.log(`${ok ? 'PASS' : 'FAIL'} [${name}] main=[${m}] sw=${d.sw} zoom=${d.zoom} vv=${d.vvW} overflow=${d.overflowCount} ${d.overflowTop.join(' ')}`);
      } catch (e) {
        results.push({ name, error: e.message });
        console.log(`ERR  [${name}] ${e.message}`);
      }
    }
    fs.writeFileSync(path.join(OUT_DIR, 'audit-real.json'), JSON.stringify(results, null, 1));
    console.log('saved audit-real.json');
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
