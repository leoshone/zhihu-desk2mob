# 回归测试

端到端测试：驱动真实浏览器（真机 Quetta / 模拟器 Kiwi / 桌面 Turbo，经 CDP）验证脚本的
实际效果。三种测试环境的对照表与接入方式见下方「测试环境」一节。

## 前置条件

| 项 | 说明 |
| --- | --- |
| 手机 | 已开启 USB 调试并 `adb devices` 可见 |
| 浏览器 | Kiwi（或其它支持 Chrome 扩展的安卓浏览器）+ 暴力猴（Violentmonkey），**且处于启用状态**（被 Chrome 权限提升禁用时 confirm 页不弹、安装必败——检查与恢复见 [ENVIRONMENT.md](ENVIRONMENT.md) ②） |
| 视口 | 手机端该站点需开启「桌面版网站」开关，否则脚本按设计不生效 |
| 登录态 | 知乎桌面版匿名访问被强跳登录页（2026-11 起策略），模拟器/新设备需复制登录态（[ENVIRONMENT.md](ENVIRONMENT.md) ⑤） |
| 本机 | Node 18+（用到全局 `WebSocket`），`adb` 在 PATH 中 |
| 脚本 | `zhihu-desk2mob.user.js` 已装进暴力猴（测 `--installed` 模式时必须） |

## 准备

```bash
adb forward tcp:9222 localabstract:chrome_devtools_remote
```

CDP 端口转发**每轮 shell 都会丢失**，所以 `cdp.js` 在加载时会自动重建一次；若你换用别的
终端手工调用，记得自己再跑一遍上面的命令。

## 运行

**在本目录（`test/`）下运行** —— 测试的截图写的是相对路径 `shots/`（即 `test/shots/`），
从仓库根跑会因为该目录不存在而在**末尾**报错（断言其实已经跑完，但看不到结果行）。
`test/shots/` 是运行期产物、已被 `.gitignore` 排除，不存在就先 `mkdir -p scripts/shots`。

真机上先各开一个页面（测试会自行复制新标签页，但需要一个「样板标签页」来确定 URL）：

- 回答页 `www.zhihu.com/question/.../answer/...` —— 给 `test-comment-back.js`
- 问题页（任意 `www.zhihu.com/question/...`）—— 给 `test-question-actions.js`
- 专栏页 `zhuanlan.zhihu.com/p/...` —— 给 `test-idea-option.js`
- 文章页 `zhuanlan.zhihu.com/p/...` —— 给 `test-reco-carousel.js`（「推荐阅读」在文章末尾）
- 圈子页 `www.zhihu.com/ring-feeds` —— 给 `test-ring-comment.js`、`test-idea-box.js`

```bash
node test-comment-back.js --installed    # 评论弹层：返回键关闭 + 溢出定位修正
node test-idea-option.js  --installed    # 发布框：隐藏「同时发布到想法」+ 发布按钮完整可见
node test-avatar.js       --installed    # 发布框：头像不被拉高、与评论列表头像同尺寸
node test-rightrail.js    --installed    # 首页右边缘：侧栏/页脚残留已清除（且正文列没被误伤）
node test-question-actions.js --installed # 问题页：关注问题/写回答/邀请回答 三个按钮同排
node test-actions-wrap.js --installed    # 回答页：底部「赞同」操作栏换行、右侧按钮不再被屏幕裁掉
node test-counterzoom.js  --installed    # 反缩放：内容恰好铺满、加载期无视觉跳变、不跟捏合抢
node test-modal-layout.js                # 弹层溢出定位修正（受控夹具，不依赖线上状态）
node test-image-viewer.js --installed    # 图片查看器：放大的图片回到屏幕中央（需先在评论里点开一张图）
node test-image-viewer-anim.js           # 图片查看器：知乎逐帧动画重写样式时，放大的图仍稳定居中（受控夹具+激进动画）
node test-lightbox-viewer.js             # 正文图查看器（body 直下 img）：不被动画甩出屏、稳定居中（受控夹具+激进动画）
node test-hot-thumb.js    --installed    # 热榜：条目缩略图 2 行高 +「万热度/分享」行不叠字不被裁 + ::after 灰底随图缩小
node test-column-thumb.js --installed    # 专栏广场：推荐卡片右侧图 3 行高 + 正文第 4 行起回落全宽（DOM 重排到首位）
node test-ring-comment.js --installed    # 圈子：PinItem 图文网格缩略图不再溢出方框格子、盖住「评论」动作栏
node test-idea-box.js    --installed    # 圈子：底部「与圈友分享」浮动框在页面上居中（框内图标/文案保持默认）+ 收窄不顶屏幕两边 + 下移
node test-reco-carousel.js --installed  # 文章页：底部「推荐阅读」标题与第一张卡片都和正文一样留左白、不顶边，其余卡片右滑可见
```

