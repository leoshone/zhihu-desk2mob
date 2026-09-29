# CDP 工具包（detail）

SKILL.md 只放结论，这里放可直接复用的代码与排错细节。本 skill 是**通用能力**：下面以 zhihu2mob 为例，但 `install` / `inject` / `verify` 对任意 raw `.user.js` 与任意站点都适用。

## 关键事实（实测，非推断）
- 环境：安卓真机（小米 fuxi，1080×2400，CSS 宽 393px）+ Kiwi 浏览器 + 暴力猴（Violentmonkey）扩展。
- 暴力猴扩展 ID：`fcickoepngcnapddnnmjpkmpekmfmpaa`（装/更新流程依赖它的 `confirm/index.html` 与 `options/index.html`）。
- adb：已加入 PATH，装于 `C:\platform-tools`（直接调用 `adb`，无需指定路径）。
- Node 22 全局 `WebSocket` / `fetch` 可用：`C:/Users/xiongbin/.workbuddy/binaries/node/versions/22.22.2-3/node.exe`。
- **CDP 能自动装/更新脚本**（无需真人）：browser 级 WS + `Target.createTarget{url:RAW}` 开新标签 → 暴力猴弹 confirm 页 → 点 `#confirm`。已真机验证：
  - 清掉陈旧 confirm 标签 → createTarget → confirm 页文本「重新安装脚本（代码一致）… 1.0.2」→ 点 `#confirm` → options 页确认「知乎桌面版·手机单列适配 1.0.2」已装入。

## attach() — 连 browser 级 WS 的最小封装
```js
const WS = globalThis.WebSocket;
function connectBrowser() {
  return new Promise((res, rej) => {
    const ws = new WS('ws://127.0.0.1:9222/devtools/browser');
    const pend = new Map(); let id = 0; const evh = new Map();
    const api = {
      ws,
      send: (m, p = {}, sid) => new Promise((r2, j2) => {
        const i = ++id; pend.set(i, { r2, j2 });
        const msg = { id: i, method: m, params: p }; if (sid) msg.sessionId = sid;
        try { ws.send(JSON.stringify(msg)); } catch (e) { j2(e); }
      }),
      close: () => { try { ws.close(); } catch (e) {} }
    };
    ws.onopen = () => res(api);
    ws.onerror = e => { if (pend.size === 0) rej(new Error('ws onerror ' + (e && e.message))); };
    ws.onmessage = m => {
      let j; try { j = JSON.parse(m.data); } catch (e) { return; }
      if (j.id && pend.has(j.id)) { const { r2, j2 } = pend.get(j.id); pend.delete(j.id); j.error ? j2(new Error(JSON.stringify(j.error))) : r2(j.result); }
    };
    setTimeout(() => rej(new Error('ws timeout')), 5000);
  });
}
```

## install(RAW) — 自动装/更新（核心）
```js
async function install(api, RAW) {
  // 1. 清掉残留 confirm 标签，避免点到空白/陈旧页
  const tg0 = await api.send('Target.getTargets');
  for (const t of (tg0.targetInfos || []))
    if (/confirm\/index\.html/.test(t.url || ''))
      try { await api.send('Target.closeTarget', { targetId: t.targetId }); } catch (e) {}

  // 2. 开新标签让暴力猴接管 raw URL
  const nt = await api.send('Target.createTarget', { url: RAW });

  // 3. 轮询 confirm 页，attach，确认 #confirm 存在再点
  let sid = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const tg = await api.send('Target.getTargets');
    const c = (tg.targetInfos || []).find(t => /confirm\/index\.html/.test(t.url || ''));
    if (!c) continue;
    const cs = (await api.send('Target.attachToTarget', { targetId: c.targetId, flatten: true })).sessionId;
    await api.send('Runtime.enable', {}, cs);
    await waitReady(api, 10, cs);
    const has = await rawEval(api, `!!document.querySelector('#confirm')`, cs);
    if (has && has.value) { sid = cs; break; }
    try { await api.send('Target.detachFromTarget', { sessionId: cs }); } catch (e) {}
  }
  if (!sid) throw new Error('NO confirm page');

  // 4. 点安装
  const r = await rawEval(api, `(()=>{const b=document.querySelector('#confirm'); if(b){b.click(); return 'clicked';} return 'no #confirm';})()`, sid);
  return r && r.value;
}
```
`waitReady` / `rawEval` 见 `scripts/kiwi-cdp.js`。

## verify(EXT) — 开 options 页确认已装
开 `chrome-extension://{EXT}/options/index.html`，等 ready 后读 `document.body.innerText`，脚本名 + 版本会出现在清单里。这是 authoritative 校验（比回站点查 DOM 更稳）。

