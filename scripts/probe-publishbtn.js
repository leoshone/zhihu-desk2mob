// probe-publishbtn.js — 「发布」按钮是否落在可视区内；以及这是否由脚本 CSS 造成
//
// ⚠️ 方法局限（真机实测确认，务必先读）：
//   它用 window.__z2mStop() 当「关掉脚本」的基线，但那个钩子是**半清理** —— 只摘样式表、
//   断观察器、清定时器（1.0.6 起额外还原了反缩放），**不撤销各 pass 写入的内联样式**
//   （display:none / max-width / flex / 头像尺寸等仍在）。
//   因此下面【无脚本 CSS】那一组数据**不是有效的无脚本对照**，只能当作「少了样式表会怎样」
//   的参考。要真正的无脚本基线，得让暴力猴不注入该脚本（或整页重载且脚本未生效）。
//   判断「问题是否由某次改动引入」请用**同一轮内的改前/改后对照**（那份数据是有效的），
//   不要用这里的 --off 组。
//
// 做法：同一页面先在「脚本 CSS 生效」下测量，再调 __z2mStop() 复测。
'use strict';
const cdp = require('./cdp');

const M = `JSON.stringify((()=>{
  const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
  const rect = el => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const btn = [...document.querySelectorAll('button')].find(b => norm(b.innerText) === '发布');
  const btnV = [...document.querySelectorAll('button')].find(b => /发布/.test(norm(b.innerText)));
  const ed = [...document.querySelectorAll('[contenteditable="true"]')].pop();
  const cs = btn ? getComputedStyle(btn) : null;
  const vw = document.body.getBoundingClientRect().width;
  const r = btn ? rect(btn) : null;
  return {
    z2mStyle: !!document.getElementById('z2m-style'),
    viewportW: Math.round(vw),
    bodyRect: rect(document.body),
    publish: btn ? { rect: r, whiteSpace: cs.whiteSpace, flex: cs.flex, minW: cs.minWidth,
                     overflowsRight: r[0] + r[2] > vw + 1, visibleW: Math.max(0, Math.min(r[0] + r[2], vw) - Math.max(r[0], 0)) } : null,
    publishAnyMatch: btnV ? norm(btnV.innerText) : null,
    editableFocused: document.activeElement === ed,
  };
})())`;

const FOCUS = `JSON.stringify((()=>{
  const eds = [...document.querySelectorAll('[contenteditable="true"]')];
  if (!eds.length) return { err: 'no editable' };
  const e = eds[eds.length - 1]; e.scrollIntoView({ block: 'center' }); e.focus(); e.click();
  return { focused: document.activeElement === e };
})())`;

(async () => {
  const api = await cdp.browserApi();
  try {
    const src = await cdp.findTab(api, 'zhuanlan.zhihu.com') || await cdp.findTab(api);
    const sid = await cdp.attach(api, src.targetId);
    const run = e => cdp.evalJson(api, e, sid);

    await api.send('Page.navigate', { url: src.url }, sid);
    await cdp.waitReady(api, sid, 30);
    await cdp.sleep(3500);
    await run(FOCUS);
    await cdp.sleep(2000);
    await run(FOCUS);
    await cdp.sleep(1000);
    console.log('【脚本 CSS 生效】  ' + JSON.stringify(await run(M)));

    console.log('\n调用 __z2mStop() 去掉脚本 CSS…');
    console.log('  -> ' + JSON.stringify(await run(`JSON.stringify((()=>{ if (typeof window.__z2mStop !== 'function') return 'no stop'; window.__z2mStop(); return 'stopped'; })())`)));
    await cdp.sleep(1200);
    await run(FOCUS);
    await cdp.sleep(1200);
    console.log('【无脚本 CSS】     ' + JSON.stringify(await run(M)));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
