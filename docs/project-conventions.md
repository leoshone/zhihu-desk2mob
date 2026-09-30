# 项目约定（接手须知）

这份文档是**换机／换人接手时需要知道的项目决策**，不重复技能与 README 已写的内容：
环境与工具用法见 [`.workbuddy/skills/kiwi-violentmonkey-cdp/SKILL.md`](../.workbuddy/skills/kiwi-violentmonkey-cdp/SKILL.md)，
测试怎么跑见 [`scripts/README.md`](../scripts/README.md)，各版本根因见 [`docs/`](.)。

## 环境（实测）

| 项 | 值 |
| --- | --- |
| 真机 | Xiaomi 2211133C（codename `fuxi`），1080×2400，CSS 视口 393×873 |
| 浏览器 | Kiwi + 暴力猴（扩展 ID `fcickoepngcnapddnnmjpkmpekmfmpaa`） |
| 调试 | `adb` 在 PATH；CDP 转发 `tcp:9222`（**每轮 shell 会丢**，`scripts/cdp.js` 加载时自建） |
| 站点设置 | `zhihu.com` 必须开「桌面版网站」，否则脚本按设计**不生效**（`innerWidth ≤ 600` 时直接返回） |
| Node | 18+（用到全局 `WebSocket`） |

## 换机 / 重新开始时的清单

1. `git clone https://github.com/leoshone/zhihu-desk2mob.git` —— 脚本本体、全部文档与测试都在仓库里，`main` 即最新。
2. 备好 **adb**（在 PATH）与 **Node 18+**；手机开 USB 调试，`adb devices` 能看到设备。
3. 手机该站点开「桌面版网站」，装好 Kiwi + 暴力猴。
4. 装脚本：跟着更新用 README 里的 raw main 地址；想固定版本用 Release 附件。
5. 要跑测试：**在真机上先开好一个专栏页 + 一个回答页标签**（否则测试会退到别的页面、报前置失败
   —— 见 `scripts/README.md`）。`adb forward tcp:9222 …` 由 `scripts/cdp.js` 加载时自建。
6. 要发版：`gh auth login`（走设备码网页流程）→ `gh auth setup-git` → 按下面「发布流程」。
7. **只在本地、不入库**的东西：`.workbuddy/memory/`（本机 agent 记忆）、`_tmp/`（一次性探针）、
   `scripts/shots/`（测试截图）。换机后这些不会跟过来，但**结论都已沉淀进 `docs/`**；
   常用诊断探针也已收进 `scripts/`（见其 README 的探针表）。
   **例外**：`.workbuddy/skills/`（项目级技能）**是入库的** —— 技能随仓库分发，
   `scripts/` 的测试靠它读 CDP 工具库，故不能删。

## 产物清单（本仓库**不**建 `ARTIFACTS.md`）

全局规则要求在各项目下维护 `ARTIFACTS.md`。本仓库**有意不建**：清单职能已由三处
**就地**承担，且都与被登记的对象同址、随改动一起更新，比另立一份总表更不容易腐化。

| 管什么 | 清单在哪 |
| --- | --- |
| 正式产物（脚本本体、文档、技能） | [`README.md`](../README.md) 的「文件」表 + 「docs 索引」 |
| 诊断量具（probe / shot） | [`scripts/README.md`](../scripts/README.md) 的「诊断探针」表 |
| 可删的中间产物 | 不入库，集中放 `_tmp/`、`scripts/shots/`（见 `.gitignore`） |

> 曾有一版 `ARTIFACTS.md`（2026-09-28，commit `77f9ff1`），落在**已放弃的分支**上；
> 同期审查（`code-review-v1.0.5.md` 的 L8）已发现它**跟不上目录变化**（缺 `_tmp/release/`、
> `_tmp/skills-backup/`，`_tmp/probes/` 也多出了本轮脚本）—— 这是本仓库不另立总表的实证理由：
> 独立清单在快速迭代下会腐化，而就地索引不会。
> **新增/移动/删除产物时，请同步更新上表对应的就地清单。**

## 反缩放契约（v1.1.0 起）

