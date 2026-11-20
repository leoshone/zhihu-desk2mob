# ADR 汇编：设计决策记录（原 docs/ 散文件的合并归档）

> 本文件合并了原 `docs/` 下 17 份按版本散落的方案文档，**内容全文保留**（仅去重目录性的
> 重复段落），按「功能域」重组章节。每节标注涉及的版本与原始文件名（git 历史可查）。
>
> 配套文档：[AGENTS.md](../AGENTS.md)（项目规范）、
> [`test-environments.md`](test-environments.md)（三种测试环境）。

## 目录

1. [评论弹层（v1.0.3 / v1.2.3 / 待办）](#1-评论弹层)
2. [评论发布框（v1.0.4 / v1.0.5）](#2-评论发布框)
3. [右缘残留与侧栏隐藏（v1.0.7 / v1.5.0 / v1.5.2）](#3-右缘残留与侧栏)
4. [反缩放与捏合（v1.0.9 / v1.1.0）](#4-反缩放与捏合)
5. [正文字号（v1.1.1 / v1.1.2）](#5-正文字号)
6. [块状版式与写想法卡片（v1.2.0 / v1.5.3）](#6-块状版式与写想法卡片)
7. [信息流封面缩略图（v1.2.2 / v1.2.4~1.2.7）](#7-信息流封面缩略图)
8. [问题页按钮排布（v1.2.8~1.3.2）](#8-问题页按钮排布)
9. [登录/注册页（v1.4.18）](#9-登录注册页)
10. [个人主页（v1.4.19~1.4.21）](#10-个人主页)
11. [知乎 2026-11 改版适配（v1.5.0 系列）](#11-知乎-2026-11-改版适配)
12. [留白统一（v1.6.0~1.6.4）](#12-留白统一)
13. [v1.0.5 代码审查报告](#13-v105-代码审查报告)

---

## 1. 评论弹层

### 1.1 v1.0.3 · 评论弹层修复（原 v1.0.3-fix-comment-modal.md，158 行）

> 基线：**v1.0.0**。本版不含 v1.0.1/v1.0.2 的改动（两条独立分支，见 conventions 版本策略）。

**背景**：手机上用桌面板知乎，回答里点「N 条评论」打开的弹层**无法关闭**——找不到退出入口，
返回会直接离开整个问答页。用户思路：点评论时把问答页压入历史，让返回关闭弹层。

**实测环境**：Xiaomi 2211133C（1080×2400，CSS 393×873），Kiwi 桌面模式 + 暴力猴，
`innerWidth=1430`、`scale=0.25`、`zoom=3.83256`（旧公式 1/scale）。

> ⚠️ 反缩放让页面有两套坐标：`getBoundingClientRect` 与 CSS px 同坐标，
> `elementFromPoint` 用布局坐标（≈ rect × zoom）——命中测试易误判。

**根因**（弹层结构：portal 容器 [fixed, z203, flex center, overflow hidden auto]
→ 卡片外壳 [max-height 1832] → .Modal-content；关闭按钮 absolute right:-60px）：

1. **卡片 1832 > 容器 734 + 垂直居中 → 顶部永久不可达**：溢出上下均分，卡片上移 549px
   （= (734−1832)/2），落在滚动原点之上，scrollTop 不能为负 → 滚不回来。
2. **卡片 688 > 屏幕 373 → 右侧被裁 315px**（正文在屏幕边缘切断）。
3. **关闭按钮在卡片外**（right:-60px），屏幕外。
4. **打开弹层不压历史**，直接进回答页时 history.length 常为 1 → 返回直接离开知乎。

**方案**：

- **4.1 返回键关闭（哨兵历史）**：打开时 `history.pushState({z2mComment:1})`；用户返回 →
  popstate → 关闭弹层。知乎自己不监听 popstate，所以必须「压历史 + 主动关闭」成对。
  关闭动作两级兜底：①点知乎自己的关闭按钮（`.click()` 不走命中测试，按钮在屏外也生效——关键）；
  ②补发 `Escape`（document 与 activeElement 各一次），300ms 后复查再补。
- **4.2 溢出定位修正（只在越界时动手）**：卡片高于容器 → 容器 `justify-content:flex-start`；
  卡片宽于容器 → `max-width:100%/width:auto/align-self:stretch`。不越界的弹窗一律不改
  （否则会把正常居中的小弹窗顶到屏幕顶部）。

**安全设计**：

| 风险 | 处置 |
| --- | --- |
| 哨兵残留 → 用户多按一次返回 | `dropGuard()` 主动 `history.back()` 撤回 |
| 撤回会撤销用户在弹层里的导航 | 撤回前校验 `history.state.z2mComment===1` |
| 刚点开就按返回，哨兵未压入 | 开合同步挂 MutationObserver（不走 300ms 去抖）+ 800ms 兜底轮询 |
| `display:none` 残骸误判为打开 | 判据 `.Modal-content` 存在即打开（关闭后 ~400ms 内被移除） |
| 定位修正反复写样式 | 写前比 rect，只在越界时写，先查内联值 |

**CFG**：`commentBack: true`、`fixCommentLayout: true`。

**代码改动**：新增自包含模块（locateModal / fixCommentModal / pushGuard / dropGuard /
closeCommentModal / sendEscape / syncCommentModal + popstate 监听）；CFG 2 开关；
CSS 加 `.Modal-content { box-sizing:border-box }`。相对 v1.0.0 新增 173 行 / 删 5 行。

**验证**（真机实装）：返回键 / Escape / 点关闭按钮 / 关后再开 / 定位修正 全通过。
修复前后对照：卡片 [0,−549,688,1832] → [0,0,393,1832]；标题栏回到 y=0；正文 393 全宽。

**已知遗留**：①关闭按钮仍在屏外（搬进屏内会压住「默认/最新」标签，且 z-index 受卡片堆叠上下文
限制被头部行覆盖）——退出统一由返回手势承担；②图片查看器屏外问题由 v1.0.1 修（本版不含）。

### 1.2 v1.2.3 · 弹层不再能被横向滑动推走（原 v1.2.3-modal-no-horizontal-slide.md，64 行）

**现象**：弹出的评论可以往左滑动——弹层左移、左边被裁、右边露底页。

**取证**：`.Modal-content` 宽度正确（358）但位置 −60..298；其固定层 `clientWidth 358 /
scrollWidth 418 / scrollLeft 60.04`——被横向滚动了 60px。418−358=60 恰是那个故意放在
屏外的原生关闭按钮（right:-60px）撑出的溢出。

**根因**（两因叠加，都在脚本侧）：
1. `capFixed()` 给「宽于列宽的 fixed 元素」设 `overflow-x:auto` → 该层成了可横向滚动容器；
2. 60px 溢出平时看不见（按钮在屏外），`auto` 一开就变成可滚区域 → 一划推走 60px 且回不来
   （scrollLeft 停在 60）。

**修法**：`capFixed()` 的 `overflowX` 由 `auto` 改 **`hidden`**（纵向滚动仍由该层承担）。
实测：scrollLeft 60→0，弹层 −60..298 → 0..358，不能再推走。

**顺带查清**：`test-counterzoom` 的加载期断言（①②）也间歇失败——同一份代码多次运行，
`fitRatio` 序列有时开头两个采样是 `1.1577`（比视口宽 16%）随后收敛到 1。
已用 v1.2.2 发布件 A/B 排除本次改动（装回旧版三次，一次复现同样瞬变）⇒ 既有的加载期竞态。
看到 ①② 失败先重跑，别当产品回归。

**相关待办**：弹层溢出判断与 zoom 耦合的修正（conventions「待办」节，未完成）——
容器高按布局 px 定、卡片高是固定 CSS px，反缩放一变「卡片>容器」的结论就翻转。

### 1.3 遗留待办：弹层定位与 zoom 耦合

背景：`fixCommentModal()` 判断「卡片是否比容器大」用双方 rect（CSS px）。实测 v1.0.7（zoom=1）
容器 1753 → 触发修正；v1.0.9（zoom=0.9098）容器 CSS px 1927 → 卡片「小于」容器 → 不触发。
要做：判断改成与 zoom 无关（用可见视口高比，或布局坐标下比），确认顶部标题栏不被遮挡。
改完跑 `test-comment-back --installed`（23 断言）+ `test-modal-layout`（夹具）。
排查工具：probe-overlay / probe-topalign / probe-sticky、技能仓库的 inspect.js。

---

## 2. 评论发布框

### 2.1 v1.0.4 · 发布框修复（原 v1.0.4-fix-comment-composer.md，129 行）

**问题一：「同时发布到想法」竖排撑高发布框。**
选项包裹层 0×121、文案 13×121（7 字竖排）、发布框高 185~219。
根因：包裹层 flex 子项 `min-width:0` 可收缩到 0 宽 + 文案允许换行——**这条 min-width:0
是脚本自己加的**（v1.0.0 的 `main div… { min-width:0 !important }`），是脚本自身规则的副作用。
修法：按文案定位（不能按 hash 类名——emotion 随构建变化），向上收成「除该文案外不含其它文字」
的最大祖先 → `display:none`（连单选框图标一起隐藏，不误伤同行「发布」按钮——其祖先文案含
「发布」不满足收敛）。实测发布框 185 → **94px**。
⚠️ 该选项**只在输入框聚焦后才渲染**——不点进去查不到，会误判「页面没有这个选项」。

**问题二：「发布」按钮右溢 20px。**
行可用 225 / 内容需 304（超 79）。行内两子元素都是 `flex:0 0 auto`（互不相让）：
编辑区 218（知乎样式）+ 发布按钮 62（**本脚本的** `main button { flex:0 0 auto }`——初衷
「按钮不能竖排」没错，问题是行内没有可收缩元素）。
方案对比：A 允许换行（按钮可见但发布框 +24px）vs **B 编辑区可收缩**（`flex:1 1 auto` +
`min-width:0`，高度不变）——选 B。定位规则：从「发布」按钮向上找第一个「自身溢出且首个子元素
占大半内容宽」的行（跳过 7px 的控件容器），只在行宽 ≤ 列宽时动手。

**CFG**：`hideIdeaOption` / `fitPublishButton`。实现用 XPath 按文案定位 + 缓存已处理节点
（SPA 重建后 `isConnected` 失效自动重找）。

### 2.2 v1.0.5 · 头像与弹层按钮（原 v1.0.5-fix-avatar-and-modal-publish.md，107 行）

**问题一：发布框头像被拉高（40×122）。**
根因是 v1.0.0 的通用规则 `img, video { max-width:100% !important; height:auto !important }`：
`height:auto` 顶掉了知乎的固定高度，头像所在 flex 行 align-items:normal(stretch) → 拉到整行高。
同一条规则还让一批列表头像高度塌成 0（24×0，实测回答页 3 个、专栏页 8 个，随渲染数变化）。
修法：`.Avatar` 从该规则排除——`img:not(.Avatar), video { … }`。头像回到 40×40，塌陷的恢复 24×24。

**尺寸取舍**：知乎发布框头像 40px、评论列表 24px。按用户要求「与评论里其他人一样大」缩到
24×24——刻意偏离站点设计，留开关 `matchComposerAvatar:true` / `composerAvatarSize:24`。
定位走结构（发布框头像只有通用类 `.Avatar`）：从「发布」按钮向上找第一个内含 `img.Avatar` 的祖先。

**问题二（顺带发现）：弹层内「发布」按钮竖排（49×58，文字折成「发/布」）。**
脚本的按钮 nowrap 规则写的是 `main button, header button`，而弹层挂在 **body 的 portal 里、
不在 main 内**——规则漏掉整个弹层区域。修法：补 `.Modal-content button { white-space:nowrap }`。
**刻意只加 nowrap、不加 `flex:0 0 auto`**（后者会让按钮拒绝收缩撑溢出——正是 v1.0.4 踩过的坑）。
实测弹层「发布」恢复 62×30。

**反思（反直觉结论，比修法本身更值钱）**：这两处都不是知乎的问题，而是**脚本自己的通用规则误伤**。
写「通杀式」规则时作用范围要么收窄到真正需要的元素，要么补全所有挂载点。排查顺序：先怀疑脚本自己。

### 2.3 v1.0.5 代码审查要点

审查范围：脚本 467 行 + 三份文档 + README + 四个测试 + 技能。**带「实测」的都是真机取证。**

**高优先级**：
- **H1 `tick()` 单次 20-44ms**，滚动期 2.3 次/秒 → 每秒 46-100ms 主线程开销（掉帧来源）。
  归因实测：capFixed 扫描 7.9-21.2ms、hideSideRails 7.7-11ms、hideIdeaOption XPath 3.3-7ms。
  建议：逐元素 WeakSet 记忆化；capFixed 维护「已发现 fixed 集合」只复查 + 新节点；装饰性 pass
  移进 requestIdleCallback。
- **H2 `hideIdeaOption` 找不到文案时每拍全量 XPath**（3.3-7ms/拍）——发布框不在的页面永远白花。
  一行前置判断（`[contenteditable]` 或「发布」按钮不存在时直接返回）。
- **H3 `applyZoom` 早退不还原 zoom**（scale≥0.9 return，但已写的 zoom:3.83 留着 → 页面保持
  3.8 倍桌面排版）。机制确定、可达性待验（scale 只读无法伪造）。修法一行：else 分支
  `removeProperty('zoom')`。

**结构性**：
- **M1 `__z2mStop()` 是半清理**（只摘样式表 + 断观察器 + 清定时器，不撤内联样式不还原 zoom）
  → 拿它当「无脚本基线」的诊断结论不可靠（206 元素仍带内联样式、htmlZoom 未还原）。
  `probe-publishbtn --off` 的数据即无效对照。二选一：补全还原，或文档写明「只停 CSS 不停 JS 改动」。
- **M2 头像/发布按钮祖先查找无上界**——发布框行没头像时循环可能命中无关容器把作者头像改 24px。
  加固：停止条件改「该层含 `[contenteditable]`」。潜在风险（未能构造复现）。
- **M3 横竖屏切换后 JS 阈值过期**（SW 是常量、resize 只更新 CSS 变量）。

**一致性 L1-L9**：注释与文档数字口径不一（13×121 vs 13×155）；「3~8 个头像塌 0」写成普遍结论；
测试只采集不断言的字段；早期脚手架注释残留；重复规则；未设 @downloadURL（v1.0.6 已修）。

**做得好的（有意设计，别破坏）**：越界前置判断（不越界不动）；节点缓存 + isConnected 自愈；
哨兵撤回前校验 history.state；定位避开 emotion hash；测试自备环境不依赖外部状态；
文档记录「反直觉的结论」。

---

## 3. 右缘残留与侧栏

### 3.1 v1.0.7 · 右缘竖排残留（原 v1.0.7-fix-right-rail-residue.md，92 行）

**现象**：首页右边缘 ~40px 竖条，逐字竖排「帮助中心/举报中心/关于知乎/服务热线」等页脚链接。

**根因**：`.Topstory-container(flex row 373)` 下侧栏 `DIV.css-bkewaf` 整体塌成 **w=0**
（内含热搜卡、盐言卡、推荐关注卡、FOOTER 页脚 rect x:377 w:0 h:2113）。两条件叠加：
①宽度塌 0 + `white-space:normal` → 每字各自换行；②`overflow:visible` → 0 宽盒子不裁剪、
文字照旧画出来。**不是文字没隐藏，而是 0 宽盒子在照常显示文字。**

**为什么现成 `hideSideRails` 没盖住**：其判据是几何式 `width 80..420 && height≥300`——
侧栏塌成 0 宽后第一个条件不成立，整条被放过。

**修法**：判据补「塌陷形态 B」——`width≤4 && height≥60 && hasText`（三条件都必要：
塌了；有文字可溢出才算残留——纯图标 0 宽是正常的不该动；排除细小塌陷包装层）。
同时保留「落在右半边」（v1.0.6 加，避免误伤左右等宽版式的正文列）。
不单独藏 `<footer>`：真正该消失的是整条侧栏（还有热榜/广告卡/推荐关注同样竖排）。

**验证**：「帮助中心」等 4 项由可见 → 不可见；「宽≤4 却含文字」的可见元素 9 → 0；
正文列 341px 未被误伤；信息流 12 条不变。

### 3.2 v1.5.0 系列的左栏/右缘处理（见 §11）

---

## 4. 反缩放与捏合

### 4.1 v1.0.9 · 反缩放改「恰好铺满」（原 v1.0.9-fix-counter-zoom-fit.md，97 行）

**现象**：打开页面比屏幕宽一点（像被双指放大），每次都要捏回去。

**定量**：屏幕可用 CSS 宽 **357.5**（1080 ÷ dpr 3.0235）、脚本列宽 `SW` **393**（screen.width）
→ 老公式 `zoom = 1/scale` 铺满的是 393，实际屏 357.5 → **恒大 9.9%**（fitRatio 1.0992）。

**为什么时好时坏难复现**：浏览器加载期**逐级**调整缩放，级差恰好也是 ×0.9097——老代码
「上一级算的 1/scale」常正好等于「这一级铺满所需值」，看着是对的；等它用当前比例再算才露馅。
真机采样：老版 fitRatio `[1.0001, 1.0001, 1.0992, 1.0992…]`（前 0.45s 对，之后卡 1.0992）；
新版 `[1,1,1…]`（22/22）、视觉尺寸恒定抖动 0%。

**修法**：`Z = visW / SW`（瞄准铺满而非 1/scale）。关键性质：
`SW × Z × scale × dpr = visW × scale × dpr = 屏幕宽度`——恒定、与 scale/visW 无关，
加载期布局视口一路变（980→1077→1184→1301）、反复重算 Z，**视觉零跳变**（数学保证）。

**捏合处理**（v1.0.9 原设计「一律不干预」已被 v1.1.0 部分推翻，见 §4.2）：
只听 `window.resize` 不够（浏览器改比例不触发它）；直接听 `visualViewport.resize` 又会抢捏合。
区分：用户捏合改变 scale 与 vv.width 但**乘积（屏幕可用宽）不变**；浏览器改 dpr/视口时乘积才变。

**验证**：test-counterzoom 修前 2 FAIL（worstFit 9.9%/jitter 9.9%）→ 修后全 PASS。
全套回归：反缩放 4/4、右边缘 9/9、头像 8/8、发布框 8/8、评论弹层 23/23、定位夹具 10/10。
版本 1.0.7 → 1.0.9（1.0.8 方案不对被回滚，不复用该号）。

### 4.2 v1.1.0 · 限制手工缩小（原 v1.1.0-limit-zoom-out.md，132 行）

**现象**：专栏页双指捏合可缩到只占屏宽 49%（半屏小字）。用户要求限制、与首页/问答一致。

**定量**：布局视口 891；屏幕可用宽 358（= vvWidth×scale，**捏合不变量**）；浏览器捏合下限
scale=0.40111（=358/891）；缩到下限时 zoom 未变、视觉尺寸 ≈0.45（铺满值 0.910 的一半）。

**关键否证**：逐档扫 `Emulation.setPageScaleFactor`（1→0.8→…→0.25），专栏与问答**逐档一致**
都夹在 0.40111 ⇒「问答页限制得住、专栏页不行」**不是浏览器差异**，而是**脚本有没有在捏合后
重新铺满**（问答页某次重算了 zoom、专栏页没重算——同手势两页不同，且这点不稳定）。

**修法**：按方向分开。判据「铺满时的视觉尺寸」`fillVisual = curScreenW / SW`（与 scale 无关）：
- 当前视觉 < fillVisual（缩小过头）→ 拉回铺满
- 屏幕可用宽变了 → 重算
- 其余（捏合放大）→ 不干预

容差 0.02（curScreenW 取整过，太小会误触发；2% 的缩小肉眼不可见）。

**4.1 「拉回铺满」必须延后一拍（顺序敏感 bug）**：浏览器换挡先经过中间态——
`setPageScaleFactor(0.5)` 先来一发 `visW=innerWidth` 的 resize，就地重算会按中间态算出过大
zoom（891/393=2.268）；紧接着真正那发 (715, 0.5) 到来时 `zoom×scale=1.134` > 铺满值 0.9109
→ 判为「用户放大」不纠正；乘积检查 358 vs 358（不变量）→ return。结果停在 fitRatio 1.2465
（内容宽出 25%）。修法：`refitSoon()` 延后 200ms（此时比例已稳，按最终几何重算）；放大方向不受影响。

### 4.3 反缩放契约汇总（详见 conventions 同名节）

- `zoom = visW / SW`，不是 1/scale
- 捏合：放大不干预；缩小夹在「恰好铺满」下限（CFG.limitZoomOut）
- 屏上大小 = 名义字号 × (屏幕可用宽 ÷ 列宽)；唯一旋钮是列宽
- ⚠️ 别在 applyZoom 里调用依赖 let 声明的清理函数（撞 TDZ，整个 IIFE 抛错、脚本全失效，
  症状像「暴力猴没注入」；判活看 `#z2m-style` 是否存在）

---

## 5. 正文字号

### 5.1 v1.1.1 · 屏上换算因子 0.98（原 v1.1.1-text-scale.md，95 行）

**需求**：用户反馈正文偏小。先试 1.1（屏上 17.6px）→ 太大回退；用户真机手捏到合适大小，
要求「参考我打开的页面」定值。

**定值方法（可复用）**：探针逐标签量「屏上换算因子」（zoom×scale）与正文屏上 px，找用户捏过的
那个：专栏文章 2.26808×0.43208=**0.97998**（用户捏的）→ `CFG.textScale=0.98`。

| 版本 | 屏上正文字号 |
| --- | --- |
| 原默认（0.90976） | 14.56px（嫌小）|
| **本版 0.98** | **15.67px** |
| 已回退 1.1 | 17.6px（嫌大）|

**机制**：屏上大小 = 名义字号 × (屏幕可用宽 ÷ 列宽)，唯一旋钮是列宽；不动任何 font-size。
列宽用「实际可用宽」反推 → 屏上因子恒等于 textScale。真机列宽 393→365，fitRatio 仍 1。

**已知未修**：test-counterzoom ②③ 间歇失败（v1.1.0 起就有，非本版引入）。机理已定位：
`setPageScaleFactor(0.5)` 先经过「最小比例」档，按那档重算的 zoom 过大；真正那发到来时
已被判成「用户放大」不纠正，乘积检查（捏合不变量）又成立 → return，事件被吞。
试过延后 200ms、延后+再等一拍均无效已回退——要根治必须区分「用户放大」与「浏览器换挡中间态」，
但两者可观测状态完全相同，除非引入手势级信号（未验证）。真机上是否出现该中间态也未证实；
即便出现，用户再捏一下即恢复。

**副作用**：列变窄固定尺寸 UI 行变挤，已补 `.AuthorInfo { text-overflow: ellipsis }`。

**验证**：idea-option 8/8、avatar 8/8、rightrail 9/9、comment-back 23/23、modal-layout 10/10、
counterzoom 5/7（②③既有）。

### 5.2 v1.1.2 · 默认回到名义字号 1.0（原 v1.1.2-text-scale-default.md，91 行）

用户真机手动把 textScale 改成 1.0 用了一段时间确认满意，要求写成默认值（免得换机还要手改）。
注意定值方式区别：0.98 是捏合量出来的；**1.0 是取整到名义字号、有意偏离那次实测**。

| 版本 | textScale | 列宽 | 屏上字号 | 每行汉字 |
| --- | --- | --- | --- | --- |
| v1.0.9 | 0.90976 | 393 | 14.56px | ≈24 字 |
| v1.1.1 | 0.98 | 365 | 15.67px | ≈22 字 |
| **v1.1.2** | **1.0** | **358** | **16.0px** | **≈22 字** |

> 1.0 仍小于被否掉的 1.1（17.6px）——「比 0.98 略大、没大到被否」的一档。

**排查时先看**：浏览器 scale 已是 1 时，`Z = 358/358 = 1` 恰等于 curZ 初值 →
`if (|Z−curZ|<0.005) return` **提前返回不写 zoom**——这是正确行为，但会让
test-counterzoom ①步拿不到样本（只统计有内联 zoom 的采样）。

**副作用**：列宽 365→358（≈22 字/行不变）；屏上 15.67→16.0px（+2.1%，即本次目的）。
验证五套全绿，counterzoom 5/7（②③既有，A/B 逐字一致）。

### 5.3 新发现的工装缺陷（已同步技能）

counterzoom 的 ②③④ 会 setPageScaleFactor，收尾只 Page.navigate **不还原** → 被选中的标签
残留 `scale=1`。而它每次取**第一个**匹配 zhihu.com 的标签 → 重跑时 ①步必然 0 样本
（表现像 renderer 挂死）。对策：重跑前把残留标签移出匹配范围或重启 Kiwi。
此前 SKILL.md 只把「0 采样」归因于后台标签冻结，本次补齐这个更易踩的成因。

---

## 6. 块状版式与写想法卡片

### 6.1 v1.2.0 · 块铺满整列（原 v1.2.0-full-bleed.md，107 行）

**需求**：去掉内容列两侧灰边，保留块间灰缝。

**取证**：灰色 = body 背景 rgb(244,246,249)；两侧各 26px = 脚本 .App-main 10px + 知乎容器 16px。
那个 16px 容器：首页 `.Topstory-container`（稳定类名）、专栏/问答是 emotion hash → 结构选择器
`.Post-content > div` / `.QuestionPage > div`。首页右列另有 `.Topstory-mainColumn { margin-right:10px }`。
白色块自带内边距（首页 16/专栏 20/问答 22）→ 去外留白后文字仍有呼吸感，**不需要补内边距**
（一开始误以为卡片 padding=0，量了才发现是内层 .ContentItem 的）。
块间竖缝来自卡片自身 `margin-bottom:10px` → 只动横向必然保住。
⚠️ `.App-main` 与 16px 容器间夹 3~4 层包装 div（含混淆类名），按深度写的选择器打不到。

**改法与实测（列宽 358）**：

| 页面 | 改前 | 改后 | 文字内缩 |
| --- | --- | --- | --- |
| 首页 | 26..332 | **0..358** | 16px |
| 专栏 | 10..348 | **0..358** | 20px |
| 问答 | 10..348 | **0..358** | 22px |

块间竖缝不变（10px）。开关 `CFG.bleedEdges`。

**顺带解决「已知未修」#2 竖排「同步到圈子」**：那一行只有 234px 可用，开关被挤成 0 宽
（x:298 w:0 h:95）、7 字逐字竖排。它是发到圈子的功能开关，隐藏=去掉功能（产品取舍，用户
2026-09-30 确认）。新增 `CFG.hideCircleSync`，定位复用 hideIdeaOption 那套（XPath 找文案 →
向上收敛 → display:none，不误伤同行「发想法」按钮）。

**6.1a 「发想法」按钮收进屏幕（v1.2.1）**：去灰边后按钮从越出 35px 减到越出 9px。根因三个缺一不可：
①知乎写死 `width:75px`（改 padding 无效——宽度不随内边距走）；②自带 `margin-left:20px`；
③文字 45 + padding 18×2 = 81 > 盒子 66。解法（`CFG.fitIdeaButton`）：`width:auto` +
`margin-left:0` + padding 12px。实测 292..367 → **272..341**（距右缘 17px，与块内右界 342 对齐）。

试过无效/被否的路子（别重复）：只收窄 padding（width 写死纹丝不动）；父盒 flex:0 0 auto
（越界 9→88 更糟）；父盒 margin-right / 行 padding-right（无效）；行 flex-wrap（可进屏但独占一行，
用户否掉）；`:has()` 选父盒（Kiwi 支持，此布局帮不上）。
⚠️ **排查「元素越界」先读它自己的 margin 与写死的 width**——本次两个关键事实都不是 padding 造成的。

**验证**：comment-back 23/23、idea-option 8/8、avatar 8/8、rightrail 9/9、modal-layout 10/10、
counterzoom 5/7（既有）。版式改动对 rightrail/idea-option 有判别力，均全绿。

### 6.2 v1.5.3 · 新版写想法卡片（见 §11 改版适配）

新版卡片两个问题：快捷入口行被压成 54px 逐字竖排 → fitQuickEntries()（容器 wrap + 项 nowrap，
2×2 排列）；「发想法」按钮画在 x=298 溢出列外 → 按钮壳移到工具栏下方独立一行右对齐
（relative 左移会压到视频图标，DOM 移动是唯一干净解）。

⚠️ **v1.7.1/1.7.2 重做此卡片布局两次失败已回退**（absolute 按钮跑到 x=1425 屏外；快捷入口
flex 1 1 0 + nowrap 每项撑到 364px 爆容器）。要重做先在 Kiwi 真机验证。

---

## 7. 信息流封面缩略图

### 7.1 v1.2.2 · 封面改小 + 真环绕（原 v1.2.2-feed-thumbnail.md，79 行）

**需求**：图片太大；文字要在图片右侧**与下方**环绕。

**取证**：封面 `.RichContent-cover` 是 `float:left` 固定 **190×105**（内部 absolute inner +
object-fit cover）——「文字绕右侧」本来就是设计。问题是 190px 占内容列 326 的 58%，
右侧文字只剩 136px（每行 7~8 字）。
**「下方不环绕」根因（关键）**：`.RichContent-inner` 的 `overflow:hidden` 使其成为 **BFC**——
BFC 盒子被整体挤到浮动元素旁、**永不在浮动下方回宽**。逐行实测：正文 8 行全部 L=154。
试过 6 条候选规则均无效（都没碰到 BFC）：span display:block、inner display:block、
两者同时、cover/容器 overflow:visible。

**改法**：`.ContentItem .RichContent-inner { overflow:visible !important }` + 封面 100×55。
实测：文字可用宽 136→226；逐行左缘 8 行全 154 → 首行 198、其后全宽。
开关：`CFG.feedThumbWidth`（0=不干预）、`CFG.wrapAroundThumb`。
⚠️ v1.2.4 起「宽度」旋钮改为「按行数」（feedThumbLines，默认 3）——按宽度定高度会落在两行之间
（100→55≈1.97 行）且图片顶比文字视觉顶高 6px。本节取证（封面结构、BFC）仍有效。

试过无效/错误的路子：cover-inner position:static（❌ 图片推出屏 L=-44，卡片只剩浮占位）；
zoom 缩封面（❌ 浮动盒仍 190×105 文字不变宽）；只解 overflow 不改尺寸（⚠️ 回宽但图仍大）；
正文块 display:block / 外层 overflow:visible（❌ 无效，必须打到 inner 这层）。
⚠️ **排查「浮动旁文字不在下方回宽」先看正文容器的 overflow/display 是否成了 BFC。**

**验证**：comment-back 23/23、idea-option 8/8、avatar 8/8、rightrail 9/9、modal-layout 10/10、
counterzoom 5/7（既有）。本次改首页信息流，rightrail 对它有判别力，全绿。

### 7.2 v1.2.4~1.2.7 · 按行数定尺寸 + 三种盒对齐（原 v1.2.4-thumb-line-align.md，159 行）

**需求**：图片跟文字上下没对齐；改成「3 行文字高度」（宽度跟随）且上下对齐。

**取证**：正文行高 28px（16×1.75，脚本自己的字号规则）。v1.2.2 的 100px 宽 → 高 55 = 1.97 行。
「没对齐」真因：图片顶与**行框顶**重合，但文字有**半行距 6px**（(28−16)/2），文字视觉顶在
行框顶下 6px ⇒ 看着图片比文字高。实测图顶 118、文字首行视觉顶 124，偏差 −6px。

**改法（v1.2.4）**：`CFG.feedThumbLines`（默认 3，0=不干预）：
`height: calc(var(--z2m-line) * 3)`（84px）+ `width:auto` + `aspect-ratio:190/105` + `margin-top:4px`。
对齐量取 4px 不取 6px：逐档实测 4px 时顶偏差与底偏差**同时为 0**（取实测值不取理论值）。

**v1.2.5 修正「图片占了 4 行」**：知乎给封面带 `margin-bottom:4px`。浮动的影响高度 =
margin-top + height + margin-bottom，超过 N×行高则第 N+1 行行框被压住跟着缩窄——看起来占了
N+1 行。实测 84+4+4=92>84 ⇒ 第 4 行被挤窄。**图片不必缩小**：`margin-bottom:-4px` 抵消掉
（84+4−4=84 = 3×行高），「3 行高 / 顶底对齐 / 只占 3 行」同时成立。用户原提议「图片再缩小一点」
（h=76 → 138×76）也能让第 4 行回全宽，但白牺牲 14px 宽并留 8px 底缝。

**v1.2.6 修正「图片底部比第 3 行文字底低 7px」**：高度 N×行高=84 时图片底边落在**第 4 行的
行框顶**——行框 28px 里字形盒只有 ~21px，图片底其实比第 3 行字形底还低 ~7px。改高度
`N×行高 − 7px`（只减一次，行间距本来该留着）。h=77 时图底−第3行文字底 = +0.4（对齐）。

**v1.2.7 修正「两端都冒出去」**：v1.2.6 按**内联盒**（getClientRects 框，由 ascent/descent 定）
对齐，而眼睛看的是**字形墨迹盒**。16px 字体实测：行框 28 / 内联盒 22（ascent 17 + descent 5）/
**字形墨迹盒 15**（actualBoundingBoxAscent 14 + Descent 1）。字形顶比内联盒顶低 3px、底高 4px
→ 按内联盒对齐图片两端都冒（v1.2.6 h=77 实测 −2.32 / +3.68）。改高度 **(N−1)×行高 + 字形盒高**
= N×行高 − 13px（13 = 28−15）；margin-top 4 → 6.3px。实测（h=71, mt 6.3）128×71、
两端偏差 **−0.02px**；旁排 3 行；文字可用宽 187 → 198px。

> ⚠️ **与文字做「行对齐」一定先想清跟行框(28)/内联盒(22)/字形盒(15)哪个对齐**——本功能先后踩过
> 前两个坑。量字形盒：`canvas.measureText` 取 actualBoundingBoxAscent/Descent；
> 内联盒顶 = 基线 − fontBoundingBoxAscent，据此换算偏移。

**验证**：v1.2.4/5/6/7 各套回归全绿（counterzoom 5/7 既有）。

---

## 8. 问题页按钮排布

### v1.2.8~1.3.2 · 页首按钮一行 + 均匀分布 + 对齐正文（原 v1.2.8-question-actions-one-line.md，202 行）

**现象**：问题页页首「关注问题/写回答/邀请回答」三个按钮不在同一行，「现在这样好难看」。

**取证（v1.2.8）**：三按钮分属两个容器——关注/写回答在 `.QuestionButtonGroup`（第 1 行）、
邀请回答 111px 在 `.QuestionHeaderActions`（第 2 行）。合计 327 ≤ 358 一行放得下。
**根因是脚本自己的 CSS**：`.QuestionHeader-footer-inner` 被本脚本强制 `flex-direction:column`
⇒ 两容器只能上下堆叠。

**v1.2.8 改法**：inner 改 `row + wrap + align-items:flex-start`；
`.QuestionHeaderActions { display:contents }`（解散排布壳）。
⚠️ **实测只把外层改 row 无效**——.QuestionHeaderActions 作为整体（含邀请回答+好问题+评论+分享）
会整个换行；只有 display:contents 解散它，按钮才能真正参与第一行。该容器是纯排布壳（无背景/边框），解散安全。
实测三者 T 309/309/**342** → **309/309/309**。

**v1.2.9 修正（用户：右边两个挤在一起、希望左移均匀分布）**：真正的层级是 inner → **`.QuestionHeader-footer-main`**
（真正承载按钮的 flex 行，还有 20px 左内边距）→ 两个容器；⚠️ 类名带 `-main` 后缀，v1.2.8 的选择器
打偏了（只是恰好让三按钮同排）。挤压根因：`.QuestionButtonGroup` 带 **margin-right:-8px** 把
「邀请回答」拉过来贴住「写回答」（实测间距 [16, 0]）。三层一起动：inner 清 padding/margin-right；
main 设 flex wrap + space-between + column-gap:10 + padding 0；两容器 display:contents；
按钮 margin 清零。实测三按钮 0..96 / 124..220 / 247..358、间距 [28,27] 均匀、左右空 0/0。

**v1.2.10 修正（用户：两侧该留白、至少不超正文文字区）**：正文文字区实测 20..338，而按钮区
0..358 顶到边。给按钮行加回 `padding:0 20px`——可用宽剩 318，三按钮 303 + 间隙 10×2 = 323 > 318
会换行 ⇒ 同时把按钮左右内边距 16→13px（各窄 6px 共省 18px，内容盒不变文字不裁）。
实测 20..116 / 130..220 / 233..338，与文字区完全一致，间距 [14,13]。

**v1.3.1 修正（下方 4 个文字按钮拆成两行）**：两个原因都出在 v1.2.10 的选择器——
①`.QuestionHeader-footer-main button` 是**后代**选择器，把纯文字按钮的 padding 也撑到 13px
（原本 ≈0）每宽 26px；②知乎在这批按钮和它们的壳上各塞了 20px 的 margin-left/right，
4 项含边距 326 > 318。改法：内边距只给三个主按钮（`.QuestionButtonGroup > button, …`）；
文字按钮与其壳的 margin 清零（间距交给容器 column-gap）。
⚠️ **不能写 `.QuestionHeader-footer-main > button`**——display:contents 只改盒树，DOM 上按钮
仍属原壳，CSS 的 `>` 选不中（实测无效）。⚠️ 这段 CSS 在 **JS 模板串**里，注释不能出现反引号
（模板串提前闭合，项目踩过两次）。

**v1.3.2 修正（横屏时文字按钮没和框按钮居中对齐 + 右侧留白不齐）**：取证（横屏列宽 754，7 项
挤一行）：3 框按钮 T=205..239（高 34）、4 文字按钮 T=208..226（高 18）→ **顶对齐**显得靠上；
文字按钮行右缘 305 vs 正文右界 338 空 33px——页首还有一个**零尺寸空壳 `.QuestionHeader-actions`**
（小写 actions，与 .QuestionHeaderActions 不是一个），是 flex 项宽 0，被 space-between 顶到最右。
改法：main 加 `align-items:center`（横屏同行中线对齐）+ `row-gap:10px`（竖屏两行不挤）；
`.QuestionHeader-actions { display:contents }` 去掉空壳。实测文字按钮 T 208 → 214..232 中线对齐；
竖屏两行间距 2 → 12px；文字按钮行 20..338 贴齐正文右界。

**验证**：test-question-actions 逐版加断言并做改前/改后对照（证明判别力）：v1.2.8 新增 9 条
（改前 8/1 → 改后 9/0）；v1.2.9 +3 条（间距差 ≤4px 等）；v1.2.10 换两条（留白 ≥8px、不超文字区；
改前 11/2 → 改后 13/0）；v1.3.1 +2 条（总行数 2、好问题与分享同行；改前 13/2 → 改后 15/0）；
v1.3.2 +2 条（行间 ≥8px、右缘贴齐 ≤2px）。本系列每版只跑这一套（验证范围约定）。

---

## 9. 登录/注册页

### v1.4.18 · SignFlowHomepage 单列化（原 v1.4.18-fix-sign-page.md，43 行）

日期 2026-10-23，环境 MuMu（小米 13 同参）+ Kiwi 137 + 暴力猴 2.49.0，桌面模式。

**现象（用户）**：①右侧输入区被截（手机号输入框被右缘裁）；②首屏整屏插画，表单推到第二屏外。

**根因**：桌面登录页 `.SignFlowHomepage` 是「左插画 + 右表单」双栏，窄列下三处叠加：
①背景图 sign_bg.png + 自身撑到 1925px 高、content 是 column + center（min-height 688px）
→ 插画占满首屏；②表单区两列 flex：左二维码推广 162px + 右登录卡片 196px → 卡片输入行需 ~310px
被右缘裁；③登录卡片外壳是 emotion hash 不能进选择器 → 结构选择器 `.signQr-rightContainer > div`。

**修法**（全稳定类名）：背景 none / min-height auto；content justify-content flex-start；
logo 块级居中；`signQr-leftContainer`（二维码推广）隐藏；容器改 block；rightContainer 及其子 100%；
SignContainer-content 100%。

**验证**：check-injected 78 条规则（+7）；验证码/密码登录输入框 25..335 全宽在屏内
（此前被裁）；分隔行三段对称；LOGO 顶部居中；卡片全宽 1..359。
**取舍**：二维码推广隐藏（手机扫码无意义且是挤压直接原因）；插画整体去（纯装饰）；
表单内部控件不动（知乎自己的排布在 358 下正常）。

---

## 10. 个人主页

### v1.4.19 · Profile 单列化（原 v1.4.19-fix-profile-page.md，50 行）

日期 2026-10-23，MuMu + Kiwi 137 + 暴力猴 2.49.0，登录态 `/people/toperp/posts`，桌面模式。

**现象（用户）**：头部与内容区右侧被裁（.ProfileHeader/.Profile-main 宽 390 > 358 溢出 32px）；
「关注他」压住签名；顶部导航「专栏/圈子」被裁无法滚动。

**根因（列宽 358）**：①两者带 `margin-right:-32px`（桌面头图出血）+ content-box + width:358 +
左右 padding 16 → 实际 390；②头像 absolute 在左上、content 靠 `border-left:164px transparent`
让位——**直接清 border-left 会让名字/签名移到头像下面整块盖住**（第一版就踩了）；③contentBody
写死 524px、contentHead 的 .Button--plain absolute right:0 压住签名；④顶部导航 nav 463px、
壳层被压到 188 且 overflow:visible → 溢出被 header 裁剪层裁掉。

**修法**（全稳定类名）：margin-right:0 + border-box；main 改 block；头像 static 居中独立成行；
content 清 border-left 改 padding 16/16/8 + margin-top 4；contentHead max-width 100%；
Button--plain static；contentBody width auto；nav overflow-x auto + 滚动条隐藏 + nowrap +
a flex 0 0 auto；壳层 overflow-x auto + flex 1 1 0 + min-width 0。
关键取舍：**上下排布**——桌面「左头像 168 + 右内容」在 358 放不下，保留并排会把内容压到 82px，
按钮组（213px）必然压住文字；头像独立成行后名字/签名/职业/按钮各占整行互不遮挡。

**验证（--installed）**：90 条规则注入；.ProfileHeader/.Profile-main 0..358；整页无横向溢出；
头像居中独立行；名字 52..154；contentBody 254 全宽；按钮并排 93..306 完整可见；导航可滚（壳层
scrollWidth 651 > 188）；视觉逐项截图核对。

**排查中顺手修的环境坑**：people 页 CDP 求值挂死（1+1 30s 无响应）= 已知「长会话 renderer
挂死」，am force-stop 重启 Kiwi 恢复。

### v1.4.20/1.4.21（无独立文档，记于 Release 与 conventions）

v1.4.20 修新版吸顶 tab 条 portal 叠顶导航错乱；v1.4.21 隐藏顶部导航壳横滚条（新内核 Quetta
显示为「关注」下灰线；两类滚动条隐藏机制要同时写全；「模拟器正常真机异常」优先怀疑内核差异）。

---

## 11. 知乎 2026-11 改版适配

### v1.5.0 系列（原 v1.5.0-zhihu-redesign.md，181 行）

**背景**：首页/问答/搜索/个人主页新增**左侧栏**（40px 图标竖条 + 58px 展开面板），顶部导航换
`LeanAppHeaderBar`（旧 .AppHeader 不再渲染），内容区壳多层 flex 带桌面写死宽（1104/784）。
旧选择器与宽度假设全部失配，窄列下 3~4 列横向平铺。

**决策：左栏隐藏不搬运（方案 A，用户确认）**——左栏入口顶栏都有属重复；DOM 搬运要与 SPA
重渲染对抗（observer 反复搬回）脆弱高维护；隐藏即回到旧版已验证的单列布局。

**改动清单**：
1. 新顶部导航适配（.LeanAppHeaderBar 语义类名稳定）：static、满宽、内部可横滚、隐藏滚动条。
2. 左栏隐藏 + 内容区收宽（hideLeftNav，JS 几何识别——类名全是 emotion hash）：
   从 main.App-main 向上找第一个「flex 且子元素 ≥3」祖先（css-syn8px）；隐藏其子级「宽 ≤64
   且全高」的竖条/面板/壳（40/58/0 三种形态）；内容区壳 width auto；**main 的直接父壳设
   flex:1 1 auto + min-width:0**——它是 flex row 子项，窄列被 shrink 压到 38px（people/search
   实测 main 跟着 38px、文字逐字竖排、页面高 6 万 px）；隐藏父壳兄弟中「全高 ≥300 宽 >200」的
   元素（= 内容壳内右栏 ASIDE 320px flex:0 0 auto 拒绝收缩，挤压元凶）。
3. 问题页：按钮行左侧 24.5px 竖排数据窄条（好问题/评论数/关注/浏览）隐藏（hideQuestionDataRail，
   不依赖 hash：从 .FollowButton 向上穿 display:contents 壳找按钮行，隐藏其中宽 ≤40 且含按钮/
   数据子项的非按钮容器）。
4. 个人主页：新版吸顶 tab portal `.ProfileMain-contents`（语义类名）display:none（旧规则依赖
   hash 已失效）。
5. 圈子页：成员行 flex nowrap 每成员 84px 排到 3360px → wrapRingMemberRows 允许换行。
   ⚠️ 首版「子项宽度相近」判定漏行（首项 60 其余 84），放宽为「含图标子项 ≥ 总数−2」。
6. `CFG.forceSW` 调试口子：桌面/模拟器 emulation 视口与真机口径不同（vv.scale 恒 1、curScreenW
   被算成整个视口宽）自动校准失真；forceSW:358 复现真机布局，audit 脚本注入前 replace。真机默认 0。

**验证**：audit-all 8 页（home/hot/question/column-post/people/signin/ring/search）全 PASS
（main [0,·,358,·] 满宽、横向溢出 0）。

**测试基建坑**：
- Chrome137 (Kiwi) 上 `Page.addScriptToEvaluateOnNewDocument` 不生效 → navigate 后直接
  Runtime.evaluate 脚本体（__z2mStop 幂等保护）。
- **emulation 截图伪影**：html zoom × setPageScaleFactor × captureScreenshot 组合会把渲染
  平铺成多份（截图里的「3 列内容」不是真实布局！）。

**v1.5.1**：右栏隐藏被 leftNavDone 记忆化挡住（搜索/个人主页右栏异步渲染，首拍不存在之后永远
漏网，search 页 main 被挤成 38px 竖排）——右栏与内容壳改每拍重查。

**v1.5.2**：首页右缘竖排残留（创作中心/ICP 备案 24px 竖条）→ hideEdgeStrays()：main 内
「宽 8~64、高 ≥300、右半区」块级残留隐藏。⚠️ 首版写 `const SW = SW;`（自引用 TDZ）每次调用抛
ReferenceError 且 node --check 查不出——tick 在此中断后续 pass 全停摆。

**v1.5.3**：新版写想法卡片——快捷入口行 54px 逐字竖排 → fitQuickEntries()（容器 wrap +
项 nowrap 2×2）；「发想法」按钮 x=298 溢出列外 → 按钮壳移到工具栏下方独立行右对齐。

**v1.5.4 首屏闪烁（用户反馈）**：打开页面先显示左栏再隐藏。根因：新版左栏 hash 类名当初认为
「hash 不能写选择器」只靠 JS hideLeftNav（tick 300ms 去抖）——首帧必然先画一次。修法：hash
类名在当前构建内稳定，加进 CSS（document-start 注入先于渲染）首屏直接不画；JS 保留兜底。
验证：150ms 粒度轮询左栏 computed display，首个可测帧即 none。8 页无回归。

**v1.5.5 顶部 tab 消失 + 问题页贴边**：①tab 容器（hash css-1pbgcc2）flex-basis 704px 被
flex-shrink 压成 0 → `.LeanAppHeaderBar div, nav, a { flex-shrink:0 }`，行内容靠壳 overflow-x
横滑；tab 0px → 34px。②问题页元素 x=0 贴边：H1 标题/摘要/写回答/赞同全贴屏幕边——新版问题页
去掉块内边距，v1.2.0 bleedEdges 前提失效 → 恢复 12px 侧边距。

**v1.5.6/1.5.6b**：回答页问题头三按钮与数据重叠（数据窄条压成 0 宽，隐藏条件去宽度下限）；
底部浮动操作栏加 12px 内边距；wrap 条件漏洞（回答页按钮行本身 254px < 列宽，行宽条件永不成立
→ wrap 改无条件写）。

**v1.6.0~1.6.4 留白统一（见 §12）**。

**交互走查（audit-interact）**：首页/问题页评论都是**内联展开**（新版不再是弹层；旧 Modal 逻辑
保留兜底不冲突）；⚠️ 测试基建限制：Input.dispatchMouseEvent/TouchEvent 在 MuMu Kiwi CDP 上
不生效，且知乎 React 按钮对 JS .click() 部分无响应（需真实信任事件）——收起评论/图片查看器等
需真机手动确认。

---

## 12. 留白统一（v1.6.0~1.6.4，记于 v1.5.0 文档附录）

- v1.6.0：normalizePadding()——main 深层壳（:scope 4 层内）padding > 24 压到 12。
  内容 254 → 310~334（每侧留白 24 问题页/12 首页，利用率 87~93%）。保留呼吸感不顶边。
- v1.6.1/1.6.2（用户「首页留白没改、各页要一致」）：:scope 4 层深度限制让首页
  .Topstory-mainColumn 40px 在深层漏网——改全量扫描 main 内所有 div/section/article
  （padding>24 压 12，WeakSet 记忆化对静态 CSS 属性安全）；删 .QuestionPage 12px 叠加层
  （壳统一 12 后再叠就是 24）。全站统一 12px。
- v1.6.3（用户确认）：参照业界统一改 **16px**。判定改「pl≠PAD 且 pl≥12 都重写」——覆盖升级后
  旧版 12px 内联残留。Sticky 操作栏、回答页按钮行同步 16px。内容 12..346（宽 334，93%）。
- v1.6.4 用户视角全流程走查：搜索结果**用户卡片**数据行（120 回答 · 21 文章 · 13 万 关注者）
  竖排——.ContentItem-status 144px flex 行装 5 个子项每项压到 31~49px 逐字竖排 →
  fitUserStats()：容器 wrap+gap、子项 nowrap。
  不修（与官方移动版一致）：评论区无可见关闭按钮（靠系统返回键）。
  遗留可接受：顶部导航右侧热榜词条/搜索框被裁一截（横滑容器初始位置，可滑到）。

---

## 13. v1.0.5 代码审查报告

（原始审查报告未随仓库分发。要点已吸收：H1/H2/H3 性能与健壮性、
M1 `__z2mStop` 半清理、M2/M3 潜在风险、L1~L9 一致性、以及「做得好的 6 条有意设计」清单——
其 L8「ARTIFACTS.md 腐化」结论是 conventions「不建 ARTIFACTS.md」的实证依据。
完整原文在 git 历史（v1.0.5 前后提交）。

---

> 本文件由 17 份散文档合并而成（合并前共 1948 行，合并后去重约省 25%）。
> 原文件在 git 历史（合并提交的父提交）中永久可查。
> **新写设计文档请直接追加到本文件的对应功能域章节**，不要再新建散文件。
