// cdp.js — 可复用的 CDP 工具库（真机 Kiwi 浏览器）
// 职责：建立 browser 级 WS 连接、attach 到指定标签页、执行 JS、截图。
// 设计要点：
//  - 每轮 bash 都会重置 adb forward，所以模块加载时自动重建转发。
//  - 所有 evaluate 都带超时包装（技能坑：CDP 长会话可能挂死 renderer）。
'use strict';
const fs = require('fs');
const http = require('http');
const { execSync } = require('child_process');

const ADB_FORWARD = () => {
  try { execSync('adb forward tcp:9222 localabstract:chrome_devtools_remote', { stdio: 'ignore' }); } catch (e) {}
};
ADB_FORWARD();

const sleep = ms => new Promise(r => setTimeout(r, ms));

function connectWs(url, timeout = 6000) {
  return new Promise((res, rej) => {
    const ws = new globalThis.WebSocket(url);
    const pend = new Map();
    let id = 0;
    const evh = new Map();
    const api = {
      ws,
      send: (m, p = {}, sid) => new Promise((r2, j2) => {
        const i = ++id;
        pend.set(i, { r2, j2 });
        const msg = { id: i, method: m, params: p };
        if (sid) msg.sessionId = sid;
        try { ws.send(JSON.stringify(msg)); } catch (e) { j2(e); }
      }),
      on: (e, cb) => evh.set(e, cb),
      close: () => { try { ws.close(); } catch (e) {} },
    };
    // 超时定时器必须连上就清掉：不清的话它会一直挂在事件循环里，
    // 既让 Node 进程退出被拖住最长 timeout，也会在已 resolve 后再调一次 rej（虽无害但脏）。
    const timer = setTimeout(() => rej(new Error('ws timeout')), timeout);
    const done = () => clearTimeout(timer);
    ws.onopen = () => { done(); res(api); };
    ws.onerror = e => { if (pend.size === 0) { done(); rej(new Error('ws onerror ' + (e && e.message))); } };
    ws.onmessage = m => {
      let j; try { j = JSON.parse(m.data); } catch (e) { return; }
      if (j.id && pend.has(j.id)) {
        const { r2, j2 } = pend.get(j.id); pend.delete(j.id);
        j.error ? j2(new Error(JSON.stringify(j.error))) : r2(j.result);
      } else if (j.method && evh.has(j.method)) {
        try { evh.get(j.method)(j.params || {}); } catch (e) {}
      }
    };
  });
}

async function browserApi() { return connectWs('ws://127.0.0.1:9222/devtools/browser'); }
async function getTargets(api) { return (await api.send('Target.getTargets')).targetInfos || []; }

// 找到第一个匹配 url 子串的 page 标签；无子串时取第一个 page
async function findTab(api, substr) {
  const ts = await getTargets(api);
  const pages = ts.filter(t => t.type === 'page');
  if (!substr) return pages[0] || null;
  return pages.find(t => (t.url || '').includes(substr)) || null;
}

// attach 并打开 Runtime，返回 sessionId
async function attach(api, targetId) {
  const sid = (await api.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await api.send('Runtime.enable', {}, sid);
  await api.send('Page.enable', {}, sid).catch(() => {});
  return sid;
}

// 带超时的 Runtime.evaluate；返回 result 对象 {type, value, ...}
async function evalJs(api, expr, sid, timeout = 15000) {
  const r = await Promise.race([
    api.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid),
    new Promise((_, rej) => setTimeout(() => rej(new Error('eval timeout')), timeout)),
  ]);
  if (r && r.exceptionDetails) throw new Error('JS exception: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r && r.result;
}

// evaluate 并解析 JSON 返回值（脚本里用 JSON.stringify 返回）
async function evalJson(api, expr, sid, timeout) {
  const r = await evalJs(api, expr, sid, timeout);
  if (!r || r.value == null) return null;
  try { return JSON.parse(r.value); } catch (e) { return r.value; }
}

async function shot(api, sid, path, timeout = 10000) {
  try {
    const r = await Promise.race([
      api.send('Page.captureScreenshot', { format: 'png' }, sid),
      new Promise((_, rej) => setTimeout(() => rej(new Error('shot timeout')), timeout)),
    ]);
    fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
    return path;
  } catch (e) { console.log('  (shot skipped:', e.message + ')'); return null; }
}

// 等待 document.readyState === 'complete'
async function waitReady(api, sid, tries = 20) {
  for (let i = 0; i < tries; i++) {
    try {
      const o = await evalJson(api, `JSON.stringify({rs:document.readyState,de:!!document.documentElement})`, sid, 5000);
      if (o && o.de && o.rs === 'complete') return true;
    } catch (e) {}
    await sleep(800);
  }
  return false;
}

// 通过 host 命令行打开新标签
async function openTab(api, url) { return api.send('Target.createTarget', { url }); }

module.exports = { ADB_FORWARD, sleep, connectWs, browserApi, getTargets, findTab, attach, evalJs, evalJson, shot, waitReady, openTab };
