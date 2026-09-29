---
name: kiwi-violentmonkey-cdp
description: Use this skill when you need to drive the Kiwi browser on a real Android phone over Chrome DevTools Protocol (CDP) via adb — especially to install or update a userscript into the Violentmonkey (暴力猴) extension with no human tap, or to inject a script into the live page, list/screenshot tabs, and verify layout. Triggers include mentions of Kiwi, 暴力猴/Violentmonkey, userscript, user.js, CDP, adb, phone script install or update, desktop-mode, or driving a mobile browser from the desktop.
agent_created: true
---

# Kiwi (phone) + 暴力猴 · CDP 自动装/更新用户脚本

用 CDP 远程驱动安卓真机上的 Kiwi 浏览器，把用户脚本自动安装/更新进暴力猴（无需碰手机），或在活标签页注入脚本、列标签、截图、验证布局。这是**通用能力**，下面的 zhihu2mob 只是其中一个具体脚本例子。

## 何时用
- 把某个 `.user.js`（raw URL）自动装进手机 Kiwi 的暴力猴 —— **无需真人点**。
- 经 CDP 远程：注入脚本到当前页、列/截标签、验证脚本是否生效、排查布局。

## 连接手机
adb 已在 PATH（装于 `C:\platform-tools`），直接调用：
```bash
adb forward tcp:9222 localabstract:chrome_devtools_remote   # 每轮 Bash 都要重建
curl -s --noproxy 127.0.0.1 --max-time 5 http://127.0.0.1:9222/json/version
```

## 自动装/更新（核心：无需真人）
连 **browser 级 WS** + `Target` 域（不是 page 级 WS）：
1. 先 `Target.getTargets` 关掉残留的 confirm 标签（失败重试会留下多个，否则会点到空白页）。
2. `Target.createTarget({url: RAW})` 开**新标签** → 暴力猴自动弹出 confirm 页
   `chrome-extension://{EXT}/confirm/index.html#...`，显示「安装脚本」或「重新安装脚本 … X.Y.Z」。
3. `Target.getTargets` 找到 confirm 页 → `Target.attachToTarget({flatten:true})` 拿 `sessionId`。
4. `Runtime.enable`；等 `readyState==='complete'`；确认 `document.querySelector('#confirm')` 存在。
5. 点它：`document.querySelector('#confirm').click()` → 安装/更新完成。

完整可跑脚本：`scripts/kiwi-cdp.js install {RAW_URL}`（已真机验证：弹出 confirm → 点击 → options 页确认已装入）。

**为什么不能用 page 级 WS + 在已有标签 `Page.navigate(RAW)`**：raw `.user.js` 会被 Chrome 当下载，`net::ERR_ABORTED`，confirm 页不出现。必须 `createTarget` 开**新标签**让暴力猴接管。

**browser 级 WS 偶发 403**（`Rejected … Use --remote-allow-origins`）：正常状态下可用（已验证可连）。若遇 403（Kiwi 未带该启动参数），回退方案：
`PUT /json/new?{RAW}` 开新标签 → 轮询 `/json/list` 找 confirm 页 → 取其 `webSocketDebuggerUrl` 直连（page 级 WS）→ 点 `#confirm`。

## 验证已装
开暴力猴 options 页读脚本清单（authoritative）：
`chrome-extension://{EXT}/options/index.html` → body 含脚本名 + 版本。
或重载目标站点标签，检查脚本注入的 DOM 效应（如 zhihu2mob 注入的 `#z2m-style`）。

## 实时注入（临时止血）
把本地改好的脚本注入前台活标签立即生效，刷新即还原：`scripts/kiwi-cdp.js inject {FILE}`。

