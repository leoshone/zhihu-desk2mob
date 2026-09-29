# CDP 工具包（detail）

SKILL.md 只放结论，这里放关键事实与排错细节。本 skill 是**通用能力**：下面的例子用 zhihu2mob，
但 `install` / `inject` / `verify` 对任意 raw `.user.js` 与任意站点都适用。

> **为什么这里没有可复制粘贴的实现代码**：本文件原先抄了 `connectBrowser()` 与 `install()` 两份
> 实现，结果两次与真实代码漂移（漏掉「装完关标签」这一步、函数签名不一致）。
> 实现只有一份，在 `scripts/` 里；这里只写**流程与非显然点**，避免又抄出一份会过期的副本。

## 关键事实（实测，非推断）
- 环境：安卓真机（小米 fuxi / 2211133C，1080×2400，CSS 宽 393px）+ Kiwi 浏览器 + 暴力猴扩展。
- 暴力猴扩展 ID：`fcickoepngcnapddnnmjmpekmfmpaa`（装/更新流程依赖它的 `confirm/index.html`
  与 `options/index.html`）。
- adb：已加入 PATH，装于 `C:\platform-tools`（直接调用 `adb`，无需指定路径）。
- Node 22 全局 `WebSocket` / `fetch` 可用：`C:/Users/xiongbin/.workbuddy/binaries/node/versions/22.22.2-3/node.exe`。
- **CDP 能自动装/更新脚本**（无需真人）：browser 级 WS + `Target.createTarget{url:RAW}` 开新标签
  → 暴力猴弹 confirm 页 → 点 `#confirm` → 关掉所开标签。已真机验证（脚本「弹出 confirm → 点击 →
  关闭两个标签 → `verify` 复核已装入」全链路）。

## 连 browser 级 WS（`attach` 的前置）

实现见 `scripts/cdp.js` 的 `connectWs()` / `browserApi()`。只需记住两个非显然点：

- 必须连 **browser 级** WS（`ws://127.0.0.1:9222/devtools/browser`），不是 page 级 ——
  `Target.createTarget` / `Target.getTargets` 这类命令只在 browser 级可用。
- `sessionId` 要放在消息**顶层**（`msg.sessionId = sid`）；塞进 `params` 会得到 `-32601`。

## install(RAW) — 自动装/更新（核心）

实现见 `scripts/kiwi-cdp.js` 的 `cmdInstall()`（约 60 行，带注释）。流程六步：

1. **先清残留**：`Target.closeTarget` 掉所有 `confirm/index.html` 标签（失败重试会留下多个，
   轮询会先抓到空白的那个）。
2. **开新标签**：`Target.createTarget({url: RAW})` 让暴力猴接管。
3. **找 confirm 页并 attach**：轮询 `Target.getTargets`，`attachToTarget({flatten:true})` 拿 sessionId。
4. **确认再点**：`Runtime.enable` → 等 `readyState==='complete'` →
   确认 `document.querySelector('#confirm')` 存在（不存在说明抓到的是空白/陈旧页）。
5. **点它**：`document.querySelector('#confirm').click()`，然后**等约 3s** 让暴力猴写盘。
6. **关掉自己开的标签**：confirm 页 + 第 2 步那张 raw 标签。
   不关的后果是每跑一次手机上就多两个标签，只能等下一次 install 顺手清掉 ——
   实测「安装前 3 个标签 → 安装后 5 个」。

> `install` 只保证「点击已送达」。**是否真的装入以 `verify` 为准**（读 options 页清单）。

## verify(EXT) — 开 options 页确认已装

开 `chrome-extension://{EXT}/options/index.html`，等 ready 后读 `document.body.innerText`，
脚本名 + 版本会出现在清单里。这是 authoritative 校验（比回站点查 DOM 更稳）。
实现见 `scripts/kiwi-cdp.js` 的 `cmdVerify()`；**读完会关掉自己开的那张 options 页**。

## 回退：browser WS 403 时

`PUT /json/new?{RAW}` 开新标签（HTTP，不走 browser WS）→ 轮询 `GET /json/list` 找 confirm 目标
→ 取其 `webSocketDebuggerUrl` 直连（page 级 WS）→ 点 `#confirm`。原理相同，
只是建标签与连 WS 的入口换成了 HTTP。

## 排错速查

| 现象 | 原因 | 解决 |
|---|---|---|
| browser WS 连上但命令报 -32601 | `sessionId` 没放到消息顶层（错塞进 params） | `send` 时 `msg.sessionId = sid` |
| confirm 页 `text:""` / `no #confirm` | 轮询抓到陈旧/空白 confirm 标签 | 装前 `Target.closeTarget` 清掉残留 confirm |
| 已有标签 `Page.navigate(RAW)` → `ERR_ABORTED` | raw `.user.js` 被当下载 | 改 `createTarget` 开新标签 |
| 手机上越跑越多 confirm / options 标签 | 工具没关自己开的标签 | 收尾 `Target.closeTarget`；`kiwi-cdp.js` 已内建 |
| `Page.captureScreenshot` 永久挂起 | 半死 session | 包 Promise.race 超时（8s） |
| `Page.captureScreenshot` 持续超时 | 长会话 | 改 `adb exec-out screencap -p` 抓屏 |
| 注入后站点无效应 | 新建标签是移动模式，脚本桌面守卫跳过 | `Emulation.setDeviceMetricsOverride{width:980}` |
| 页面卡 `loading`、`document.head===null`，reload/navigate 无效 | 长会话挂死 renderer | `adb shell am force-stop com.kiwibrowser.browser` 重启 Kiwi + createTarget 重开 |
| fixed 元素视觉在屏内但触摸点不到（elementsFromPoint 无它） | 页面 `html{zoom:N}` 反缩放导致 hit-test 偏移 | 改用内容流内元素；或流内元素 `.click()` 转发给原生按钮 |
| `Input.dispatchMouseEvent` 点不中、同坐标 JS click 有效 | zoom 页面 mouse 坐标错位 | 触控用 `Input.dispatchTouchEvent`（坐标正常） |
| returnByValue 拿布尔再 JSON.parse 报 not valid JSON | `.value` 已是 boolean/object，不是字符串 | 直接用 `.value`，只对页内 `JSON.stringify()` 的字符串结果 parse |
| `node kiwi-cdp.js list` 每个标签都显示 `undefined` | `Target.getTargets` 的字段是 `targetId`，不是 `id` | 打印 `targetId`（已修） |

## 样板：真机上「某个浮层不可用」的取证流程

以知乎评论弹层「无法关闭」为例，可套用到任意站点的弹层 / 抽屉 / 图片查看器。

1. **找到浮层**：扫 `body` 后代里 `position` 非 static 且 `z-index >= 50` 且面积 > 35% 视口的元素；
   用 `elementsFromPoint` 交叉验证。**单位必须先统一**：`elementFromPoint` 吃的是布局坐标
   = `getBoundingClientRect × zoom`。
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