> 两条注意：
> - `test-counterzoom` 只在 `--installed` 下才有判别力（注入发生在加载之后，跑不到加载期的变化）；
> - 它会临时改写页面比例（CDP `Emulation.setPageScaleFactor`）。**收尾会自动还原**进测试前记录的比例
>   （CDP 没有「清除 pageScaleFactor」的接口，`clearDeviceMetricsOverride` 实测也清不掉，
>   只能先记下原值、收尾再设回去）。
>   若某次运行**被中断**（Ctrl-C / 报错退出）没走到收尾，那张标签会残留被改写的比例，症状有两个：
>   ① **页面能横向平移、右侧出现一片空白**（`visW < innerWidth`，实测 715 vs 891 ——
>      它就是「怎么页面能拖动」这个疑问的来源）；
>   ② 紧接着重跑本测试时①步拿到 **0 个样本**（残留 `scale = 1` 时 `Z = visW / SW` 恰等于
>      `applyZoom()` 里 `curZ` 的初值，那行 `if (Math.abs(Z - curZ) < 0.005) return;` 会提前返回、
>      **不写内联 zoom**，而①步只统计「有内联 zoom」的采样）。
>   补救：把那张标签 `Page.navigate` 走（移出匹配范围），或用 `Emulation.setPageScaleFactor`
>   把比例设回健康值（本机 0.40111）。
>   建议放在整套测试的**最后**跑。
>
> **`test-counterzoom` 的 ②③ 会间歇性失败**（「捏合缩小后仍恰好铺满」等两条）：模拟捏合时浏览器会
> 先经过「最小比例」那一档，脚本按那一档重算出的 zoom 偏大，而最后那一发事件又因「捏合不变量」
> 被 return 掉。**同一份代码两次运行结果可能不同**（实测一次 5/7、一次 7/7），真机连续捏合不经过
> 那个中间态。机理与两次无效的修法见 `../docs/design-decisions.md` §5.1 §3。
>
> **① ② 也会间歇失败（加载期瞬变）**：同一份代码多次运行，`fitRatio` 序列有时是完美的
> `[1,1,1,…]`，有时**开头两个采样是 `1.1577`**（内容比视口宽 16%）、随后收敛到 1 —— 于是
> ①（全程不超宽）与 ②（视觉尺寸稳定）报 FAIL（`worstFit 0.158` / `jitter 15.8%`）。
> **已用 v1.2.2 的发布件 A/B 排除**：同一版本三次运行里就有一次复现 ⇒ 这是**既有的、
> 与版本无关的加载期竞态**。**看到 ①② 失败也先重跑一次再判断**，别当成产品回归。

去掉 `--installed` 则改为「重载页面后注入 `../zhihu-desk2mob.user.js`」，
适合改动脚本后快速迭代。

## 改完 CSS 先做体检（本项目踩过三次的坑）

整套 CSS 写在脚本内的一个 **JS 模板串**里（`st.textContent = \` ... \`;`）。只要注释或规则里混进一个
反引号，模板串就会被**提前闭合** ⇒ `#z2m-style` 根本插不进去、**样式全失效**；
而 `node --check` **可能照样通过**（反引号成对时语法恰好合法），于是错误一路带到真机。
本项目已踩三次（最近一次 2026-10-01，改「关注者 ｜ 被浏览」竖线时）。
静态检查做不可靠 —— 模板串内有**故意的**嵌套模板串（`${CFG.x ? \`…\` : \`\`}`），所以走运行时体检：

```bash
node test/check-injected.js "zhihu.com/question"
```

它会重载页面、直接查 `#z2m-style` 是否存在、样式表有多少条规则（当前约 56 条）。
几秒钟出结果 —— **改完任何 CSS 都先跑这个**，比跑整套测试快得多。
（症状回顾：脚本没注入时，`test-question-actions` 第一条「脚本已生效」就会 FAIL，其余断言连锁失败。）