## 坑
- **browser WS 403**：见上回退方案（`/json/new` + page 级 WS）。
- **陈旧 confirm 标签**：失败重试会留多个 confirm 标签，轮询先抓到空白的那个 → 装前先 `Target.closeTarget` 清掉。
- **截图挂死**：`Page.captureScreenshot` 对半死 session 会永久挂起 → 包一层超时（如 8s）。
- **桌面模式 per-tab**：CDP 新建标签默认移动模式，要测脚本生效需 `Emulation.setDeviceMetricsOverride{width:980}` 强制桌面视口。
- **CDP 长会话挂死 renderer**：十几轮 attach/reload 循环后页面 `readyState` 卡 `loading`、`document.head` 为 null，`Page.reload`/`Page.navigate` 都救不回来 → `adb shell am force-stop com.kiwibrowser.browser` 重启 Kiwi，再 `Target.createTarget` 重开页面。所有 eval/dispatch 都要包超时。
- **hit-test 在 root zoom 下不可信**：页面用 `html{zoom:N}` 反缩放（Kiwi 桌面模式适配常见）时，`position:fixed` 元素即使视觉在屏幕内，`Input.dispatchTouchEvent` 按其 getBoundingClientRect 坐标点也**点不到**（elementsFromPoint 栈里根本没有它）。可点的元素必须放**内容流内**（sticky/in-flow）。`.click()` 不走命中测试，永远有效——把流内元素点击转发给不可点的原生按钮是可靠模式。
- **CDP mouse 事件在 zoom 页面坐标错位**：`Input.dispatchMouseEvent` 用 CSS 坐标在 `html{zoom:N}` 页面会点偏（同一坐标 JS `.click()` 有效、mouse 事件无效即此症状）。触控验证用 `Input.dispatchTouchEvent`（实测正常）。
- **PC→手机装本地脚本**：PC 起 `python -m http.server 8899`，`adb reverse tcp:8899 tcp:8899`，手机访问 `http://127.0.0.1:8899/x.user.js` 走 createTarget 安装流程。用完 `adb reverse --remove tcp:8899`。
- **SPA 会话状态污染测试**：站点（如知乎）会把「评论展开」存会话状态——刷新后可能恢复为内联评论而非弹层。测试弹层路径前先点「收起评论」归零，或直接断言两种形态分别处理。
- **复杂测试脚本别用 heredoc**：bash heredoc 内嵌 JS 模板字符串/反引号/单引号极易炸（`unexpected EOF`）。用 Write 工具写 `.js` 文件再 `node` 执行。同理，`node -e "..."` 内联写含正则/引号的 JS 也会被反斜杠转义搞坏 —— 一律写成文件。
- **模板字符串里的正则要写 `\\s`**：在 `` `...` `` 里写 `/\s+/`，JS 会把单反斜杠当**无效转义**降级成字面量 `s`（`/\s/` → `/s/`），正则静默失效、筛选结果为空。必须写 `/\\s+/`。
- **`getBoundingClientRect` 与 CSS px 同坐标系，但 `elementFromPoint` 用「布局坐标」**：根 `zoom` 下实测——固定元素 `left:100px` 的 rect.x 就是 100（同坐标系）；而 `elementFromPoint` 要传 `rect × zoom` 才命中（传 rect 原值会命中别的元素，且 `elementFromPoint` 明确不是「视觉坐标」·实测 `visualViewport` 给出的宽高也是布局像素，与 rect 不可直接比较）。`dialog.js` 里踩过一次：按 visualViewport 面积阈值筛叠加层时单位不统一，导致「找不到弹层」。
- **长会话后 `Page.captureScreenshot` 会持续超时**（换新标签页前一直挂）：改用 `adb exec-out screencap -p > x.png` 抓真机屏幕 —— 更接近用户实际所见，且不受 CDP 会话状态影响。细节核对用 Pillow 裁剪放大（装到 managed venv：`python.exe -m venv .../envs/default && pip install Pillow`）。
- **别复用同一标签页跑多轮测试**：反复 `pushState` 会在会话历史里留下未消费的条目，`history.state` 基线随即不可信，症状是一堆莫名其妙的假失败。用 `Target.createTarget` 开**新标签页**测，结束再 `Target.closeTarget`。
- **`history.length` 不能用来判断 pushState 是否生效**：`back()` 不会让 length 减少（前进项仍保留），而新的 `pushState` 会截断前进项（length 可能不变）。权威判据是在 `history.state` 里放自己的标记对象。
- **虚拟化列表里点按钮**：知乎答案列表会随滚动增删节点，早先拿到的元素句柄可能已失效、`scrollIntoView` 后节点被重建。要「先滚到位 → 重新查询 → 只选当前在视口内的候选 → 点击后轮询确认状态变化」，并准备多个候选重试；否则很容易误判为被测脚本失效。
- **SPA 会把「评论展开」存进会话状态**：同意图点击在不同会话状态下可能走弹层或走内联展开（按钮文本会变成「收起评论」）。断言要对两种形态分别成立，别假设单一路径。
- **页面里可能同时存在 `display:none` 的同名组件残骸**（如 `ModalLoading-content`）：判定「某浮层是否打开」不能只看节点是否存在，要校验自身或祖先无 `display:none`/`visibility:hidden` 且有实际占位。反之，知乎评论弹层关闭后约 400ms 内会被真正移除（关闭动画期间 opacity 递减），所以「存在即打开」对它是成立的 —— 结论要按站点分别实测，别硬套。
- **元素可能「获得焦点后」才渲染**：知乎评论发布框里的「同时发布到想法」就是如此 —— 不点进输入框，DOM 里根本没有它，直接查会误判为「页面上没有这个选项」。遇到「按文案找不到元素」先试：滚动到位 → 聚焦/点击输入框 → 再查。
- **排查「某处被撑得很高」时先看文字是不是被压成竖排**：元素 `rect` 呈「很窄很高」（如 7 个汉字 = 13×121px、宽度只有 1~2 个字宽）就是逐字换行。根因通常是某个 flex 子项的 `min-width` 被置 0 后收缩到 0 宽 —— **反直觉的是这常常是适配脚本自己加的规则造成的**（如 `min-width: 0 !important` 这类为消掉站点硬 min-width 而无差别施加的规则），别只顾着怪站点。
- **行内元素被挤出容器/屏幕时，用 `clientWidth` vs `scrollWidth` 定位**：某层 `scrollWidth > clientWidth` 说明它放不下内容；再逐个子元素看 `flex` 与 `computed width`，找出「谁拒绝收缩」。常见组合是「A 是 `flex:0 0 auto`（站点给的）+ B 是 `flex:0 0 auto`（脚本加的）」，两者都不让，就把 B 挤出行外甚至推到屏幕外。修法是让其中一方可收缩，而不是硬砍宽度。
- **虚拟化列表里不要依赖 `scrollIntoView`**：跳转后节点常被回收，导致「视口内候选 = 0」的假失败。改为**按固定偏移逐档 `scrollTo`（如 0/400/700/1000…）+ 每档复查视口内候选，命中即停**，抖动即消失。
- **`Page.captureScreenshot` 之外，`adb exec-out screencap -p` 更抗造**：也能在 CDP 会话半死时继续取证；细节核对用 Pillow 裁剪放大（装到 managed venv）。

