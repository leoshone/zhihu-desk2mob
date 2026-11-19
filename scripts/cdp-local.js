// cdp-local.js — 连本机调试 Chrome（端口 9333）的 CDP 工具库。
// 与 lib/cdp.js（真机 adb 转发）平行：本仓库测试脚本的 `require('./cdp')`
// 都转发到 lib 实现，接口一致 —— 本文件只是换一个 browser WS 地址。
// 用法：在测试脚本里 `require('./cdp-local')`。
'use strict';
const fs = require('fs');
const http = require('http');

const PORT = process.env.Z2M_CDP_PORT || 9222;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function connectWs(url, timeout = 8000) {
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
    const timer = setTimeout(() => rej(new Error('ws timeout')), timeout);
    ws.onopen = () => { clearTimeout(timer); res(api); };
    ws.onerror = e => { if (pend.size === 0) { clearTimeout(timer); rej(new Error('ws onerror ' + (e && e.message))); } };
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

// Chrome 157+ 要求连完整的 webSocketDebuggerUrl（带 UUID），短地址 /devtools/browser
// 会被拒（非 101）。先 HTTP 查版本接口拿真实地址。
function browserWsUrl() {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/json/version' }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d).webSocketDebuggerUrl); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
async function browserApi() { return connectWs(await browserWsUrl()); }
async function getTargets(api) { return (await api.send('Target.getTargets')).targetInfos || []; }

async function findTab(api, substr) {
  const ts = await getTargets(api);
  const pages = ts.filter(t => t.type === 'page');
  if (!substr) return pages[0];
  return pages.find(t => (t.url || '').includes(substr)) || null;
}

async function attach(api, targetId) {
  const r = await api.send('Target.attachToTarget', { targetId, flatten: true });
  return r.sessionId;
}

// 等页面 readyState 不再是 loading
async function waitReady(api, sid, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await api.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, sid);
      if (r.result && r.result.value && r.result.value !== 'loading') return;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('waitReady timeout');
}

async function evalJson(api, expr, sid) {
  const r = await api.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false }, sid);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}

async function screenshot(api, sid, file) {
  const r = await api.send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

// 小米13 视口（模拟桌面版网站：布局视口锁大、再整体缩小 —— 与 Kiwi 桌面模式同构）
// 真机口径：dpr 3.0235，可见 CSS 宽 ≈ 357.5。桌面模式 innerWidth 实测 ~891-1430。
// 这里用 393x873 物理逻辑宽 + 3.0235 dpr，桌面模式不缩放视口（脚本会自己反缩放）。
async function setDesktopViewport(api, sid) {
  await api.send('Emulation.setDeviceMetricsOverride', {
    width: 891, height: 1987, deviceScaleFactor: 3.0235, mobile: true,
  }, sid);
  await api.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sid);
}

module.exports = { browserApi, getTargets, findTab, attach, waitReady, evalJson, screenshot, sleep, setDesktopViewport };