## 跑几套？—— 按改动波及面，不必每次全套（用户 2026-09-30 明确要求）

- **只动一处 CSS / 文案**（如问题页按钮排布）⇒ 只跑**受影响的这一套**就够，
  必要时加一条冒烟（挑覆盖面最广的，如 `test-rightrail`）。全套是 6 套真机往返，对小改动纯浪费。
- **动到公共层**（`html/body` 的 zoom、`--z2m-w`、`capFixed` / `hideSideRails` 这类全局扫描），
  或**发版前的最终确认** ⇒ 才跑全套。
- 判断标准是「**这个改动可能破坏什么**」，不是「跑全套更保险」。
- 无论跑几套，**新写的断言都要先做改前/改后对照**，确认它有判别力（改前必须 FAIL）。

测试会自己找目标页面：`test-comment-back` 用回答页；`test-idea-option` 与 `test-avatar`
优先用专栏页，找不到就退回当前任意知乎标签。它会自己「滚到位 → 聚焦输入框 → 必要时打开
评论弹层」把发布框调出来。

> ⚠️ **设备上没开专栏页 / 回答页时，测试会退到别的页面并报出前置失败**（如「发布框打不开」），
> 而不是自动补开 —— 那是**环境问题，不是产品回归**。所以务必先按上面「运行」一节各开一个标签页
> （可以用 `open-page.js`）。这条是实测结论：两次「假失败」都是缺页面导致的。
>
> ⚠️ **更隐蔽的一种：测试会「吃掉」别的标签。** 它们靠 `findTab(子串)` 挑标签，挑不到就退到
> *第一个* 标签并 `Page.navigate` 到它**自己想要**的页面 —— 于是那个标签的 URL 就被换掉了。
> 实测（2026-09-30）：设备上没有首页标签时跑 `test-rightrail`，它把回答页标签导航成了首页，
> 随后回答页相关的测试全部报前置失败，而根因早已不在现场。
> 对策：**跑测试前把首页 / 回答页 / 问题页 / 专栏页各开好**，别让任何测试去「借用」别人的标签。

## 设计要点（都是踩坑后定下来的）

- **每个测试都自行开新标签页，跑完关掉**：同一标签页反复跑会在会话历史里累积条目，
  使 `history.state` 基线不可信，产生一堆难查的假失败。
- **不用 `history.length` 判断历史是否被压入**：`back()` 不会让它减少，而 `pushState`
  会截断前进项（length 可能不变）。权威判据是 `history.state` 上的标记。
- **知乎的答案列表是虚拟化的**：`N 条评论` 按钮随滚动增删，早先拿到的元素句柄可能已失效。
  所以选按钮前要「滚到位 → 重新查询 → 只选当前在视口内的候选」，并准备多个候选重试。
- **弹层高度取决于异步加载量**：溢出分支（卡片比容器大）线上时有时无，
  因此该分支另用**受控夹具**做确定性单元测试（见 `test-modal-layout.js`），
  真机只用于验证「实际命中」。
- **页面出现 `document.body` 为 null** = CDP 长会话把 renderer 挂死了。
  执行 `adb shell am force-stop com.kiwibrowser.browser` 重启 Kiwi 即可。

## 诊断探针（probe / shot）

不是回归测试，而是**排查时用的量具**：只读、可反复跑，用来回答「这个现象出自哪个容器／
这个按钮有没有越界／该隐藏哪一层」。改脚本前先跑探针定位，比盲改快得多。

