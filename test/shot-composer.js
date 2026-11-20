// shot-composer.js — 抓评论发布框「修复前 / 修复后」对比截图（保持输入框聚焦态）
// 用法: node shot-composer.js before | after
//   before : 重载页面后不注入脚本，聚焦输入框 → 截图
//   after  : 重载页面 → 注入 src 脚本 → 聚焦输入框 → 截图
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const cdp = require('./cdp');

const SCRIPT = path.join(__dirname, '..', 'zhihu-desk2mob.user.js');
const mode = process.argv[2] === 'after' ? 'after' : 'before';
const out = 'shots/16-composer-' + mode + '.png';

const FOCUS = `JSON.stringify((()=>{
  const eds = [...document.querySelectorAll('[contenteditable="true"]')];
  if (!eds.length) return { err: 'no contenteditable' };
  const e = eds[eds.length - 1];
  e.scrollIntoView({ block: 'center' });
  e.focus(); e.click();
  return { focused: document.activeElement === e };
})())`;

const MEASURE = `JSON.stringify((()=>{
  const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
  const strip = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, '');
  const Q = '同时发布到想法';
  const rect = el => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  let leaf = null;
  try {
    const snap = document.evaluate("//*[contains(., '" + Q + "')]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < snap.snapshotLength; i++) { const el = snap.snapshotItem(i); if (strip(el.textContent) === Q) leaf = el; }
  } catch (e) {}
  let outer = leaf;
  while (outer && outer !== document.body && !norm(outer.innerText).includes('理性发言')) outer = outer.parentElement;
  const btn = [...document.querySelectorAll('button')].find(b => norm(b.innerText) === '发布');
  return { optionExists: !!leaf,
           optionLeafRect: leaf ? rect(leaf) : null,
           optionHidden: leaf ? getComputedStyle(leaf.parentElement).display === 'none' : null,
           composerRect: outer && outer !== document.body ? rect(outer) : null,
           publishRect: btn ? rect(btn) : null,
           publishText: btn ? norm(btn.innerText) : null };
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

    if (mode === 'after') {
      const code = fs.readFileSync(SCRIPT, 'utf8');
      const r = await cdp.evalJs(api, `(()=>{ try { ${code}\n; return 'injected'; } catch(e){ return 'ERR:' + e.message; } })()`, sid);
      console.log('注入 -> ' + JSON.stringify(r && r.value));
      await cdp.sleep(1800);
    }

    console.log('聚焦 -> ' + JSON.stringify(await run(FOCUS)));
    await cdp.sleep(1800);
    await run(FOCUS);                       // 再点一次，确保隐藏后布局稳定且仍是聚焦态
    await cdp.sleep(1000);
    console.log('度量 -> ' + JSON.stringify(await run(MEASURE)));
    execSync('adb exec-out screencap -p > "' + out + '"', { shell: 'bash' });
    console.log('截图: ' + out);
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
