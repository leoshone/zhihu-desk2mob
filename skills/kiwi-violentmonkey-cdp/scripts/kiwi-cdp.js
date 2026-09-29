// kiwi-cdp.js — 命令行入口：往真机 Kiwi 的暴力猴装/更新用户脚本、注入、列出与打开标签。
//
// 用法:
//   node kiwi-cdp.js install <RAW_URL>         自动装/更新用户脚本（无需真人点）
//   node kiwi-cdp.js verify  [EXT_ID]          开暴力猴 options 页，列出已装脚本
//   node kiwi-cdp.js inject  <FILE> [URL_SUBSTR] 把本地脚本注入活标签（刷新即还原）
//   node kiwi-cdp.js list                      列出标签
//
// 设计：CDP 连接/attach/eval/截图 全部复用 `scripts/cdp.js`，这里只做命令编排。
// 早期版本在本文件里自带一份 WS + eval 实现，与 cdp.js 重复；已改为单一来源。
//
// **自己开的标签自己关**：install 会关掉「安装页(confirm) + 它开的那张 raw 标签」，
// verify 会关掉它开的 options 页。否则每跑一次就在手机上多留标签。
'use strict';
const fs = require('fs');
const cdp = require('./cdp');

const DEFAULT_EXT = 'fcickoepngcnapddnnmjpkmpekmfmpaa';   // 本机暴力猴扩展 ID
const log = (...a) => console.log(...a);

const isConfirmPage = t => /confirm\/index\.html/.test(t.url || '');

// 关掉所有满足条件的标签，返回关掉的个数
async function closeTargets(api, pred) {
  let n = 0;
  for (const t of await cdp.getTargets(api)) {
    if (t.type !== 'page' || !pred(t)) continue;
    try { await api.send('Target.closeTarget', { targetId: t.targetId }); n++; } catch (e) {}
  }
  return n;
}

// --- install: 自动装/更新（核心：无需真人点）---
async function cmdInstall(rawUrl) {
  if (!rawUrl) { log('用法: node kiwi-cdp.js install <RAW_URL>'); process.exit(1); }
  const api = await cdp.browserApi();
  let createdId = null;
  try {
    // 1. 清掉陈旧的 confirm 标签（失败重试会留下多个，轮询会先抓到空白的那个）
    const stale = await closeTargets(api, isConfirmPage);
    if (stale) log('  清理陈旧 confirm 标签:', stale);

    // 2. 开新标签让暴力猴接管 raw URL（用已有标签 Page.navigate 会被当下载，ERR_ABORTED）
    const nt = await cdp.openTab(api, rawUrl);
    createdId = nt.targetId;
    log('createTarget ->', createdId);

    // 3. 轮询 confirm 页 → attach → 确认 #confirm 存在
    let sid = null, pageText = '';
    for (let i = 0; i < 30; i++) {
      await cdp.sleep(1500);
      const c = (await cdp.getTargets(api)).find(isConfirmPage);
      if (!c) continue;
      const cs = await cdp.attach(api, c.targetId);
      await cdp.waitReady(api, cs, 10);
      const has = await cdp.evalJson(api, `JSON.stringify(!!document.querySelector('#confirm'))`, cs);
      pageText = (await cdp.evalJson(api, `JSON.stringify((document.body.innerText||'').slice(0,200))`, cs)) || '';
      log(`  poll ${i}: hasBtn=${has} text=${JSON.stringify(pageText)}`);
      if (has) { sid = cs; break; }
      try { await api.send('Target.detachFromTarget', { sessionId: cs }); } catch (e) {}
    }
    if (!sid) { log('NO usable confirm page'); process.exitCode = 1; return; }

    // 4. 点安装/更新，并等暴力猴把它写进去
    const r = await cdp.evalJs(api, `(()=>{const b=document.querySelector('#confirm'); if(b){b.click(); return 'clicked';} return 'no #confirm';})()`, sid);
    log('CLICK #confirm ->', r && r.value);
    // 脚本名与版本就在 confirm 页文本里，顺手报出来
    const title = (pageText.split('\n')[1] || '').trim();
    if (title) log('  已提交:', title);
    await cdp.sleep(3000);
    log('  注意: 本命令只保证「点击已送达」，是否真的装入请用 verify 复核。');
  } finally {
    // 5. 关掉自己开的那张标签 + 安装页（否则会在手机上留两个标签，只在下次 install 才被顺手清掉）
    const closedCreated = createdId ? (await closeTargets(api, t => t.targetId === createdId)) : 0;
    const closedConfirm = await closeTargets(api, isConfirmPage);
    log('  已关闭安装相关标签:', closedCreated + closedConfirm);
    api.close();
  }
}

// --- verify: 开 options 页读清单（authoritative），读完关掉自己开的页 ---
async function cmdVerify(extId) {
  const api = await cdp.browserApi();
  try {
    const nt = await cdp.openTab(api, `chrome-extension://${extId || DEFAULT_EXT}/options/index.html`);
    const cs = await cdp.attach(api, nt.targetId);
    await cdp.waitReady(api, cs, 20);
    await cdp.sleep(2000);
    const body = await cdp.evalJson(api, `JSON.stringify(document.body.innerText)`, cs);
    log('INSTALLED SCRIPTS:\n' + (body || '(empty)'));
    const closed = await closeTargets(api, t => t.targetId === nt.targetId);
    log('  已关闭 options 标签:', closed);
  } finally { api.close(); }
}

// --- inject: 把本地脚本文件注入活标签（临时，刷新即还原）---
async function cmdInject(file, substr) {
  if (!file) { log('用法: node kiwi-cdp.js inject <FILE> [URL_SUBSTR]'); process.exit(1); }
  const code = fs.readFileSync(file, 'utf8');
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, substr);
    if (!tab) { log('NO matching tab'); process.exitCode = 1; return; }
    const cs = await cdp.attach(api, tab.targetId);
    await cdp.waitReady(api, cs, 30);
    const r = await cdp.evalJs(api, `(()=>{ try { ${code} ; return 'injected'; } catch(e){ return 'ERR:'+e.message; } })()`, cs);
    log('inject', file, '->', r && r.value);
  } finally { api.close(); }
}

// --- list: 列标签（注意字段是 targetId，不是 id）---
async function cmdList() {
  const api = await cdp.browserApi();
  try {
    for (const t of (await cdp.getTargets(api)).filter(t => t.type === 'page')) {
      log(' ', t.targetId, t.url);
    }
  } finally { api.close(); }
}

(async () => {
  const [, , cmd, a1, a2] = process.argv;
  if (cmd === 'install') return cmdInstall(a1);
  if (cmd === 'verify') return cmdVerify(a1);
  if (cmd === 'inject') return cmdInject(a1, a2);
  if (cmd === 'list') return cmdList();
  log('Usage: node kiwi-cdp.js [install <RAW>|verify [EXT]|inject <FILE> [URL]|list]');
  process.exit(1);
})().catch(e => { log('ERR', e.message); process.exit(1); });