- `html{zoom} = visW / SW`（`visW` = `visualViewport.width`），目标是**内容恰好铺满**（`fitRatio = 1`），
  **不是** `1 / scale`。详见 [`v1.0.9-fix-counter-zoom-fit.md`](v1.0.9-fix-counter-zoom-fit.md)。
- 捏合：**放大不干预**；**缩小夹在「恰好铺满」这个下限上**（`CFG.limitZoomOut`）。
  判据 `zoom × scale < curScreenW / SW` —— 因为「铺满时的视觉尺寸」= `屏幕可用宽 / 列宽`，与 scale 无关。
- **浏览器允许的捏合下限 = 屏幕可用宽 ÷ `innerWidth`**（本机 358 / 891 = 0.401，两页实测逐档一致）。
  所以别再把「问答页缩不下去、专栏页能缩」当成浏览器差异 —— 那是脚本**有没有在捏合后重算 zoom**，
  且旧实现不稳定（取决于 `window.resize` 是否恰好触发）。详见
  [`v1.1.0-limit-zoom-out.md`](v1.1.0-limit-zoom-out.md)（含与 v1.0.9 §5 的取舍关系）。
- **屏上大小 = 名义字号 × (屏幕可用宽 ÷ 列宽)**：单列布局里唯一的旋钮是列宽，不能只调
  `html{zoom}`（那会让列宽于屏幕、被 `overflow-x:hidden` 裁掉右边）。
  `CFG.textScale` 就是这个换算因子（1 = 字号就是名义值），实现见
  [`v1.1.1-text-scale.md`](v1.1.1-text-scale.md)。
  **当前值 `1.0`（正文 16px，即名义字号）**，2026-09-30 由用户决定取整到 `1.0`。
  定值沿革：`0.90976`（v1.0.9 铺满原始大小，14.56px）→ **`0.98`**（v1.1.1：先试 `1.1` 的
  17.6px 觉得太大、`0.90976` 的 14.56px 觉得太小，用户手动捏合到 `zoom × scale = 0.97998`
  作为基准）→ **`1.0`**（当前，**未按捏合定值**，是有意取整到名义字号）。
  要调就改这一个数，别去动 font-size。
- **别在 `applyZoom()` 里调用依赖 `let` 声明的清理函数**（如 `clearScanMemo`）——
  `applyZoom` 在初始化早期执行，会撞 TDZ 让**整个 IIFE 抛错、脚本完全不生效**，
  而症状看起来像「暴力猴没注入」。判活的判据是 `#z2m-style` 是否存在 / `style.zoom` 是否为空。

## 块状版式（v1.2.0 起）

- 内容列**两侧不留灰边**：把本脚本 `.App-main` 的水平 padding 归零，并把知乎最外层容器那 16px
  也归零。带 16px 的容器**首页是稳定类名 `.Topstory-container`，专栏/问答却是 emotion hash**
  ⇒ 改用结构选择器 `.Post-content > div` / `.QuestionPage > div`。首页右列另有
  `.Topstory-mainColumn { margin-right: 10px }`，也要清。
- **块间竖直灰缝来自卡片自己的 `margin-bottom: 10px`** —— 所以**只动横向**就保住了它，别碰纵向。
- **块的呼吸感来自块自己的内边距**（首页 16px / 专栏 20px / 问答 22px），**不要**再补内边距。
- ⚠️ `.App-main` 到那个 16px 容器之间夹着 **3~4 层包装 div**（含混淆类名），
  **按深度写的选择器（`App-main > * > *`）打不到**。新页面若要一并铺满，先量留白链再写选择器。
- 做法：先从一块卡片**沿父链上溯**打印每层的 rect / padding / margin / 背景色（同类结构对照探针
  可参考 `scripts/probe-rightrail.js`），**先在真机上试注入候选 CSS、量准并截图看过，再写回脚本**。
  实证见 [`v1.2.0-full-bleed.md`](v1.2.0-full-bleed.md) §2~§3。

## 版本策略（重要，别踩）

