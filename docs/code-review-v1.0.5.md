# 代码与文档审查 · zhihu-desk2mob v1.0.5

审查范围：`src/zhihu-desk2mob.user.js`（467 行）、`docs/` 三份方案文档、`README.md`、
`scripts/` 四个测试 + 工具、技能 `kiwi-violentmonkey-cdp`。
结论优先按严重度排列，每条给定位与依据。**带「实测」的都是真机取证，不是读代码推测。**

---

## 一、值得尽快处理

### H1 · `tick()` 单次 20–44ms，滚动期间约 2.3 次/秒

`tick()` 由 MutationObserver 以 300ms 去抖触发，内部 5 个 pass 里 3 个是全文档扫描。
实测单次耗时与归因（2373 元素的页面）：

| pass | 耗时 |
| --- | --- |
| 只数节点数（不碰样式） | 1.2ms |
| `capFixed` 扫描（遍历 `body *` + 逐元素 getComputedStyle） | **7.9 – 21.2ms** |
| `hideSideRails` 扫描（遍历 `main div` + 逐子元素取 rect） | **7.7 – 11.0ms** |
| `hideIdeaOption` 的 XPath | 3.3 – 7.1ms |
| `capWide` 扫描 | 3.2 – 4.0ms |
| `publishButton` 扫描 | 0.7 – 1.3ms |
| **完整 `tick()`** | **19.8 – 32.8ms**（另一页 35–44ms） |

触发频率也是实测的：空闲页面 **0.2 批/秒**（基本不跑）；**滚动长页面时 2 批/秒**，
即 `tick` 约 **2.3 次/秒**。

合起来：**滚动期间每秒 46–100ms 的主线程开销，且每次都超过一帧（16.7ms）**——
这就是滑动时掉帧的来源。去抖已经把上限锁在 ~3.3 次/秒，所以要治的是「每次太贵」。

建议（按性价比排序）：
1. 给三个扫描加**逐元素记忆化**（`WeakSet` 记已处理过的节点，跳过），首屏之后新节点才付代价。
   注意代价：`capWide`/`capFixed` 依赖「当前尺寸」，记忆化后元素后续变大就不会再被处理 ——
   对 `capFixed` 可接受（fixed 元素集合很小且稳定），对 `capWide` 需要权衡。
2. `capFixed` 改为维护一个「已发现的 fixed 元素」小集合，每拍只复查这些 + 新节点，
   而不是每拍重扫 `body *`。
3. 把这几个「装饰性」pass 移进 `requestIdleCallback`，不要在交互/滚动中抢占主线程。

### H2 · `hideIdeaOption()` 在「页面上没有该文案」时每拍都全量跑 XPath

`src:348-359`：函数只在**找到**目标后才设 `ideaBox` 缓存；找不到就直接 return，
于是下一次 `tick()` 又跑一遍 `//*[contains(., '同时发布到想法')]`。
上面实测这个 XPath 单次 **3.3–7ms**，即「没有发布框的页面」会永远白花这笔钱。

一行前置判断即可（`[contenteditable]` 或 `发布` 按钮不存在时直接返回），
因为该选项只可能出现在发布框里。

### H3 · `applyZoom()` 早退时不会还原已写入的 zoom

`src:46-53`：

```js
const s = (window.visualViewport && visualViewport.scale) || 1;
if (s >= 0.9) return;          // ← 早退，但之前写进 html 的 zoom 留着
```

一旦比例回到 ≥0.9，函数直接返回，而 `document.documentElement` 上那个
（本机实测 `zoom: 3.83256`）不会被清掉 —— 页面会保持 3.8 倍放大、按桌面宽度排版。
触发条件是「反缩放之后 visualViewport.scale 变大」（如用户双指缩放）。

**这条我没能在真机上证实可达**（`visualViewport.scale` 只读、无法伪造），
属代码审读结论：机制确定，可达性待验。修法是一行——
`else document.documentElement.style.removeProperty('zoom')`。

---

## 二、结构性问题

### M1 · `__z2mStop()` 是「半清理」，导致以它为基准的诊断结论不可靠

实测调用 `__z2mStop()` 之后：

```
z2m-style: 已移除          htmlZoom: "3.83256"（未还原）
206 个元素仍带内联样式      7 个仍带 display:none
发布框头像仍带 width:24px !important; height:24px !important
```

它只做了「摘样式表 + 断开观察器 + 清定时器」，**没有撤销任何 pass 写下的内联样式，
也没有还原 zoom**。影响两处：

- **H3 之外**：谁把它当「关掉脚本」用，页面会处于「桌面布局 + 4 倍放大」的坏状态。
- **诊断结论**：`scripts/probe-publishbtn.js --off` 就是拿它当「无脚本 CSS」基线的，
  那组数据（视口 269、按钮完全出屏）**不是有效的无脚本对照**。
  该次结论没有依赖它们（「不是本次改动引入」是靠同一轮内的改前/改后对照得出的），
  但工具本身的方法不成立，`ARTIFACTS.md` 里对它的描述（「判定按钮越界是否由脚本造成」）
  夸大了它能做到的事。

建议二选一：补全还原逻辑；或保留半清理但在工具与文档里写明「只停 CSS，不停 JS 改动」。