| 脚本 | 用途 | 常不常用 |
| --- | --- | --- |
| `probe-rightrail.js` | 定位右边缘残留出自哪个容器（含「侧栏 vs 正文列」的结构对照） | 常用 |
| `probe-scale.js` | 逐标签量「屏上换算因子」(`zoom × scale`) 与正文屏上 px —— **`CFG.textScale` 定值/复核用** | 常用 |
| `probe-fontsize.js` | 某页正文的实际字号：关键选择器 + 正文区域「字号直方图」 | 常用 |
| `probe-overlay.js` | fixed/sticky 元素几何 + 目标元素顶部与它们的重叠 —— 查「被常驻浮条盖住」 | 常用 |
| `probe-topalign.js` | 把目标元素顶部对齐到视口顶端再抓屏，看它是否被浮层遮住 | 常用 |
| `probe-sticky.js` | 找出「吸顶」挂在哪个元素上（默认探专栏页文章头） | 常用 |
| `probe-pinch-floor.js` | 逐档扫 `pageScaleFactor`，判断捏合下限是浏览器限制还是脚本行为 | 常用 |
| `open-page.js` | 开一个新标签并报告是否处于桌面模式 —— 跑测试前准备页面用 | 常用 |
| `probe-avatar.js` | 对比发布框头像与评论列表头像的尺寸分布 | 常用 |
| `probe-publishbtn.js` | 量「发布」按钮是否越界、被挤出屏幕 | 常用 |
| `probe-composer-fit.js` | 诊断发布框那一行的「内容宽 vs 可用宽」 | 常用 |
| `probe-composer.js` / `probe-composer2.js` | 早期：dump 发布框结构 / 确定选项的出现条件 | 历史探针 |
| `probe-comment.js` | 早期：环境 / 评论触发按钮 / 叠加层扫描 | 历史探针 |
| `shot-composer.js` / `shot-answer-comments.js` | 取证：抓发布框前后对照、回答评论弹层的真机截屏 | 常用 |

> **`probe-avatar.js` 与 `probe-publishbtn.js` 的 `--off` 有方法局限**：它们用
> `window.__z2mStop()` 当「关掉脚本」的基线，而那个钩子是**半清理**（只摘样式表、不断
> 内联样式），所以那组数据不是有效的无脚本对照。判断「某问题是否由某次改动引入」要用
> **同一轮内的改前/改后对照**。两个脚本头部都写了这条。