- **以 v1.0.0 为基线**：`v1.0.1` / `v1.0.2` 是**另一条分支**，用户明确选择不包含它们：
  - 1.0.1：回答/问题区块宽度不一致、图片查看器居中（**1.0.0 下图片查看器会跑到屏幕外**）
  - 1.0.2：文字截断治理（box-sizing + max-width + overflow-x）、长 token 断行
  这两版的代码**只在 git 历史里，main 上已没有**。若日后要「1.0.2 的全部改进 + 这些修复」，
  需另开一版把两条线合并。
- 版本号写在 userscript 头部（`// @version`）；每次变更同步更新 `docs/` 与 Release。

### 何时升 minor（2026-09-30 确立，按既有先例归纳）

`MAJOR.MINOR.PATCH`：

- **MINOR**（`1.1.0` / `1.2.0` / `1.3.0`）：**新增用户可见的行为或版式契约**，
  或**配置项的名字/语义发生变化**。先例：
  - `1.1.0` 限制双指缩小（新行为）
  - `1.2.0` 块状版式铺满整列（新版式契约）
  - `1.2.4` 把 `CFG.feedThumbWidth` 换成 `CFG.feedThumbLines`（配置项语义变更）
  - `1.2.8` 问题页页首按钮排布（新行为）
- **PATCH**：修 bug、以及**既有行为的调参与迭代**（对齐微调、间距、文案、性能）。
- **一段 patch 序列里若其实夹带了新行为，就在下一次发布时归并成 minor**，
  并在该 minor 的 release note 里**按主题汇总**这段区间的改动。
  例：`1.2.1`~`1.2.10` 归并为 **`1.3.0`**（其中 1.2.2 / 1.2.4 / 1.2.8 是新行为）。
- 归并发布时**代码可以只改 `@version` 一行** —— 内容与上一版逐字节相同，只是版本口径归正；
  这种「纯版本归并」**不需要跑回归**（无行为变更），但 release note 要写清汇总范围。

## 发布流程

完整步骤见技能 SKILL.md 的「发布 Release」一节，这里只记**容易忘的硬性约定**：

- Release note 里写更新记录 + 安装地址 + **sha256**；**更新记录不写进 README**。
- tag 指向**该版本当时的提交**（不是 HEAD），附件是那个提交的 `zhihu-desk2mob.user.js`
  （`git show <commit>:zhihu-desk2mob.user.js`）。
- `gh release create --target` **必须给完整 40 位 SHA**（短 SHA 会 422）。
- 版本号回滚过、不打算再用时：**删掉它的 Release 与 tag**，免得下载列表里留着一份被撤回的代码
  （提交仍在历史里，可重建）。
- 脚本头部带 `@updateURL` / `@downloadURL` 指向 raw main（v1.0.6 起），
  所以**从 Release 附件安装的也会自动更新**。

## 验证（改脚本后必须全绿再发版）

6 个真机测试，见 [`scripts/README.md`](../scripts/README.md)。两条容易踩的：

- **`window.__z2mStop()` 是半清理**：只摘样式表、不断内联样式，**不能当「无脚本」基线**。
  判断「某问题是否由某次改动引入」要用**同一轮内的改前/改后对照**。
- 测试之间的**环境前提**要显式满足，而且**不要指望测试自己补**：缺回答页 / 专栏页时它会退到
  别的页面并报**前置失败**（如「发布框打不开」），不是自动补开。**不要靠静默降级**——那会把
  环境问题伪装成产品回归。（本机两次「假失败」都是缺页面造成的，已实测。）
- **验证范围：小改动不必跑全套**（用户 2026-09-30 明确要求）。按**改动的波及面**决定：
  - **只动一处 CSS / 文案**（例如问题页按钮排布）⇒ 跑**受该改动影响的那一套**即可，
    不必跑另外 5~6 套；必要时再加**一条冒烟**（挑覆盖面最广的那套，如 `test-rightrail`）。
  - **动到公共层**（`html/body` 的 zoom、`--z2m-w`、`capFixed`/`hideSideRails` 这类全局扫描、
    发版前的最终确认）⇒ 才跑**全套**。
  - 判断依据是「**这个改动可能破坏什么**」，不是「跑全套更保险」——全套要好几轮真机往返，
    对小改动是纯浪费。
  - 无论跑几套，**新写的断言都要先做改前/改后对照**，确认它有判别力（改前必须 FAIL）。