## 参考
- `references/cdp-kit.md`：`attach()` / `install()` / `verify()` 实现、暴力猴扩展 ID、排错速查，
  以及「真机上某个浮层不可用」的完整取证流程样板。
- `scripts/kiwi-cdp.js`：命令行入口 —— `install {RAW}` / `verify {EXT}` / `inject {FILE}` / `list`。
- `scripts/cdp.js`：**可复用工具库**（`require` 它，别再各写一份 CDP 胶水代码）。
  导出 `browserApi / getTargets / findTab / attach / evalJs / evalJson / shot / waitReady / openTab / sleep`。
  其中两点是踩过坑才定下来的：加载时自动重建 `adb forward`（每轮 shell 都会丢）；
  所有 `eval` 都带超时（长会话后 renderer 会挂死）。
- `scripts/probe-element.js`：**按文案定位元素并 dump 结构** —— 找稳定选择器、判断「该隐藏哪一层」时用。
  `node probe-element.js "要查找的文本" [--tab <URL 子串>]`
- `scripts/inspect.js`：**判定屏幕上真实的顶层叠加层** —— 回答「浮层到底开没开、在不在屏幕内、
  关闭入口在不在屏幕内」。`node inspect.js [reload|open] [--tab <URL 子串>]`
- 取证截图优先用 `adb exec-out screencap -p > x.png`（比 `Page.captureScreenshot` 抗造），
  细节核对用 Pillow 裁剪放大。
