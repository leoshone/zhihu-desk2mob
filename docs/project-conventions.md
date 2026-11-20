# 项目约定（接手须知）

这份文档是**换机／换人接手时需要知道的项目决策**，不重复技能与 README 已写的内容：
环境与工具方法论见 [leoshone/Skills → browser-extension-e2e](https://github.com/leoshone/Skills/tree/main/browser-extension-e2e)（私有，原项目内技能 kiwi-violentmonkey-cdp 已于 2026-11 迁入该仓库），
测试怎么跑见 [`scripts/README.md`](../scripts/README.md)，各版本根因见 [design-decisions.md](design-decisions.md)。

## 环境（实测）

| 项 | 值 |
| --- | --- |
| 真机 | Xiaomi 2211133C（codename `fuxi`），1080×2400，CSS 视口 393×873 |
| 浏览器 | Kiwi + 暴力猴（扩展 ID `fcickoepngcnapddnnmjpkmpekmfmpaa`） |
| 调试 | `adb` 在 PATH；CDP 转发 `tcp:9222`（**每轮 shell 会丢**，`scripts/cdp.js` 加载时自建） |
| 桌面调试（2026-11-20 增） | Turbo 浏览器（`D:\Software\Turbo\turbo.exe`，Chrome 156，`--remote-debugging-port=9222` 直连宿主机，**不经 adb**）；暴力猴 2.50（扩展 ID `jinjaccalgkegednnccohejagnlnfdag`）；DevTools 设备模拟 393×873 dpr3 + `?z2m-force=1`。三种测试环境对照与各环境陷阱见 [`test-environments.md`](test-environments.md) |
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
   `scripts/shots/`（测试截图）。换机后这些不会跟过来，但**结论都已沉淀进 `docs/design-decisions.md`**；
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

## 反缩放契约

- `html{zoom} = visW / SW`（`visW` = `visualViewport.width`），目标是**内容恰好铺满**（`fitRatio = 1`），
  **不是** `1 / scale`。详见 [design-decisions.md §4](design-decisions.md)。
- 捏合：**放大不干预**；**缩小夹在「恰好铺满」这个下限上**（`CFG.limitZoomOut`）。
  判据 `zoom × scale < curScreenW / SW` —— 因为「铺满时的视觉尺寸」= `屏幕可用宽 / 列宽`，与 scale 无关。
- **浏览器允许的捏合下限 = 屏幕可用宽 ÷ `innerWidth`**（本机 358 / 891 = 0.401，两页实测逐档一致）。
  所以别再把「问答页缩不下去、专栏页能缩」当成浏览器差异 —— 那是脚本**有没有在捏合后重算 zoom**，
  且旧实现不稳定（取决于 `window.resize` 是否恰好触发）。详见
  详见 [design-decisions.md §4.2](design-decisions.md)。
- **屏上大小 = 名义字号 × (屏幕可用宽 ÷ 列宽)**：单列布局里唯一的旋钮是列宽，不能只调
  `html{zoom}`（那会让列宽于屏幕、被 `overflow-x:hidden` 裁掉右边）。
  `CFG.textScale` 就是这个换算因子（1 = 字号就是名义值），实现见
  [design-decisions.md §5.1](design-decisions.md)。
  **当前值 `1.0`（正文 16px，即名义字号）**。定值沿革（0.90976 → 0.98 → 1.0）与机制
  详见 [design-decisions.md §5](design-decisions.md)。要调就改这一个数，别去动 font-size。
- **别在 `applyZoom()` 里调用依赖 `let` 声明的清理函数**（如 `clearScanMemo`）——
  `applyZoom` 在初始化早期执行，会撞 TDZ 让**整个 IIFE 抛错、脚本完全不生效**，
  而症状看起来像「暴力猴没注入」。判活的判据是 `#z2m-style` 是否存在 / `style.zoom` 是否为空。

## 块状版式

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
  实证见 [design-decisions.md §6.1](design-decisions.md)。

## 操作栏换行

- 现行规则一行：`.ContentItem-actions { flex-wrap: wrap !important; row-gap: 4px !important; }`
  —— 知乎这排是 flex nowrap + 子项全 `flex:0 0 auto`，列宽 358 时右侧约 3 个按钮会被屏幕裁掉。
- ⚠️ 这条规则曾被一次**与本段无关的提交误删**（编辑器里替换错行），且后续版本留下的错误注释
  （引用已不存在的规则）把排查误导了很久。教训：**删 CSS 规则时先确认没有别的注释在依赖它**；
  排查「以前正常现在不正常」用 `git log -S "<规则原文>"` 定位，别猜。
- ⚠️ **恢复时只还原这一条，别顺手改间距 / 外边距**——曾试过额外归零子项 margin、加 column-gap、
  归零容器「出血」margin，结果操作栏左端右移 20px，被用户否掉（用户要求保持贴左侧）。
- ⚠️ **断言别用容器的 `rect.right`**（恒等于列宽，无判别力）；要量**最右子项**的右缘。
- 回归：`scripts/test-actions-wrap.js`（默认打回答页；覆盖专栏页先开一个专栏页标签）。
- 遗留可接受：出血保留使部分卡片容器右端出屏 4px，但换行后按钮内容都落在容器内，视觉不裁。
  若日后要收，**只归零右边距**、不动左边距。

## 问题页吸顶迷你头：标题与按钮同一行

- 滚动后知乎把标题收进 188px 吸顶栏 `.PageHeader`，栏内 flex-wrap 让「长标题 + 96px 关注按钮」
  必然两行；用户要求压成一行并缩小。
- **「放在一行」本身有代价**（宽度守恒）：标题不换行自然宽 380px、可用只有 156px——
  强行一行按钮不缩时标题只露 3.4 字（比改前还少）；两行+缩小有 10.9 字。
  用户明确要一行，取「一行 + 缩小 + 左移 + 无关按钮让位」＝标题可见 **8.6 字**。
- 三处关键缺一不可：覆盖 `.FollowButton` 的 `min-width:96px`；清左内边距；隐藏吸顶栏里的
  蓝色「+」按钮与显示不下的按钮。
- ⚠️ 作用域必须限定 `.PageHeader` 内——页首完整标题区同名类（实测与吸顶栏不是同一套 DOM，
  限定后不误伤）。
- ⚠️ 推按钮注意「按钮右端 ≠ 吸顶栏右缘」（栏右缘按头像区宽度算，与头像间会空 31px）——
  用 `.QuestionHeader-side { margin-left:auto; margin-right:-20px }` 推出容器（overflow:visible 不裁）。
- ⚠️ 标题左端别贴 LOGO：padding-left 调到 14px，间距正好一个字宽。
- ⚠️ **字号与字数此消彼长**（宽度守恒是本条所有取舍的底层原因），改任何一项先想清楚从谁嘴里抢空间。
- ⚠️ 既有测试脆弱性：`test-question-actions` 的 `findTab('question')` 可能选中**回答页**
  （没有「好问题」按钮）固定报 2 条 FAIL——用同页 `--installed` 对照排除，非产品回归；
  想跑满需真机开一个纯问题页标签（不带 /answer/）。

## 版本策略

- **一版一事、逐个发布**：一次改动发一个版本，不攒批、不归并（用户 2026-10-01 明确）。
- 不强制区分 minor / patch 语义（单人项目，语义化版本的价值不成立）；小版本换来更细的回滚粒度。
- 版本号写在 userscript 头部（`// @version`）；变更记录写 Release note（**不写进 README**）。
- 以 v1.0.0 为基线：v1.0.1/v1.0.2 是另一条分支（用户选择不包含，代码只在 git 历史）。
- v1.7.1/1.7.2 已回退弃号（写想法卡片重排失败）；要重做从 1.7.0 起步、先在 Kiwi 真机验证。
- ⚠️ 教训：不要把「从先例归纳出的做法」自行固化成硬约束（曾有 agent 自创的「版本归并」约定
  被用户明确推翻）。

## 发布流程

完整步骤见技能 SKILL.md 的「发布 Release」一节，这里只记**容易忘的硬性约定**：

- **不再逐次征询**（用户 2026-10-01 明确：「后面你都自己发」）：改动完成 + 自测通过后**直接发**，
  走完整流程（`node scripts/check-injected.js` 体检 → 提交 push → 抽发布件并记 sha256 → Release →
  装机 → `--installed` 终验），**事后报告**即可。不再问「要发吗」。

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
- **`test-counterzoom` 的 ②③ 会失败**（5/7）：文档早先记为「间歇」，2026-10-01 复核为**稳定复现**、
  且**与脚本版本无关**（`--installed` 跑旧版同样失败、数据一字不差）—— 机理见「已知未修」第 6 条。
  **不要靠重跑判断**，用 `--installed` 对照排除「是否本次改动引入」即可。
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

## 加载期闪烁：隐藏 / 矫正类 pass 必须同步跑在 observer 回调里

- **症状**：首页加载时「写想法」卡片里的竖排「同步到圈子」会**先显示出来、随后才消失**，
  「发想法」按钮也会先以**越出屏幕**的形态出现、再跳回屏内 —— 页面看起来就是抖一下
  （用户 2026-10-01 两次反馈）。
- **根因**：`hideCircleSync()` / `fitIdeaButton()` 都只挂在 `tick()` 上，而 `tick()` 有 **300ms 去抖**
  （`schedule()` = `setTimeout(tick, 300)`），并且**每次 DOM 变动都会重置这个计时器** ——
  页面加载期变动密集，于是被一路推迟。实测「同步到圈子」延迟 **1.8~1.9 秒**（远不止 300ms）。
- **解法**：把**所有「矫正类」pass** 像 `syncCommentModal()` 一样**同步挂在 MutationObserver 回调里**：

  ```js
  const obs = new MutationObserver(() => {
    syncCommentModal(); hideCircleSync(); fitIdeaButton(); hideIdeaOption();
    const btns = publishButtons();            // 一次查询给下面两个 pass 共用
    fitPublishButton(btns); matchComposerAvatar(btns);
    schedule();
  });
  ```

  observer 回调是**微任务**、跑在同一帧渲染之前 ⇒ 元素一出现就被处理。
- ⚠️ **前提：每个 pass 都要有廉价前置判断**，否则「每次 DOM 变动都跑一遍」会拖慢主线程：
  - `hideCircleSync` / `fitIdeaButton` —— `.WriteArea` 不存在就直接 return；
  - `hideIdeaOption` —— `[contenteditable="true"]` 不存在就直接 return（它那条 XPath 单次 3~7ms）；
  - `publishButtons` —— **2026-10-01 补上的前置**：`[contenteditable="true"]` 不存在就返回空数组。
    这次「全文档 button 扫描」在首页要遍历 **125 个按钮、单次 0.6ms**；加前置后降到 **0.1ms**
    （guard 查询本身 0.06ms）。有了它，下游的 `fitPublishButton` / `matchComposerAvatar`
    才能一起挂上来 —— 否则打开评论框时「发布」按钮与头像也会先闪一下。
  实测各 pass 稳态单次开销 **0.06~0.1ms**（`_tmp/bench-publishbuttons.js`）。
- `tick` 里原有的那一遍调用**全部保留**，作为「周期性全量重扫」的兜底。
- **实测**（用 `Page.addScriptToEvaluateOnNewDocument` 注入探针，记录「元素出现」与「被处理」的时间差）：

  | 目标 | 改前 | 改后 |
  | --- | --- | --- |
  | 「同步到圈子」被隐藏 | ~1830ms | **~27ms** |
  | 「发想法」按钮被修正 | 35.7 / 39.2 / 370 / **3040** ms（波动极大）| **42~49ms（稳定）** |

- ⚠️ **通用教训**：凡是「加载期需要隐藏／矫正某个元素」的 pass，**都不能只挂在去抖的 `tick` 上** ——
  用户会看到元素先以未处理形态出现、再被修正，也就是「抖动」。
  先例：v1.3.5 把「首屏藏侧栏」从 JS 挪到 CSS，也是同一个问题。
- ⚠️ **验证这类改动的两个坑**（本次都踩了）：
  1. 探针必须监听 `attributes` / `style` —— 隐藏与矫正都是靠**改内联样式**实现的，只听 `childList` 测不到那一刻，
     `firstHidden` 会被推迟到下一次 DOM 变动，从而得出一张「改了也没用」的假表。
  2. `Page.addScriptToEvaluateOnNewDocument` **比暴力猴的 `@run-at document-start` 还早**，
     那时 `document.documentElement` 是 `null`，脚本开头写 viewport meta 会抛错并**静默中断**
     （症状：注入的实例完全不生效，`phase` 停在 'A'）。注入整份脚本时必须包一层
     「等 `documentElement` 就绪再跑」。
  3. 基线是**波动**的（36ms ~ 3040ms，取决于元素出现在 DOMContentLoaded 之前还是之后），
     所以**单次采样会骗人** —— 至少要采 4 轮看分布。

## 调试顺序（省时间的顺序）

- **改完 CSS 的第一件事**：跑 `node scripts/check-injected.js`。整套 CSS 写在脚本内的一个 **JS 模板串**里
  （`st.textContent = \` … \`;`），注释或规则里混进一个反引号就会**提前闭合**它
  ⇒ `#z2m-style` 根本插不进去、**样式全失效**，而 `node --check` **可能照样通过**
  （反引号成对时语法恰好合法）。本项目已踩三次（2026-09-30 两次、2026-10-01 一次）。
  静态检查做不可靠（模板串内有故意的嵌套模板串），运行时体检几秒钟出结果。
- 0. **先判断这是不是「以前正常、现在不正常」的回归** —— 若是，**先用 git 历史定位**，别急着改代码：
   `git log -S "<规则原文>" --oneline -- zhihu-desk2mob.user.js`（`-S` 列出「该字符串出现次数变化」的提交），
   再对候选提交跑 `git show <sha>:zhihu-desk2mob.user.js | grep -n "<选择器>" -A 6` 逐版比对。
   本轮就是这么查出「赞同栏不再换行 = **v1.3.9 误删**了 v1.0.0 起就存在的通用换行规则」——
   从「怀疑 v1.3.8」到定案只花了三条命令，且避免了我按自己想法自创修法（那版修法已被用户否掉一次）。
1. `scripts/probe-*.js` 定位「现象出自哪个容器／哪一层」，别先猜 CSS；
2. `inspect.js`（原技能工具，现随 [leoshone/Skills → browser-extension-e2e](https://github.com/leoshone/Skills/tree/main/browser-extension-e2e) 分发）看屏幕顶层叠加层与关闭入口在不在屏幕内；
3. 改脚本 → `--installed` 跑对应测试 → 全套；
4. 涉及视觉的改动：`adb exec-out screencap -p` 抓真机屏（比 `Page.captureScreenshot` 抗造）。

**优先怀疑脚本自己的规则**：本项目两次「莫名其妙」的坏版式（头像被拉高、
「同时发布到想法」竖排、右边缘残留）根因都是**脚本自己无差别施加的通用规则**，
而不是知乎的问题。详见技能 SKILL.md 的「坑」一节。

**真机调试案例：v1.4.21「关注」下的灰线**（2026-11-16，小米 fuxi + Quetta/Chrome 148）——
现象像知乎的元素、极易误判，实际是**脚本自己的坑**，记录在这里避免重查：

- v1.4.19 给导航壳 `.css-51utkw` 加 `overflow-x:auto` 实现横向滑动，但没隐藏壳自身滚动条；
- Chrome 121+ 新内核按**标准属性**渲染滚动条（约 3px，rgb(192,192,192)），恰好落在壳底 = 「关注」正下方；
- 模拟器 Kiwi（Chrome 137）走旧 webkit 机制，被脚本已有的 `::-webkit-scrollbar` 规则盖住 ⇒ **模拟器上永远复现不了，只在真机暴露**；
- 定位耗时长的原因：DOM 里根本没有这条线（滚动条不在元素树里），`elementFromPoint`、逐元素 visibility 消元都查不到它；最终靠「隐藏壳层→灰线消失」的消元实验锁定；
- 修法：壳层补 `scrollbar-width:none` + `::-webkit-scrollbar` 双机制（与 nav 已有写法对齐）。

**教训**：①给任何容器加 `overflow:auto/scroll` 时，两类隐藏滚动条的机制要**同时**写全；
②「模拟器正常、真机异常」优先怀疑**内核版本差异**（137→148 跨了标准滚动条分界）；
③疑似「页面上的线」若 DOM 扫描无果，直接试滚动条假设——它是唯一不在元素树里的绘制物。
真机 CDP 接入：`adb forward tcp:9223 localabstract:chrome_devtools_remote`，工具 `_tmp/env/qcdp.js`。

## 桌面调试环境（Turbo/Chrome156 + 暴力猴 2.50，2026-11-20 实测）

用宿主机浏览器调试比真机快得多（不经 adb、截图/注入秒级往返）。踩过的坑：

- **browser 级 CDP ws 必须带 GUID**：`ws://host:9222/devtools/browser` 裸路径 404，
  要从 `/json/version` 的 `webSocketDebuggerUrl` 取完整地址（`scripts/lib/cdp.js` 已修，自动取）。
- **9222 端口冲突**：宿主机浏览器直开 9222 时，`adb forward tcp:9222` 会把端口抢走。
  `cdp.js` 已改为「forward 表里已有 tcp:9222 才 forward」，宿主机直连与真机互不干扰。
- **`@run-at document-start` 注入失效**（Chrome 156 + 暴力猴 2.50）：用测试脚本对照实证——
  同一内容 `document-end` 注入成功、`document-start` 完全不跑。主脚本已改 `document-body`（v1.6.9）。
  Kiwi 旧内核（Chrome 137）不受影响。
- **`Emulation.setDeviceMetricsOverride` 随连接消失**：模拟参数只在 CDP WebSocket 保持期间生效，
  断开即自动清除——肉眼验证要用常驻进程保持连接，或干脆 `Browser.setWindowBounds` 把窗口缩成手机尺寸。
- **`__z2mMoved` 类 DOM 属性标记在 bfcache 下会随 DOM 一起恢复**——reload 命中 bfcache 时标记残留、
  「只搬一次」的逻辑永远跳过。脚本内改按「当前位置是否正确」判断（幂等），不依赖 DOM 属性。
- **脚本自带视口守卫会「吞掉」桌面模拟**：`innerWidth≤600` 时脚本按设计退出（Kiwi 真机免跑）。
  桌面 DevTools 模拟手机视口会命中守卫——用 `?z2m-force=1` URL 参数绕过（v1.7.0）。
- **写想法卡片的表情/输入组件在模拟环境持续「加载失败」**：知乎接口在模拟网络下加载不出，
  非脚本问题；验证该卡片布局需 Kiwi 真机。
- ⚠️ **改写想法卡片布局的两次失败记录（v1.7.1/1.7.2，已回退）**：absolute 定位「发想法」按钮
  跑到 x=1425 屏外（卡片含块链复杂）；快捷入口 `flex:1 1 0 + nowrap` 把每项撑到 364px 爆容器。
  该卡片布局要改先**在真机 Kiwi 上改**，模拟环境看不到输入框区的真实渲染（接口加载不出）。

## 已知未修（不要当成新 bug 去追）

1. 弹层原生「关闭」按钮仍在屏幕外（`right:-60px`），退出由返回手势承担。
2. ~~「同步到圈子」竖排残留~~ 已解决（`CFG.hideCircleSync`，见 design-decisions §6.1）。
3. v1.0.1 / v1.0.2 的改进未包含（见上方「版本策略」）。
4. 专栏页比问答页多一层常驻 62px 吸顶文章头（`ColumnPageHeader*`）；且 `.AppHeader
   { position:static }` 对两页均已失效（导航条换成了 emotion hash 外层 wrapper、fixed）。
   都可能让「滚到顶部对齐」的内容被压住。尚未动手（截图复现不稳）。
5. `test-idea-option` 的「把发布框调出来」不稳（工装问题）：靠固定滚动偏移扫滚动 + 只看
   `focus()`（零尺寸/隐藏元素也能 focus 成功）。已修掉静默降级、现在会如实报「找不到发布框」。
   要恢复判别力需改掉「固定偏移扫滚动」的定位方式。与列宽无关（同页 A/B 已验证）。
6. `test-counterzoom` 的 ②③ 会失败：模拟捏合会先经过「最小比例」档（按它重算的 zoom 偏大），
   最后一发又因捏合不变量被 return。两种修法均无效已回退；真机连续捏合不经过中间态、
   用户再捏一下即恢复。机理见 design-decisions §5.1。⚠️ 复核为**稳定复现**且 `--installed`
   跑旧版同样复现 ⇒ 与脚本版本无关。**看到这 2 条 FAIL 不要靠重跑判断**，用 `--installed`
   对照确认是否与本次改动相关。
7. 加载期偶发一次「放大约 16%」（1~2 个采样后自动收敛）：counterzoom ①② 因此部分运行报
   FAIL。已用旧发布件 A/B 排除版本相关。症状轻、成因未定位。看到①②失败**先重跑一次**再判断。

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
`inspect.js`（原技能工具，现随 [leoshone/Skills → browser-extension-e2e](https://github.com/leoshone/Skills/tree/main/browser-extension-e2e) 分发）（顶层叠加层 + 关闭入口是否在屏幕内）、
`adb exec-out screencap -p` 抓真机屏。注意 `Page.captureScreenshot` 在长会话后不可靠。
