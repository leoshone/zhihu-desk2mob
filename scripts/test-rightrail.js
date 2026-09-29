// test-rightrail.js — 验证「右边缘残留的侧栏/页脚（帮助中心、举报中心、关于知乎…）已被清除」
// 用法: node test-rightrail.js             重载首页并注入 src 下脚本
//       node test-rightrail.js --installed 测真机暴力猴里已安装的版本
//
// 背景（实测）：首页侧栏容器宽度塌成 0，但 overflow:visible 让里面的文字照旧溢出显示，
// 且 0 宽 ⇒ white-space:normal 让每个字各自换行 —— 屏幕上就是右边缘一条逐字竖排的文字。
// 断言：① 这些链接不再可见；② 右边缘没有可见的溢出元素；③ **正文列没被误伤**（反向保护）。
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const cdp = require('./cdp');

const SCRIPT = path.join(__dirname, '..', 'zhihu-desk2mob.user.js');
const INJECT_MODE = process.argv[2] !== '--installed';
const TAB_SUBSTR = 'www.zhihu.com';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const ST = `JSON.stringify((()=>{
  const KW = ['帮助中心', '举报中心', '关于知乎', '服务热线', '大家都在搜', '推荐关注'];
  const vis = el => { if (!el) return null;
    if (typeof el.checkVisibility === 'function') return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const rect = el => { const b = el.getBoundingClientRect();
    return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };

  const found = {};
  for (const k of KW) {
    const all = [...document.querySelectorAll('a, span, li, p, div, footer')].filter(el => (el.textContent || '').includes(k));
    const deepest = all.filter(el => ![...el.children].some(c => (c.textContent || '').includes(k)));
    const el = deepest[deepest.length - 1] || null;
    found[k] = el ? { visible: vis(el), rect: rect(el), hiddenByAncestorCls: (() => {
      let n = el; while (n && n !== document.body) { if (getComputedStyle(n).display === 'none') return (n.className || '').toString().slice(0, 30); n = n.parentElement; }
      return null; })() } : null;
  }

  const bodyW = Math.round(document.body.getBoundingClientRect().width);
  // 「文字溢出塌陷盒子」的特征：可见、宽度≤4、却含文字 —— 右边缘那条竖排残留就是这样。
  // 断言只覆盖**右边缘带**（x ≥ bodyW-40）：那是本次报告的范围。
  // 同时把整页范围内的同类残留一并报出来（很多是别处的既有问题，不在这里断言）。
  const collapsedWithText = [], collapsedElsewhere = [];
  for (const el of document.querySelectorAll('main *')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 4 || r.height < 20) continue;
    const t = (el.innerText || '').replace(/\\s+/g, ' ').trim();
    if (!t) continue;
    const rec = { cls: (el.className || '').toString().slice(0, 30), rect: rect(el), txt: t.slice(0, 20) };
    if (r.left >= bodyW - 40) { if (collapsedWithText.length < 8) collapsedWithText.push(rec); }
    else if (collapsedElsewhere.length < 8) collapsedElsewhere.push(rec);
  }

  const mainCol = document.querySelector('.Topstory-mainColumn');
  return { z2m: !!document.getElementById('z2m-style'), bodyW, found, collapsedWithText, collapsedElsewhere,
           mainCol: mainCol ? { visible: vis(mainCol), rect: rect(mainCol) } : null,
           feedItems: document.querySelectorAll('.Topstory-mainColumn .ContentItem').length };
})())`;

(async () => {
  const code = fs.readFileSync(SCRIPT, 'utf8');
  console.log('脚本: ' + SCRIPT.split(/[\\/]/).pop() + '  [' + (INJECT_MODE ? '注入模式' : '已安装版本') + ']');
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, TAB_SUBSTR) || await cdp.findTab(api);
    if (!tab) throw new Error('未找到知乎标签');
    const sid = await cdp.attach(api, tab.targetId);
    await api.send('Page.navigate', { url: 'https://www.zhihu.com/' }, sid);
    await cdp.waitReady(api, sid, 30);
    await cdp.sleep(3500);
    if (INJECT_MODE) {
      const r = await cdp.evalJs(api, `(()=>{ try { ${code}\n; return 'injected'; } catch(e){ return 'ERR:' + e.message; } })()`, sid);
      console.log('注入 -> ' + JSON.stringify(r && r.value));
      await cdp.sleep(2500);
    }
    // 发一次 tick，让各 pass 跑起来
    await cdp.evalJs(api, `(()=>{ if (window.__z2mTick) window.__z2mTick(); return 1; })()`, sid);
    await cdp.sleep(1200);
    await cdp.evalJs(api, `(()=>{ if (window.__z2mTick) window.__z2mTick(); return 1; })()`, sid);
    await cdp.sleep(800);

    const s = await cdp.evalJson(api, ST, sid);
    console.log('\nbody 宽=' + s.bodyW + '   首页信息流条目=' + s.feedItems);
    for (const k of Object.keys(s.found)) {
      const f = s.found[k];
      console.log('  [' + k + '] ' + (f ? 'visible=' + f.visible + ' rect=' + JSON.stringify(f.rect) +
        ' 被隐藏于=' + f.hiddenByAncestorCls : '页面上没有'));
    }
    console.log('  右边缘「宽≤4 却含文字」: ' + JSON.stringify(s.collapsedWithText));
    if (s.collapsedElsewhere.length) {
      console.log('  提示：别处也有同类残留（不在本次报告范围，未断言）:');
      s.collapsedElsewhere.forEach(c => console.log('     ' + JSON.stringify(c)));
    }
    console.log('  正文列: ' + JSON.stringify(s.mainCol));

    ok(s.z2m, '脚本已生效（#z2m-style 存在）', s.z2m);
    // ① 用户点名的那几项不得可见
    for (const k of ['帮助中心', '举报中心', '关于知乎', '服务热线']) {
      const f = s.found[k];
      if (f === null) { console.log('  PASS  [' + k + '] 页面上已没有该文案'); pass++; continue; }
      ok(f.visible === false, '[' + k + '] 已不可见', f);
    }
    // ② 右边缘不该再有可见的溢出文字
    ok(s.collapsedWithText.length === 0, '右边缘没有「文字溢出塌陷盒子」的残留', s.collapsedWithText);
    // ③ 反向保护：正文列必须还在
    ok(!!s.mainCol && s.mainCol.visible === true, '正文列仍然可见（没被误伤）', s.mainCol);
    ok(!!s.mainCol && s.mainCol.rect.w > 250, '正文列宽度正常（>250px）', s.mainCol && s.mainCol.rect);
    ok(s.feedItems >= 1, '首页信息流条目仍在（' + s.feedItems + ' 条）', s.feedItems);

    await api.send('Page.bringToFront', {}, sid);
    const p = 'shots/22-home-after.png';
    execSync('adb exec-out screencap -p > "' + p + '"', { shell: 'bash' });
    console.log('\n截图: ' + p);
    console.log('\n===== 结果: ' + pass + ' passed / ' + fail + ' failed =====');
    process.exitCode = fail ? 1 : 0;
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