- **`test-counterzoom` 的 ②③ 会间歇失败**（同一份代码两次运行可能 5/7 或 7/7），
  原因见「已知未修」第 6 条 —— 看到它失败先重跑一次再判断。
  ⚠️ 该测试的 ②③④ 会 `Emulation.setPageScaleFactor` 改写页面比例，而 **CDP 没有「清除
  pageScaleFactor」的接口**（`clearDeviceMetricsOverride` 实测也清不掉）—— 所以它现在会在**收尾时
  记下进测试前的比例并设回去**。若某次运行被中断（Ctrl-C / 报错退出）没走到收尾，那张标签会残留
  被改写的比例，两个症状：
  ① **页面能横向平移、右侧出现一片空白**（`visW < innerWidth`，实测 715 vs 891）；
  ② 紧接着重跑本测试时①步拿 **0 个样本**（残留 `scale = 1` 时 `Z = visW / SW` 恰等于 `applyZoom()`
  里 `curZ` 的初值，那行 `if (Math.abs(Z - curZ) < 0.005) return;` 提前返回、不写内联 zoom）。
  补救：把那张标签 `Page.navigate` 走（移出匹配范围），或把比例设回健康值（本机 **0.40111**）。
  细节见 [`scripts/README.md`](../scripts/README.md) 的 counterzoom 注。
- **`test-counterzoom` 的 ①②（加载期「全程不超宽 / 视觉尺寸稳定」）也会间歇失败**：
  同一次运行里 `fitRatio` 开头两个采样可能是 **`1.1577`**（内容比视口宽 16%），随后收敛到 1。
  **已用 v1.2.2 的发布件 A/B 排除**（同版本三次运行有一次复现）⇒ 是**既有的、与版本无关的
  加载期竞态**。看到 ①② 失败同样**先重跑一次**再判断。

## 调试顺序（省时间的顺序）

1. `scripts/probe-*.js` 定位「现象出自哪个容器／哪一层」，别先猜 CSS；
2. `.workbuddy/skills/kiwi-violentmonkey-cdp/scripts/inspect.js` 看屏幕顶层叠加层与关闭入口在不在屏幕内；
3. 改脚本 → `--installed` 跑对应测试 → 全套；
4. 涉及视觉的改动：`adb exec-out screencap -p` 抓真机屏（比 `Page.captureScreenshot` 抗造）。

**优先怀疑脚本自己的规则**：本项目两次「莫名其妙」的坏版式（头像被拉高、
「同时发布到想法」竖排、右边缘残留）根因都是**脚本自己无差别施加的通用规则**，
而不是知乎的问题。详见技能 SKILL.md 的「坑」一节。

## 已知未修（不要当成新 bug 去追）

1. 弹层原生「关闭」按钮仍在屏幕外（`right:-60px`），退出由返回手势承担。
2. ~~写「写想法」卡片里的「同步到圈子」是竖排残留（自 1.0.0 起）~~ —— **已于 v1.2.0 解决**：
   它塌成 0 宽（`rect {x:298, w:0, h:95}`）、7 个汉字逐字竖排，是**「发到圈子」的功能开关**。
   用户 2026-09-30 决定**去掉**，现由 `CFG.hideCircleSync` 隐藏（按文案定位，见
   [`v1.2.0-full-bleed.md`](v1.2.0-full-bleed.md) §4）。
3. v1.0.1 / v1.0.2 的改进未包含（见上方「版本策略」）。
4. **专栏页顶部比问答页多一层常驻 62px 吸顶文章头**（`ColumnPageHeader*`，稳定类名；
   问答页没有）。实测两页常驻顶部条加起来：专栏页 `y=0..124`、问答页 `y=0..62`。
   另外脚本里 `.AppHeader { position: static !important }` 其实**对两页都已失效** ——
   知乎把导航条换成了 emotion hash 类名（`css-s8xum0`），而且它是 `position: fixed` 的**外层 wrapper**，
   内层 `header.AppHeader` 被设成 static 也没用。这两条都可能让「滚到顶部对齐」的内容被压住。
   尚未动手（截图复现不稳，见下次接手时的记录）。