**通用的**两个探针（`probe-element.js` 按文案定位元素并 dump 结构、`inspect.js` 判定屏幕顶层
叠加层/切标签/截图）原先放在 `.workbuddy/skills/kiwi-violentmonkey-cdp/` 技能目录；
2026-11 该技能已迁移到独立仓库
[leoshone/Skills → browser-extension-e2e](https://github.com/leoshone/Skills/tree/main/browser-extension-e2e)（公有），
项目内的技能目录已删除。需要这两个探针时从该仓库取，本目录不放副本 —— 曾因副本漂移导致
「本地跑的是旧版」而白查一轮。

## 依赖

CDP 工具库本体在 `test/lib/cdp.js`。本目录的 `cdp.js` 只是一行转发，
以保证全仓库只有一份实现。

# 测试环境（3 种）

脚本适配的目标是「桌面版网站」模式下的知乎页面。同一个脚本可以在三种环境里验证，
各有适用场景与陷阱。**公共前提**：目标浏览器装好暴力猴，且站点开启「桌面版网站」开关
（或 URL 带 `?z2m-force=1` 强制生效，见下）。

> ⚠️ **从零搭环境 / 环境排障**（暴力猴启用检查与恢复、Kiwi 桌面模式开启、知乎登录态
> 复制、CDP 端口冲突等）已独立成册：[ENVIRONMENT.md](ENVIRONMENT.md)——本节只讲
> 「环境已就绪后的定位差异与各自陷阱」。

## 三种环境对照表

| | ① 桌面浏览器（Turbo） | ② 安卓模拟器（AVD/MuMu → Kiwi） | ③ 真机（小米13 → Quetta） |
| --- | --- | --- | --- |
| **定位** | **快速迭代**：改完立即看效果 | 中间验证：接近真机的安卓内核 | **最终裁决**：真实用户环境 |
| 浏览器 | Turbo（`D:\Software\Turbo\turbo.exe`，Chrome 156） | Kiwi（Chrome 137） | Quetta（Chrome 148） |
| 暴力猴 | 2.50 | 已装（扩展 ID 各环境不同，按名字匹配） | 已装 |
| CDP 接入 | **直连宿主机**：`127.0.0.1:9222`（启动参数 `--remote-debugging-port=9222`），不经 adb | `adb forward tcp:9223 localabstract:chrome_devtools_remote`（**每轮 shell 会丢**，`cdp.js` 加载时自建；走 9223 避免与桌面 Turbo 抢 9222） | USB 调试 → `adb forward tcp:9222 ...`（同左） |
| 视口 | DevTools 模拟：`Emulation.setDeviceMetricsOverride`（393×873 dpr3 mobile）+ 窗口缩成手机尺寸 | Kiwi 开「桌面版网站」，视口 891 由浏览器缩放 | 真机桌面模式，视口 891 |
| 脚本生效 | 需 URL 带 **`?z2m-force=1`**（模拟视口命中 `innerWidth≤600` 守卫） | 「桌面版网站」开关即触发（真移动视口不命中守卫） | 同左 |
| 知乎登录态 | Turbo 自带（带 CDP 复制源） | 需从 Turbo 复制（见 ENVIRONMENT.md ⑤） | 用户真机自带 |
| 已知陷阱 | ① `@run-at document-start` 注入失效（Chrome156+暴力猴2.50），须 `document-body`；② Emulation 随 CDP 断开自动清除，肉眼验证需常驻连接；③ 表情/输入组件接口在模拟网络下「加载失败」（非脚本问题）；④ CLI 会话里启动的浏览器随会话退出被杀，用计划任务脱离会话启动 | Chrome 137 与真机 148 有内核差异（如滚动条机制），「模拟器正常、真机异常」优先怀疑内核差异；新内核 `Page.addScriptToEvaluateOnNewDocument` 不生效，注入须在 navigate 后 `Runtime.evaluate` | 最真实；`test-counterzoom` 等「模拟捏合」类测试的 FAIL 只在真机可信 |
| 速度 | 秒级往返（截图/注入/重载都快） | 中（经 adb，受限模拟器性能） | 慢（USB 往返） |

**推荐流程**：改动 → ① Turbo 快速迭代确认布局 → ② AVD/MuMu Kiwi 过一遍安卓内核 → ③ 真机抽验关键页。
小改动不必三级全跑（见本文「跑几套」一节）。

## 各环境操作要点

### ① Turbo（桌面快速迭代）

1. 启动带调试参数（首次配置，之后正常启动也带）：`turbo.exe --remote-debugging-port=9222`
2. 暴力猴装脚本：options 页「地址安装」→ 填 `http://127.0.0.1:8899/zhihu-desk2mob.user.js`
   （本地 `python -m http.server 8899` 起服务；GitHub raw 在部分网络环境拉不到）
3. 看效果：导航到 `https://www.zhihu.com/?z2m-force=1`（参数是关键，否则脚本自守卫退出）
4. 肉眼验证窗口效果时注意：`Emulation` 参数随 CDP 断开消失，需常驻连接；或直接把窗口缩窄
5. 自动化装机脚本：`_tmp-shots/turbo-setup.js`（本地服务 + 地址安装 + confirm 自动点击一条龙）

### ② AVD / MuMu 模拟器（Kiwi）

1. `adb connect 127.0.0.1:16384`（MuMu 端口；AVD 走 emulator-5554 自动可见）
2. `adb forward tcp:9223 localabstract:chrome_devtools_remote`（9222 留给桌面 Turbo；`cdp.js` 会自建）
3. 环境搭建五步（CDP/暴力猴/脚本/桌面模式/登录态）：[ENVIRONMENT.md](ENVIRONMENT.md)
4. 走查：`node audit-real.js`（在 test/ 目录内）（8 页断言+截图，暴力猴已装模式）
5. 坑：
   - Kiwi 内核旧（137），「模拟器正常」不等于真机正常（内核差异案例见 conventions 文档）
   - 多 display 陷阱：`am stack list` 看 displayId，`input -d <id> tap` 必须带 `-d`
   - 截图用窗口抓图（PrintWindow），全屏 `screencap` 在有遮挡时误导

### ③ 真机（小米13 / Quetta）

1. USB 调试 + `adb forward tcp:9222 localabstract:chrome_devtools_remote`
2. 最终裁决环境：`test-counterzoom` 等捏合类测试**只信真机结果**（模拟捏合在 CDP 下不可靠，
   见本文 counterzoom 注）
3. 长会话后 `Page.captureScreenshot` 可能不可靠，改用 `adb exec-out screencap -p`
4. renderer 挂死（`document.body` 为 null）：`adb shell am force-stop <浏览器包名>` 重启

## 通用工具

- CDP 工具库：`test/lib/cdp.js`（零依赖，Node 18+ 内置 WebSocket）
- 注入体检：`node test/check-injected.js "zhihu.com"`（改完 CSS 第一件事）
- 8 页走查：`node audit-real.js`（在 test/ 目录内）（真机/模拟器通用，暴力猴已装模式）
- 全部测试与探针清单见 本文「跑几套」一节

## 历史踩坑记录

详细案例（bfcache 恢复 DOM 属性、端口冲突、browser ws 需 GUID 等）见
[`AGENTS.md`](../../AGENTS.md) 的「已知陷阱」一节。

