# 回归测试

真机上的端到端测试。它们不是跑在 CI 里的单元测试，而是**驱动手机上的 Kiwi 浏览器**
（通过 adb + Chrome DevTools Protocol）去验证脚本的实际效果。

## 前置条件

| 项 | 说明 |
| --- | --- |
| 手机 | 已开启 USB 调试并 `adb devices` 可见 |
| 浏览器 | Kiwi（或其它支持 Chrome 扩展的安卓浏览器）+ 暴力猴（Violentmonkey） |
| 视口 | 手机端该站点需开启「桌面版网站」开关，否则脚本按设计不生效 |
| 本机 | Node 18+（用到全局 `WebSocket`），`adb` 在 PATH 中 |
| 脚本 | `zhihu-desk2mob.user.js` 已装进暴力猴（测 `--installed` 模式时必须） |

## 准备

```bash
adb forward tcp:9222 localabstract:chrome_devtools_remote
```

CDP 端口转发**每轮 shell 都会丢失**，所以 `cdp.js` 在加载时会自动重建一次；若你换用别的
终端手工调用，记得自己再跑一遍上面的命令。

## 运行

**在本目录（`scripts/`）下运行** —— 测试的截图写的是相对路径 `shots/`（即 `scripts/shots/`），
从仓库根跑会因为该目录不存在而在**末尾**报错（断言其实已经跑完，但看不到结果行）。
`scripts/shots/` 是运行期产物、已被 `.gitignore` 排除，不存在就先 `mkdir -p scripts/shots`。

真机上先各开一个页面（测试会自行复制新标签页，但需要一个「样板标签页」来确定 URL）：

- 回答页 `www.zhihu.com/question/.../answer/...` —— 给 `test-comment-back.js`
- 问题页（任意 `www.zhihu.com/question/...`）—— 给 `test-question-actions.js`
- 专栏页 `zhuanlan.zhihu.com/p/...` —— 给 `test-idea-option.js`

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
node test-hot-thumb.js    --installed    # 热榜：条目缩略图 2 行高 +「万热度/分享」行不叠字不被裁 + ::after 灰底随图缩小
node test-column-thumb.js --installed    # 专栏广场：推荐卡片右侧图 3 行高 + 正文第 4 行起回落全宽（DOM 重排到首位）
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
> 那个中间态。机理与两次无效的修法见 `../docs/v1.1.1-text-scale.md` §3。
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
node scripts/check-injected.js "zhihu.com/question"
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

**通用的**两个探针不在这里，在技能目录（`.workbuddy/skills/kiwi-violentmonkey-cdp/scripts/`）：
`probe-element.js`（按文案定位元素并 dump 结构）与 `inspect.js`（判定屏幕顶层叠加层、
切标签、可 `--out` 指定截图路径）。本目录**不再放它们的副本** —— 曾因副本漂移导致
「本地跑的是旧版」而白查一轮。

## 依赖

CDP 工具库本体在技能目录内：`../.workbuddy/skills/kiwi-violentmonkey-cdp/scripts/cdp.js`。
本目录的 `cdp.js` 只是一行转发，以保证全仓库只有一份实现。