5. **`test-idea-option` 的「把发布框调出来」这一步不稳**（v1.2.0 期间发现，属测试工装问题）：
   它按固定滚动偏移扫描 + 只看 `focus()` 是否成功，而**零尺寸/隐藏元素也能 focus 成功**，
   于是会在「发布框其实没打开」的状态下继续断言。已修掉两处静默降级（加可见性前置、
   去掉 rect 全 0 时的假通过），现在它会**如实报**「找不到任何『发布』按钮可见的发布框」。
   要恢复判别力，需要改掉「靠固定偏移扫滚动」的定位方式（页高一变就落空）。
   **与列宽无关**：同页 A/B（只改 `--z2m-w`）里发布按钮在 393 / 358 / 325 下都正常（61×29 可见）。
6. **`test-counterzoom` 的 ②③ 会间歇失败**（v1.1.0 起，与 v1.1.1 无关）：模拟捏合时浏览器会先
   经过「最小比例」那一档，脚本按那一档重算出的 zoom 偏大；最后那一发事件又因「捏合不变量」
   （`visW × scale` 不变）被 return 掉，于是停在「内容比屏幕宽 25%」。
   试过两种修法（延后 200ms；延后 + 若仍在最小比例就再等一拍）**均无效，已回退**。
   真机连续捏合不经过那个中间态；即便出现，用户再捏一下就恢复。
   机理与取舍见 [`v1.1.1-text-scale.md`](v1.1.1-text-scale.md) §3。
7. **加载期会出现一次短暂的「放大约 16%」**（间歇，1~2 个采样）：`test-counterzoom` 的①②
   因此在部分运行里报 FAIL（`fitRatio` 开头是 `1.1577`、`worstFit 0.158`、`jitter 15.8%`），
   随后自动收敛到 1。**已用 v1.2.2 的发布件 A/B 排除版本相关**（同版本三次运行有一次复现）。
   症状轻（一闪而过），尚未定位到成因。看到①②失败**先重跑一次**再判断。

## 待办：弹层定位修正与 zoom 耦合（未完成，优先）

**背景**：`zhihu-desk2mob.user.js` 的 `fixCommentModal()` 判断「卡片是否比容器大」，用的是**双方各自的 rect**
（CSS px）。但实测：

| | v1.0.7（zoom=1） | v1.0.9（zoom=0.9098） |
| --- | --- | --- |
| 弹层容器高（CSS px） | 1753 | **1927** |
| 容器高（布局 px） | 1753 | **1753**（不变） |
| 卡片高（CSS px） | 1832 | 1832（不变） |
| 越界判断结果 | 卡片 > 容器 → 修正触发（`flex-start`） | 卡片 < 容器 → **不触发**（`center`） |

**机制**：弹层容器的高度是**按布局 px 定的视口高度**，所以在 CSS px 下会随 `html{zoom}` 缩放；
而卡片高度是固定 CSS px。于是**反缩放一变，越界判断的结论就翻转**，定位修正时灵时不灵。

**用户的硬要求**：弹层顶部**不能有遮挡**。

**要做的事**：把该判断改成与 zoom 无关（例如拿**可见视口高度**比，或在布局坐标下比），
并确认顶部标题栏（「N 条评论 默认 最新」+ 关闭按钮）不被状态栏或任何元素遮住。
改完跑 `scripts/test-comment-back.js --installed`（23 条断言）与 `test-modal-layout.js`（受控夹具）。

**排查工具**：`scripts/probe-rightrail.js`（结构对照）、`scripts/probe-overlay.js` /
`probe-topalign.js` / `probe-sticky.js`（浮层与吸顶取证）、技能里的
`.workbuddy/skills/kiwi-violentmonkey-cdp/scripts/inspect.js`（顶层叠加层 + 关闭入口是否在屏幕内）、
`adb exec-out screencap -p` 抓真机屏。注意 `Page.captureScreenshot` 在长会话后不可靠。
