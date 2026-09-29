// probe-avatar.js — 对比「发布框头像」与「评论列表头像」的尺寸/伸缩方式
// 用法: node probe-avatar.js [--tab <URL 子串>] [--off]
//   --off  先调用页面上的 window.__z2mStop() 再测，用于判断某个异常是否由脚本造成。
//          ⚠️ 该钩子是**半清理**：只摘样式表、断观察器、清定时器（1.0.6 起也还原了反缩放），
//          **不撤销各 pass 写入的内联样式**（display:none / max-width / flex / 头像尺寸等仍在）。
//          所以 --off 得到的是「少了样式表」而非「没有脚本」，别把它当无脚本基线；
//          判断「是否由改动引入」要用同一轮内的改前/改后对照。
'use strict';
const cdp = require('./cdp');

const TAB_SUBSTR = process.argv.includes('--tab') ? (process.argv[process.argv.indexOf('--tab') + 1] || '') : '';
const DISABLE = process.argv.includes('--off');

const JS = `JSON.stringify((()=>{
  const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
  const rect = el => { const b = el.getBoundingClientRect();
    return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const isAvatar = el => {
    const c = (el.className || '').toString();
    return el.tagName === 'IMG' && /(^|\\s)Avatar(\\s|$)/.test(c);
  };
  const desc = el => {
    const cs = getComputedStyle(el);
    return { cls: (el.className || '').toString().slice(0, 50), rect: rect(el),
             w: cs.width, h: cs.height, alignSelf: cs.alignSelf, objectFit: cs.objectFit,
             minH: cs.minHeight, maxH: cs.maxHeight, flex: cs.flex };
  };

  // 发布框头像：从「发布」按钮往上，找第一个内部含 img.Avatar 的祖先 —— 那个头像才是发布框的
  const btn = [...document.querySelectorAll('button')].find(b => norm(b.innerText) === '发布');
  let row = btn, cAvatar = null;
  while (row && row !== document.body && !(cAvatar = [...row.querySelectorAll('img')].filter(isAvatar)[0])) {
    row = row.parentElement;
  }
  if (row === document.body) { row = null; cAvatar = null; }

  const chain = [];
  if (cAvatar) {
    let n = cAvatar;
    while (n && n !== document.body && chain.length < 5) {
      const cs = getComputedStyle(n);
      chain.push({ tag: n.tagName, cls: (n.className || '').toString().slice(0, 50), rect: rect(n),
                   disp: cs.display, flexDir: cs.flexDirection, alignItems: cs.alignItems,
                   h: cs.height, minH: cs.minHeight });
      n = n.parentElement;
    }
  }

  // 评论列表头像 = 其余所有 Avatar，按尺寸归类
  const imgs = [...document.querySelectorAll('img')].filter(isAvatar);
  const listAvatars = imgs.filter(el => el !== cAvatar);
  const tally = {};
  listAvatars.forEach(el => { const k = rect(el)[2] + '×' + rect(el)[3]; tally[k] = (tally[k] || 0) + 1; });

  return {
    url: location.href,
    z2mOn: !!document.getElementById('z2m-style'),
    avatarRowRect: row ? rect(row) : null,
    composerAvatar: cAvatar ? desc(cAvatar) : null,
    composerAvatarChain: chain,
    listAvatarCount: listAvatars.length,
    listAvatarSizes: tally,
  };
})())`;

(async () => {
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, TAB_SUBSTR) || await cdp.findTab(api);
    if (!tab) throw new Error('no tab');
    const sid = await cdp.attach(api, tab.targetId);
    // 关键：发布框那一行（含头像与「发布」按钮）要**聚焦输入框后**才渲染 ——
    // 不点进去则既找不到头像也找不到按钮，会误判为「页面上没有发布框」。
    await cdp.evalJson(api, `JSON.stringify((()=>{
      const eds = [...document.querySelectorAll('[contenteditable="true"]')];
      if (!eds.length) return { err: 'no contenteditable' };
      const e = eds[eds.length - 1];
      e.scrollIntoView({ block: 'center' }); e.focus(); e.click();
      return { focused: document.activeElement === e, count: eds.length };
    })())`, sid);
    await cdp.sleep(2000);
    await cdp.evalJson(api, `JSON.stringify((()=>{
      const eds = [...document.querySelectorAll('[contenteditable="true"]')];
      const e = eds[eds.length - 1]; if (e) { e.scrollIntoView({ block: 'center' }); e.focus(); e.click(); }
      return 'refocus';
    })())`, sid);
    await cdp.sleep(1200);
    if (DISABLE) {
      console.log('关闭脚本 CSS -> ' + JSON.stringify(await cdp.evalJson(api,
        `JSON.stringify((()=>{ if (typeof window.__z2mStop !== 'function') return 'no __z2mStop'; window.__z2mStop(); return 'stopped'; })())`, sid)));
      await cdp.sleep(1500);
    }
    const d = await cdp.evalJson(api, JS, sid);
    console.log('页面: ' + d.url + '   脚本CSS生效=' + d.z2mOn);
    console.log('\n发布框所在行: ' + JSON.stringify(d.avatarRowRect));
    console.log('发布框头像: ' + JSON.stringify(d.composerAvatar));
    console.log('\n发布框头像的祖先链（由内向外）:');
    d.composerAvatarChain.forEach((c, i) => console.log('  ' + i + ' ' + JSON.stringify(c)));
    console.log('\n评论列表头像数: ' + d.listAvatarCount + '，尺寸分布: ' + JSON.stringify(d.listAvatarSizes));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