### M2 · `matchComposerAvatar` / `fitPublishButton` 的祖先查找没有上界

`src:426-431` 与 `src:396-404` 都是

```js
while (row && row !== document.body) { ... row = row.parentElement; }
```

正常情况下实测 **3 层即止**，且停下的那一层同时含 `[contenteditable]`
（实测 `{"depth":3,"rowCls":"css-1fo89v5","rowHoldsEditor":true}`），所以现在不会错。
但一旦发布框那一行没有头像（或没有可收缩的首个子元素），循环会一路向上，
命中的可能是页面里**无关的**头像/容器 —— 把作者头像改成 24px 这类后果。

我尝试构造该场景来验证，但探针没能让发布框渲染出「发布」按钮，**未能证实**，
因此按「潜在风险」记，不夸大。低成本的加固：把停止条件从「这一层含头像」改成
「这一层同时含 `[contenteditable]`」，语义正好是「发布框那一行」。

### M3 · 横竖屏切换后 JS 阈值会过期

`src:452-454` 的 resize 处理只更新 CSS 变量 `--z2m-w`，而 `SW`（`src:19`）是常量，
`capFixed` / `capWide` / `fitPublishButton` 一直用初始值。切到横屏后，
「宽于 SW+2 才收窄」的判断用的是竖屏宽度。

### M4 · `hideSideRails()` 的启发式可能误隐藏合法第二栏

`src:158-170`：非首个子元素、宽 80–420、高 ≥300 就 `display:none`。
这是纯几何启发式，知乎若出现「两栏都在 80–420 宽」的版式，会把正文栏一起隐藏。
建议收窄（例如再要求它贴近视口右侧）或加白名单。

---

## 三、一致性与整洁（都不影响功能）

| 编号 | 位置 | 问题 |
| --- | --- | --- |
| L1 | `src:342-343` | 注释写「13×155」「从 122px 撑到 219px」，而 `docs/v1.0.4` 与 `src:381` 写「13×121」「94 → 185」——同一份代码里两套数字，应统一 |
| L2 | `docs/v1.0.5:29,42` | 把「8 个头像高度塌成 0」写成普遍结论；实测是 **3**（回答页）到 **8**（专栏页），随已渲染头像数变化，应写区间 |
| L3 | `docs/v1.0.4` 标题 | 标题写「撑到 219px」，正文表格写「185 ~ 219px」，口径不一 |
| L4 | 技能 `SKILL.md:58` | 「`dialog.js` 里踩过一次」引用了**未随技能分发**的文件（实际在 `_tmp/probes/`）——读者找不到。改为不点名，或把该脚本一并放进技能 |
| L5 | `src:11` | `// zhihu2mob adaptation payload v1 — becomes the userscript body.` 是早期脚手架残留，语义不明，建议删 |
| L6 | `src:85` / `src:104` | `header div { min-width: 0 !important }` 出现两次，前者被后者包含，冗余 |
| L7 | 测试 | `test-comment-back` 的 `cardMaxW`、`test-idea-option` 的 `editableFocused` 只采集不断言；`histLen` 只打印（有意不用于断言，但字段可去掉） |
| L8 | `ARTIFACTS.md` 目录结构 | 未更新：缺 `_tmp/release/`、`_tmp/skills-backup/`，`_tmp/probes/` 也多了本轮脚本 |
| L9 | `src:1-10` | 未设 `@downloadURL` / `@updateURL`：从 Release 附件安装的人收不到更新（从 raw 装的正常） |

---

## 四、做得好的地方（这些是有意设计，别在后续改动里破坏）

1. **越界前置判断**：`fixCommentModal`（卡片比容器大才动）、`fitPublishButton`（行溢出才动）、
   `matchComposerAvatar`（仅窄列）——三处都先比较尺寸再决定，不越界不改。这是它没有
   把正常弹窗/布局弄坏的原因。
2. **节点缓存 + `isConnected` 失效重找**：每个 pass 都缓存已处理节点，SPA 重建后自愈。
3. **哨兵历史撤回前校验 `history.state`**（`src:290-291`）：避免把用户在弹层里的导航撤销掉。
4. **定位一律避开 emotion hash**：按文案（XPath）、按结构（溢出 + 首子元素占比）、
   按通用类（`Avatar`）——hash 会随构建变化，这一条被反复验证有价值。
5. **测试不依赖环境**：各自开新标签页、自己把发布框调出来（滚到位 → 聚焦 → 必要时开弹层），
   且断言放在 `history.state` 标记上而非 `history.length`。
6. **文档记录「反直觉的结论」**：v1.0.5 明确写出「这两处都是脚本自己的通用规则误伤」，
   而不是只记修了什么。这类信息比结论本身更省后来人的时间。

---

## 五、建议的处理顺序

1. **H2**（一行前置判断）→ **H1**（记忆化 + idle 回调）→ **H3**（一行 else 分支）
2. M1 若保留半清理，至少在 `ARTIFACTS.md` 与 `probe-publishbtn.js` 头部标注其局限
3. M2 / M3 属加固，可随下一次功能改动一起做
4. L1–L9 是一次性清理，适合单独一个「docs/consistency」提交

> 本轮只做审查、未改动任何文件；需要我着手修哪些，说一声即可。