## 回退：browser WS 403 时
`PUT /json/new?{RAW}` 开新标签（HTTP，不走 browser WS）→ 轮询 `GET /json/list` 找 confirm 目标 → 取其 `webSocketDebuggerUrl` 直连（page 级 WS）→ 点 `#confirm`。原理相同，只是建标签与连 WS 的入口换成了 HTTP。

## 排错速查
| 现象 | 原因 | 解决 |
|---|---|---|
| browser WS 连上但命令报 -32601 | `sessionId` 没放到消息顶层（错塞进 params） | `send` 时 `msg.sessionId = sid` |
| confirm 页 `text:""` / `no #confirm` | 轮询抓到陈旧/空白 confirm 标签 | 装前 `Target.closeTarget` 清掉残留 confirm |
| 已有标签 `Page.navigate(RAW)` → `ERR_ABORTED` | raw `.user.js` 被当下载 | 改 `createTarget` 开新标签 |
| `Page.captureScreenshot` 永久挂起 | 半死 session | 包 Promise.race 超时（8s） |
| 注入后站点无效应 | 新建标签是移动模式，脚本桌面守卫跳过 | `Emulation.setDeviceMetricsOverride{width:980}` |
| 页面卡 `loading`、`document.head===null`，reload/navigate 无效 | 长会话挂死 renderer | `adb shell am force-stop com.kiwibrowser.browser` 重启 Kiwi + createTarget 重开 |
| fixed 元素视觉在屏内但触摸点不到（elementsFromPoint 无它） | 页面 `html{zoom:N}` 反缩放导致 hit-test 偏移 | 改用内容流内元素；或流内元素 `.click()` 转发给原生按钮 |
| `Input.dispatchMouseEvent` 点不中、同坐标 JS click 有效 | zoom 页面 mouse 坐标错位 | 触控用 `Input.dispatchTouchEvent`（坐标正常） |
| returnByValue 拿布尔再 JSON.parse 报 not valid JSON | `.value` 已是 boolean/object，不是字符串 | 直接用 `.value`，只对页内 `JSON.stringify()` 的字符串结果 parse |

## 样板：真机上「某个浮层不可用」的取证流程
以知乎评论弹层「无法关闭」为例，可套用到任意站点的弹层 / 抽屉 / 图片查看器。

1. **找到浮层**：扫 `body` 后代里 `position` 非 static 且 `z-index >= 50` 且面积 > 35% 视口的元素；
   用 `elementsFromPoint` 交叉验证。**单位必须先统一**：`elementFromPoint` 吃的是布局坐标 = `getBoundingClientRect × zoom`。
2. **拆结构链**：从浮层节点往上逐层打印 tag / class / position / z / display / flex / overflow / rect，
   先回答三个问题：谁是滚动容器、谁是卡片、谁决定了卡片尺寸。
3. **认病根**（三种高频形态）：
   - 卡片**高于**容器，而容器用 `justify-content:center`（或 `align-items:center`）→ 溢出上下均分，
     顶部落到滚动原点**之上**，`scrollTop` 无法为负 ⇒ 滚不回来，头部与关闭按钮永久不可达。
     （实测：容器 734px / 卡片 1832px → 卡片上移 549px，恰好等于 `(734-1832)/2`。）
   - 卡片**宽于**容器（站点按桌面坐标写死宽度）→ 右侧被裁。
   - 关闭控件被放在卡片**外侧**（如 `position:absolute; right:-60px`）→ 桌面视口下就在屏幕外。
4. **只治越界**：先比 `卡片 rect` 与 `容器 rect`，仅在越界时改（`justify-content:flex-start`；
   `max-width:100% + width:auto + align-self:stretch`）。不越界的浮层一律不动 ——
   否则会把本来正常居中的小弹窗顶到屏幕顶部。
5. **关闭动作优先级**：① 点站点自己的关闭按钮 —— `.click()` 不走命中测试，**按钮在屏幕外也照样生效**；
   ② 补发 `Escape`（`document` + `activeElement` 各派发一次）。两条都包 `try/catch`，
   并在 300ms 后复查是否真的关掉，没关掉再补一发。
6. **移动端真正该做的是「返回键关闭」**：浮层打开时 `history.pushState({myMark:1}, '', location.href)`；
   `popstate` 里关浮层而不是离开页面；浮层被其它方式关掉时用 `history.back()` 撤回哨兵 ——
   **但先确认 `history.state.myMark` 仍是当前条目**，否则用户在浮层里导航过，`back()` 会把他的导航撤掉。
7. **别只看线上偶发复现来判断分支是否修好**：弹层高度常取决于异步加载量（评论条数等），
   同一分支时有时无。用**受控夹具**（人造一段同构 DOM，调用脚本导出的同步函数）做确定性单元测试，
   线上只用来验证「实际命中」。夹具注意 flex 子项默认 `flex-shrink:1` 会压缩高度，
   要写 `flex:0 0 auto` 才能造出溢出。
