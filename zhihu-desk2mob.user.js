// ==UserScript==
// @name         知乎桌面版·手机单列适配 (Zhihu Desktop for Mobile)
// @namespace    zhihu2mob
// @version      1.4.4
// @description  在 Kiwi/Chrome「桌面版网站」模式下，把知乎桌面版重排为手机单列、正常字号。适配首页/问答/专栏，评论可正常展开收起；评论弹层支持返回键关闭，并修正其顶部不可达/右侧裁切（且**不再能被横向滑动推走**）；发布框去掉会撑高布局的「同时发布到想法」、按钮与头像尺寸归一；清掉右边缘残留的侧栏/页脚（帮助中心、举报中心、关于知乎等）；限制双指缩小——内容不会被缩到小于「恰好铺满」，不会变成半屏小字；正文字号按「屏上换算因子」微调（1.00，靠收窄列宽实现，不改 font-size）；**块状版式去掉内容列两侧的灰色留白，让块铺满整列（块与块之间的灰色间隔保留）**；隐藏首页「写想法」卡片里塌成竖排的「同步到圈子」、并把「发想法」按钮收进屏幕内完整可见；首页信息流的封面缩略图按正文行数定尺寸（默认 3 行，宽 190 → 152px），上下与文字精确对齐，正文在封面右侧与**下方**环绕（不再是窄列）；**卡片底部的「赞同 / 评论 / 收藏 …」操作栏在窄列里自动换行，右侧那几个按钮不再被屏幕裁掉（此前「赞同 7435 / 269 条评论 / 327 / 137 / 分享」只露到 327）**；问题页滚动后的吸顶标题栏里，「标题」与「关注问题」按钮压成一行（都缩小、标题左移，可见字数从 6.8 字提到 8.6 字）。提示：需配合浏览器「请求桌面版网站」开关使用；未开桌面模式时脚本自动不生效。
// @match        https://www.zhihu.com/*
// @match        https://zhuanlan.zhihu.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/leoshone/zhihu-desk2mob/main/zhihu-desk2mob.user.js
// @downloadURL  https://raw.githubusercontent.com/leoshone/zhihu-desk2mob/main/zhihu-desk2mob.user.js
// ==/UserScript==
(function () {
  'use strict';
  // Only adapt when Zhihu served its DESKTOP layout (Kiwi "桌面版网站" ON).
  // In real mobile mode innerWidth ≈ 393 and the page is already fine.
  if ((window.innerWidth || 0) <= 600) return;
  if (window.__z2mStop) { try { window.__z2mStop(); } catch (e) {} }

  // 窄列宽度（CSS px）。**屏幕上的实际大小 = 名义字号 × (屏幕可用宽 ÷ SW)** ——
  // 列越窄，同一个字号在屏上就越大，而列**仍然恰好铺满屏幕**（zoom = visW / SW 会同比变大，
  // 列宽 × zoom × scale 恒等于屏幕可用宽）。所以「让正文大一点」= **收窄列宽 + 放大缩放**，
  // 而不是把 zoom 单独调大（那会让内容宽于屏幕、被 overflow-x 裁掉右边）。
  // CFG.textScale 就是要的那个「屏上换算因子」：1 = 字号就是名义值（正文 16px）。
  // 会随屏幕旋转变化，故不是常量 —— resize 时重算（消费它的阈值也跟着变）。
  const SW_MIN = 240;                                    // 再窄排版就难看了
  let SW_BASE = Math.max(320, Math.min(screen.width || 393, 500));
  let SW = SW_BASE;                                      // 初值；进入 applyZoom 后用真实可用宽校准

  // ============================================================
  // 配置开关
  // ============================================================
  const CFG = {
    // 块状版式：去掉内容列**两侧**的灰色留白，让「块」铺满整列；**块与块之间的灰色间隔保留**
    // （间隔来自卡片自己的 margin-bottom，只改横向不会碰到它）。
    // 留白 = 本脚本 `.App-main` 的 10px + 知乎最外层容器的 16px。详见 docs/v1.2.0-full-bleed.md。
    bleedEdges: true,
    // 屏上换算因子：正文在屏幕上多大 = 名义字号 × 它。
    // 1 = 字号就是名义值（正文 16px）；0.98 = 15.7px。
    // 历次定值：0.90976（v1.0.9 铺满原始大小，14.6px）→ 0.98（v1.1.1，按真机捏合
    // 量出的 0.97998）→ **1.00（当前）**——用户 2026-09-30 决定取整到 1.00，即回到名义字号。
    // **靠收窄列宽实现，不改任何 font-size**：列窄了 zoom 就同比变大，列仍恰好铺满屏幕。
    textScale: 1.0,
    // 反缩放：限制「手工缩小」——捏合缩到小于「恰好铺满」时拉回铺满，
    // 不允许把页面缩成半屏小字（用户要求）。只挡缩小，放大不受影响。
    limitZoomOut: true,
    // 评论弹层：点开时压入一条哨兵历史，返回键（手势/按钮）关闭弹层
    commentBack: true,
    // 评论弹层：修正定位（卡片顶部对齐 + 宽度收进屏幕）
    fixCommentLayout: true,
    // 评论区发布框：隐藏「同时发布到想法」选项（radio 图标 + 文案）
    hideIdeaOption: true,
    // 首页「写想法」卡片：隐藏塌成 0 宽的竖排「同步到圈子」残留（它是「发到圈子」的开关；
    // 用户 2026-09-30 明确要求去掉 —— 原为「已知未修」第 2 条，本次给了结论）
    hideCircleSync: true,
    // 首页「写想法」卡片：把「发想法」按钮收进屏幕内（知乎给它写死了 75px 宽度 + 20px 左外边距）
    fitIdeaButton: true,
    // 首页信息流：封面缩略图**按正文行数定高**（宽度按原始比例跟随）。
    // 可填 0 / 2 / 3 / 4：0 表示不干预（保持知乎原来的 190x105）。
    // 为什么用「行数」而不是「宽度」：图片顶/底能正好落在正文的行边界上，绕排看起来整齐
    // （原来给 100px 宽时高度是 55px ≈ 1.97 行，差一点点，且顶边比文字视觉顶高 6px）。
    // 实测（正文行高 28px）：3 行 ⇒ 图片 152x84、图片右侧文字可用宽 174px；
    //                          2 行 ⇒ 图片 101x56、可用宽 225px（≈ 旧的 100px 宽那一档）。
    feedThumbLines: 3,
    // 首页信息流：让正文在封面**下方**也回到全宽（真正的「右+下」环绕）。
    // 知乎的 `.RichContent-inner` 是 `overflow: hidden` —— 那会形成 **BFC**，而 BFC 会被整体
    // 挤到浮动元素旁边、**永远不会在浮动下方回宽**，于是文字只绕右侧、一路都是窄列。
    // 解开它（overflow: visible）即得到「右 + 下」环绕。设 false 则只绕右侧。
    wrapAroundThumb: true,
    // 评论区发布框：让「发布」按钮完整落在屏幕内（该行内容原本比列宽多 79px）
    fitPublishButton: true,
    // 评论区发布框：把里面的头像缩到与评论列表头像同尺寸（知乎原本给 40px）
    matchComposerAvatar: true,
    composerAvatarSize: 24,
  };

  // ---- viewport meta ----
  let vp = document.querySelector('meta[name="viewport"]');
  if (!vp) { vp = document.createElement('meta'); vp.name = 'viewport'; (document.head || document.documentElement).appendChild(vp); }
  vp.setAttribute('content', 'width=device-width, initial-scale=1');

  // ---- counter-zoom ----
  // 桌面模式把布局视口锁在 ~1430px 再整体缩小，不反缩放则文字小到看不清。
  // 目标是**让 SW 宽的列恰好铺满可见范围**，而不是取 1/scale。
  //
  // 两者差的正是「打开后被放大一点点」那个现象。实测：
  //   · 屏幕可用 CSS 宽度 = 357.5（1080 ÷ dpr 3.0235）
  //   · 而 SW 来自 screen.width = 393  →  393 / 357.5 = 1.099
  // 用 1/scale 得到的是「正好铺满 393 的屏幕」，实际屏幕只有 357.5 →
  // 内容就大 10%，用户看到的就是「像被双指放大了一点点，得捏合缩回」。
  //
  // 换成 vvWidth/SW 还带来一个关键性质：屏幕上的实际尺寸
  //   = SW × Z × scale × dpr = SW × (vvWidth/SW) × scale × dpr
  //   = vvWidth × scale × dpr = 屏幕宽度（恒定）
  // 所以加载期间布局视口一路变化（实测 980→1077→1184→1301）、我们反复重算 Z，
  // **视觉上都不会有任何变化** —— 不会出现「先放大再缩小」的跳动。
  // 用「实际可用宽」反推列宽，而不是用 screen.width —— 两者差约 10%（393 vs 357.5），
  // 以前 SW 取 393 时恒偏小 10%，这正是正文看着比名义字号小一号的原因。
  // 这样屏上换算因子恒等于 CFG.textScale：
  //   屏上字号 = 名义 × (列宽 × zoom × scale) / 列宽 = 名义 × 屏幕可用宽 / SW = 名义 × textScale
  let curZ = 1, curScreenW = 0;
  function applyZoom() {
    const vv = window.visualViewport;
    const visW = vv ? vv.width : window.innerWidth;   // 可见范围内的布局 px
    const s = (vv && vv.scale) || 1;
    curScreenW = Math.round(visW * s);                // 屏幕可用 CSS 宽度（用户捏合时不变量）
    const wantSW = Math.max(SW_MIN, Math.round(curScreenW / CFG.textScale));
    if (Math.abs(wantSW - SW) >= 1) {
      SW = wantSW;
      document.documentElement.style.setProperty('--z2m-w', SW + 'px');
      // 注意：这里**不能**直接 clearScanMemo() —— 它依赖的 seenFixed 等是后面用 let 声明的，
      // 而 applyZoom 在初始化早期就会执行 → 撞上 TDZ，整个 IIFE 抛错、脚本彻底不生效
      // （症状是页面上没有任何脚本痕迹）。改由 tick() 发现 SW 变了再清（见那里）。
    }
    const Z = Math.min(6, Math.max(0.5, visW / SW));
    if (Math.abs(Z - curZ) < 0.005) return;
    curZ = Z;
    document.documentElement.style.setProperty('zoom', String(Z));
  }
  applyZoom();
  [300, 1000, 2500].forEach(t => setTimeout(applyZoom, t));   // 布局视口落定前多算几次
  window.addEventListener('resize', applyZoom);
  // 缩放变化时按三种情形分别处理 —— 真机上那种「时灵时不灵」就是这里没分清：
  //   ① 捏合**放大**（scale↑、vvWidth↓）：视觉尺寸大于「恰好铺满」→ 不干预，保留放大。
  //   ② 捏合**缩小**（scale↓、vvWidth↑）：视觉尺寸会小于「恰好铺满」—— 真机实测最小能缩到
  //      只占屏宽 49%（半屏小字）。用户要求「限制手工缩到很小」，故此处拉回铺满。
  //      判据：铺满时的视觉尺寸 = curScreenW / SW（把 Z = visW / SW 代进 Z×scale 即得，与 scale 无关）；
  //      当前视觉尺寸 = zoom × scale。小于它就说明缩过头了。
  //   ③ 浏览器自己改 dpr / 视口：屏幕可用宽度（vvWidth × scale）会变 → 必须重算。
  // 注：捏合本来就不改这个乘积，所以老代码只在「乘积变了」时重算 —— 结果是「缩过头」没人管，
  // 且「有时被重算、有时不」取决于 window.resize 是否恰好触发，表现不稳定。
  //
  // 「拉回铺满」必须**延后一拍**再算，不能就地算：浏览器换挡时可能先经过一个中间态 ——
  // 实测 setPageScaleFactor 会先来一发 `visW = innerWidth`（最小比例）的事件。就地重算会按
  // 中间态得出过大的 zoom，紧接着真正的那一发到来时 `zoom × scale` 已大于铺满值
  // → 被当成「用户放大」而不纠正 → 内容比屏幕宽、右侧被裁（见 docs/v1.1.1-text-scale.md §3）。
  // 延后 200ms 只缓解、不能根治；根治需要区分「用户主动放大」与「浏览器换挡的中间态」，
  // 而两者的可观测状态完全相同 —— 试过两种改法（延后 / 再等一拍）都无效，已回退，故保持简单。
  let zoomFixTimer = null;
  function refitSoon() {
    clearTimeout(zoomFixTimer);
    zoomFixTimer = setTimeout(applyZoom, 200);
  }
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => {
    const vv = window.visualViewport;
    const fillVisual = curScreenW / SW;                       // 「恰好铺满」时的视觉尺寸
    const zNow = parseFloat(document.documentElement.style.zoom) || 1;
    if (CFG.limitZoomOut && curScreenW > 0 && zNow * vv.scale < fillVisual - 0.02) { refitSoon(); return; }
    if (Math.abs(Math.round(vv.width * vv.scale) - curScreenW) <= 2) return;
    applyZoom();
  });

  // ---- CSS ----
  const st = document.createElement('style');
  st.id = 'z2m-style';
  st.textContent = `
  :root { --z2m-w: ${SW}px; }
  html, body {
    width: var(--z2m-w) !important;
    max-width: var(--z2m-w) !important;
    overflow-x: hidden !important;
  }
  /* 正文图片不得撑破窄列。刻意排除 .Avatar：头像在知乎是「固定尺寸的 UI 元素」，
     给它 height:auto 会顶掉知乎写死的高度，而头像所在行又是 stretch（align-items:normal），
     结果被拉到整行高（实测发布框头像 40×40 被拉成 40×122，另有几个头像被压成 24×0）。
     其余图片保持原规则 —— 站点写了宽高比的内容图靠 height:auto 才不会在 max-width 收窄后变形。 */
  img:not(.Avatar), video { max-width: 100% !important; height: auto !important; }
  pre { max-width: 100% !important; overflow-x: auto !important; }
  table { max-width: 100% !important; }

  /* top header: static, full width, inner scrolls horizontally if needed */
  .AppHeader {
    position: static !important;
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    height: auto !important;
  }
  .AppHeader ~ div[style], .AppHeader + div { height: auto !important; }
  .AppHeader-inner, .AppHeader-Tabs, .AppHeader-profile, .AppHeader-searchBar {
    max-width: 100% !important; min-width: 0 !important; width: auto !important;
  }

  /* main containers */
  main, .App-main, .Topstory, .Topstory-container, .Topstory-main,
  .QuestionPage, .QuestionHeader-main, .QuestionAnswers-answers, .ListShortcut,
  .Post-content, .Post-Sub, .Recommendations-Main, .Recommendations-List,
  .Card, .ContentItem, .RichContent, .ContentItem-text, .RichText,
  .Comments-container, .List-item {
    width: auto !important;
    max-width: 100% !important;
    min-width: 0 !important;
  }
  /* ---- 块状版式（CFG.bleedEdges）：去掉内容列**两侧**的灰色留白，让「块」铺满整列 ----
     留白 = 本脚本 .App-main 的 10px + 知乎最外层容器的 16px（首页是 .Topstory-container；
     专栏/问答那个容器是 emotion hash，改用「稳定父类 > div」的结构选择器绕开）。
     实测（列宽 358）：首页块 26..332 → **0..358**；专栏 10..348 → **0..358**；问答 → **0..358**。
     ⚠️ 只动横向：块间竖直灰缝来自卡片自己的 margin-bottom，不受影响 —— 这正是需求要保留的。
     ⚠️ 块**自带**内边距（首页 16px / 专栏 20px / 问答 22px），所以文字仍有呼吸感，
        **不需要**再补内边距。关掉本开关则退回原来的两侧 10px 留白。 */
  ${CFG.bleedEdges ? `
  .App-main { padding-left: 0 !important; padding-right: 0 !important; }
  .Topstory-container, .Post-content > div, .QuestionPage > div {
    padding-left: 0 !important; padding-right: 0 !important;
  }
  .Topstory-mainColumn { margin-left: 0 !important; margin-right: 0 !important; }
  ` : `
  .App-main { padding-left: 10px !important; padding-right: 10px !important; }
  `}

  /* kill Zhihu's hard min-widths inside content (min-width beats max-width) */
  main div, main section, main article, main ul, main ol, main li,
  main table, main figure, main p, header div {
    min-width: 0 !important;
    max-width: 100% !important;
  }

  /* ---- 首屏就藏掉侧栏，避免「先显示再消失」的闪烁 ----
     原先只在 JS 的 hideSideRails() 里隐藏，而它跑在 tick 里（300ms 去抖 + 等 DOM 就绪），
     所以首屏**必然先画出来一次** —— 用户会看到右侧栏（大家都在搜 / 关于作者…）先占位再消失。
     样式表是在 document-start 注入的，把**类名可判定**的这部分挪到 CSS，首屏直接不画。
     JS 那一步保留：用来兜住动态插入、或没有这些类名的其它栏。
     注：display:none 只是不渲染，网络请求仍会发出（要彻底不拉需要阻断请求，本脚本不做）。 */
  .GlobalSideBar, .Question-sideColumn, [class*="SideBar"] { display: none !important; }
  /* 专栏页的右侧栏内容：知乎把「关于作者 / 大家都在搜」这两张卡片放在文章的右栏，
     窄屏下会流到正文下方（实测 62..358）——用户要求与侧栏一样去掉。类名稳定、无副作用。
     ⚠️ 不要顺手隐藏其它塌陷盒子：专栏页左边缘那条「逐字竖排」的是**文章标题**
        被塞进了 0 宽盒子，隐藏它会直接丢掉标题，那是另一个问题（需要修宽度，不是隐藏）。 */
  .AuthorCard, .HotSearchCard { display: none !important; }
  /* ---- 专栏页：正文被「同行的右栏」挤塌（长期缺陷，v1.0.9 起就有）----
     实测：正文与右栏同处一个 flex 行（行宽 373px），右栏 css-1ni4jcm 占 296px，
     正文那一列只剩 35px，再被压成 0 ⇒ 标题/正文逐字竖排、页面左边缘一条竖条。
     知乎这两栏是「正文在前、右栏在后」（脚本的 hideSideRails 也是按这个假设写的），
     所以直接隐藏该行里「第一个子项之后」的所有兄弟。实测正文 0 -> 301px ✓。
     注：只作用在 .Post-content 下（专栏页专属），首页/问答页不受影响。 */
  .Post-content > div > *:not(:first-child) { display: none !important; }

  /* ---- 顶部「关注者 N / 被浏览 N」：改成横向排列、左对齐 ----
     实测知乎给这一栏（.NumberBoard）带了 margin-left: 158.001px（桌面端居中留白），
     窄屏下整排被推到右边、左侧空一大块（用户反馈「关注者左侧比较空」）；
     而且「关注者」那一格被压到 58px 宽，名称和数值挤成两行。
     清掉左边距改成 flex-start 后：栏 158..358 -> 0..358，两格都在同一行（H 51 -> 29）✓ */
  .NumberBoard {
    display: flex !important; flex-wrap: wrap !important;
    justify-content: flex-start !important; align-items: center !important;
    column-gap: 14px !important; width: auto !important;
    /* 缩进要和正文一致（实测正文 L=20）。v1.3.9 里写成 0 会顶到屏幕左缘。 */
    margin-left: 20px !important; margin-right: 0 !important;
  }
  .NumberBoard-item { width: auto !important; max-width: none !important; min-width: 0 !important; flex: 0 0 auto !important; }
  .NumberBoard-itemInner { display: flex !important; flex-wrap: nowrap !important; align-items: baseline !important; column-gap: 4px !important; }
  .NumberBoard-itemName, .NumberBoard-itemValue { width: auto !important; white-space: nowrap !important; }
  /* ---- 卡片里的「赞同」操作栏（.ContentItem-actions）整排右出界 ----
     知乎这一排是 display:flex + flex-wrap:nowrap，子项**全部 flex:0 0 auto**（谁也不收缩）。
     桌面列宽 700+ 时刚好排成一行；脚本把列宽压到 358 后，实测内容 565~642px
     ⇒ 右侧约 3 个按钮被屏幕切掉（且 overflow 是 visible：是**裁掉**，滚不到也点不到）。
     实测（用户 2026-09-30 反馈）范围：回答页 3~5 处、关注页 20 处、首页 12 处。
     ⚠️ **这条规则 v1.0.0 起就一直在**（原样就是 flex-wrap: wrap + row-gap: 4px），
        但在 **v1.3.9 被误删**：那一版的主题是「顶部关注者 / 被浏览 横向排列」，
        .NumberBoard 的新规则正好插在它原来的位置上，把这条一起删掉了
        （commit 0ce4f3b 的 diff 里就是 - 一行旧规则 / + 一段新规则）。
        而 v1.3.10 写 .Sticky 注释时**以为它还在** —— 那句「脚本里那条通用的
        .ContentItem-actions { flex-wrap: wrap } 优先级不够」就是这么来的；
        错误注释 + 规则缺失一路带到 v1.3.11：除吸底的 .Sticky 外，首页 / 问答 / 专栏的
        赞同栏都不再换行 ⇒ 右侧按钮被裁。**本版（v1.4.0）按 v1.3.8 的原样恢复（含 row-gap: 4px）。**
     ⚠️ 恢复时**只还原这一条，别顺手改间距或外边距**（v1.4.0 初稿试过，被用户否掉）：
        初版额外把子项 margin-left 归零、容器加 column-gap: 16px，还把容器自身的
        margin: 0 -20px「出血」归零 —— 结果操作栏**左端从贴着卡片边缩进到正文列**
        （实测落点 [-4, 362, 366] → [16, 342, 326]），用户反馈「你把按钮区往中间靠了，
        要保持在左侧的位置」。间距与出血都按知乎原样，一字不动。 */
  .ContentItem-actions { flex-wrap: wrap !important; row-gap: 4px !important; }

  /* ---- 回答页底部的浮动操作栏（知乎的 .ContentItem-actions.Sticky）补成满宽 ----
     知乎给它 right: 40px 的桌面留白（实测 left:0 / right:39.9969px => 栏宽 318，而列宽 358），
     在手机上右侧就空出 40px；用户反馈「滚动后右侧空一块，想保持撑满」。
     改 left:0 + right:auto + width:var(--z2m-w) 后实测栏宽 0..358 ✓（按钮行数还从 4 行降到 3 行）。 */
  .ContentItem-actions.Sticky {
    /* 用户要求**横向铺满**：left/right 都归 0（不跟正文缩进）。
       不溢出的保证来自下面的 flex-wrap: wrap —— 按钮会在 0..358 里自己折行。 */
    left: 0 !important; right: 0 !important;
    width: auto !important; max-width: none !important;
    /* ⚠️ 关键：知乎给 Sticky 这一栏用的是 flex-wrap: nowrap，栏内按钮会一路排到屏幕外
       （实测 7 个按钮最右到 612px，屏幕只有 358 ⇒ 右侧被裁、点不到）。
       这里用两个类的选择器 + !important 明确允许换行。
       ⚠️ 本段旧注释写着「脚本里那条通用的 .ContentItem-actions { flex-wrap: wrap } 优先级不够」
          —— 这句是**错的**：那条通用规则早在 **v1.3.9 就被误删**（见上方注释与 commit 0ce4f3b），
          当时全文件并没有它。这句注释把「卡片内联操作栏右侧被裁」误导成「已经处理过」，
          一路拖到 v1.4.0 才被发现。现已在上方恢复通用规则；
          这里仍保留两个类的写法，只为让 Sticky 的定位修正与换行各管各的。 */
    flex-wrap: wrap !important;
  }

  /* buttons: never squeeze into vertical text
     注意 .Modal-content 也要带上：弹层挂在 body 的 portal 里、**不在 main 内**，
     只写 main 会漏掉它 —— 实测弹层内「发布」按钮因此被压成 49×58 的竖排「发/布」。
     这里只加 nowrap，不加 flex:0 0 auto（后者会让按钮拒绝收缩、把行撑溢出）。 */
  main button, header button, .Modal-content button { white-space: nowrap !important; }
  main button { flex: 0 0 auto !important; }

  /* question header: let stats column wrap below instead of overflowing */
  .QuestionHeader, div[class*="QuestionHeader"] { flex-wrap: wrap !important; }
  .QuestionHeader div, [class*="QuestionHeader"] div { flex-wrap: wrap !important; }
  .QuestionHeader-side { width: auto !important; max-width: 100% !important; }

  /* ---- 页面里的「问题头」：标题与问题描述右侧贴边（知乎只给了左内边距） ----
     实测（列宽 358）：.QuestionHeader-main 的 padding 是 **0 0 0 20px** —— 左 20、**右 0**，
     于是它里面的标签 / 标题 / 问题描述一律从 20 一直排到 **358**（屏幕右缘），
     比正文列（20..338，左右各 20px）多出 20px，右边完全没有留白（用户 2026-10-01 反馈）。
     补上对称的 padding-right 即可 —— 一处同时解决标签、标题、描述（三者都在这层内）。
     ⚠️ 吸顶迷你头里也有 .QuestionHeader-main，但它有自己的几何约束（见上面的 .PageHeader 段），
        必须把 padding-right 保持为 0，否则标题可用宽度会少 20px；所以下面那条用更高特异性覆盖回去。 */
  .QuestionHeader-main { padding-right: 20px !important; }
  /* 问题页页首：把「关注问题 / 写回答 / 邀请回答」排成一行并**均匀分布**。
     知乎的层级（实测）：
       .QuestionHeader-footer-inner
         └ .QuestionHeader-footer-main      ← 真正的「按钮行」：flex + wrap + 20px 左内边距
             ├ .QuestionButtonGroup          （关注问题 + 写回答）
             └ .QuestionHeaderActions        （邀请回答 + 好问题 + 评论 + 分享）
     ⚠️ 类名是 **QuestionHeader-footer-main**，不是 QuestionHeader-footer —— 只改外层的
        .QuestionHeader-footer-inner 不够，必须打到这一层才是按钮行。
     两步：
       ① 两个排布壳都 display: contents **解散**，按钮才能成为同一行的直接子项；
       ② 清掉按钮自带的左右 8px 外边距 —— 尤其 **.QuestionButtonGroup 还带 -8px 右外边距**，
          会把「邀请回答」拉到贴着「写回答」（实测间距 [16, 0]），这就是「右边两个挤在一起」的由来。
          改用容器 column-gap + space-between 均匀分布。
     实测（列宽 358）：三个按钮 0..96 / 124..220 / 247..358，间距 **28 / 27**，**左空 0、右空 0**。
     回归：scripts/test-question-actions.js */
  .QuestionHeader-footer-inner {
    flex-direction: row !important; flex-wrap: wrap !important; align-items: flex-start !important;
    padding: 0 !important; margin-right: 0 !important;
  }
  .QuestionHeader-footer-main {
    display: flex !important; flex-direction: row !important; flex-wrap: wrap !important;
    /* align-items 保持 flex-start：**不要**改成 center。用户只是让「文字按钮往下一点」，
       并不想改宽屏（横屏）下单行的垂直关系（2026-09-30 明确纠正过一次）。
       row-gap: 10px —— 竖屏下两行只有 2px 太挤，这条才是「往下一点」的实现。 */
    align-items: flex-start !important; justify-content: space-between !important;
    column-gap: 10px !important; row-gap: 10px !important;
    /* 两侧留白要对齐**正文文字区**（实测 .AnswerItem / .RichText 是 20..338，左右各 20px）。
       ⚠️ 不能写成 padding: 0 —— 那样按钮会顶到屏幕边缘（用户 2026-09-30 反馈）。
       留白取 20px 后可用宽只剩 318，而三个按钮原样占 303 + 两处 10px 间隙 = 323 > 318 ⇒ 会换行；
       所以同时把按钮自带的左右 16px 内边距收到 13px（每个各窄 6px，合计省下 18px），
       实测宽度 96/90/105 = 291，放得下且间距 14/13 均匀。 */
    padding-left: 20px !important; padding-right: 20px !important;
  }
  .QuestionButtonGroup, .QuestionHeaderActions { display: contents !important; }
  /* ⚠️ 选择器**只能管这三个主按钮**：写 .QuestionButtonGroup / .QuestionHeaderActions 的 > button。
     ⚠️ 不要写成 .QuestionHeader-footer-main button（后代选择器）—— 那会把下面的**纯文字按钮**
        「好问题 / 评论 / 分享」也各撑宽 26px（它们原本几乎没有内边距），
        结果那一行放不下、被挤成两行（用户 2026-09-30 反馈；实测 112+109 占掉大半，4 项共 339 > 可用 318）。
     ⚠️ 也不能写成 .QuestionHeader-footer-main > button —— display: contents 只改**盒树**，
        DOM 上按钮仍属于原来的壳，所以 CSS 的 > 选不中（实测无效）。
     ⚠️ 这段是 JS 模板串，注释里**不能出现反引号**，否则模板串会被提前闭合（本项目踩过两次）。 */
  .QuestionButtonGroup > button, .QuestionHeaderActions > button {
    margin-left: 0 !important; margin-right: 0 !important;
    padding-left: 13px !important; padding-right: 13px !important;
  }
  /* 下面那批**纯文字按钮**（好问题 / 评论 / 分享 / …）以及它们各自的壳：也清掉自带边距。
     知乎在这一带塞了一堆 20px 的 margin-left / margin-right（按钮自身 + 外层壳各有一份），
     实测 4 项**含边距共 326px > 可用 318px**，于是最后那个 17px 的「…」被挤到第 3 行
     （用户 2026-09-30 反馈「4 个文字按钮变成两行」）。间距改由容器的 column-gap 统一负责。 */
  .QuestionButtonGroup button, .QuestionHeaderActions button,
  .QuestionHeaderActions > * { margin-left: 0 !important; margin-right: 0 !important; }
  /* 页首还有一个宽 0 的壳 .QuestionHeader-actions（小写 actions，与上面的 .QuestionHeaderActions
     不是一个）。它虽然是 0 宽，但**也是一个 flex 项**，会被 space-between 顶到最右边，
     于是 4 个文字按钮全挤在左边、「…」的右端距正文右界差一大截。
     ⚠️ 只对**确实为空**的它生效（实测 0 个子元素、innerHTML 为空）—— 用 :empty 限定才安全，
        无条件隐藏/解散它曾把页面横向撑爆过（v1.3.2 的回归，v1.3.3 已回滚）。 */
  .QuestionHeader-actions:empty { display: none !important; }

  /* ---- 问题页「吸顶迷你头」：把标题与「关注问题」压成一行 ----
     滚动后知乎会把标题收进顶部那条 188px 宽的吸顶栏（.PageHeader，左右被 logo 与头像各占 85px），
     栏内 .QuestionHeader-content 是 flex-wrap: wrap ⇒「长标题 + 96px 的关注问题按钮」必然折成两行
     （实测吸顶栏高 62px = 标题行 28 + 按钮行 34）。用户 2026-09-30 要求压成一行、并把两者都缩小。
     硬约束：标题不换行时自然宽 **380px**（20px 字号），而可用内容宽只有 156px
     ⇒ 并排就必然要截断标题，且**按钮占多少宽度，标题就少多少字**。实测三组：
       · 强行一行、按钮不缩          ⇒ 标题 48px ≈ 3.4 字（比改之前还少）✗
       · 两行 + 都缩小               ⇒ 标题 164px ≈ 10.9 字（可读性最好，但不是一行）
       · 一行 + 缩小 + 左移 + 让无关按钮让位 ⇒ 标题 112px ≈ 8.6 字 ✓（本版采用）
     三处关键，缺一条标题就少约 2 个字：
       ① 覆盖 .FollowButton 写死的 min-width: 96px（不覆盖的话字号/内边距再怎么小，按钮仍是 96px）；
       ② 清掉左内边距（content 的 16px + main 的 20px），标题才能贴到 logo 右侧（实测 x: 121 → 89）；
       ③ 隐藏吸顶栏里那个蓝色圆形加号 .SearchBar-askDropdownButton（34px，和「关注问题」挤在一起，
          与问题页语境无关），以及「写回答」等在这条窄栏里本就显示不下的按钮。
     ⚠️ 作用域必须限定在 .PageHeader 内 —— 未滚动时的完整标题区（大字号标题 + 三个按钮那行）
        也在 .QuestionHeader-main / .QuestionHeader-side 里，别误伤。
     实测（真机 1080×2400，列宽 361）：标题 99..229（**130px**，15px 字号 ≈ **8.7 字**）、按钮 56×24
       且右端推到 **293**（距右上角头像左缘 304 只有 11px）、两者同一行；
       标题左端 99 与「知乎」LOGO 右缘 84 之间正好 15px（= 一个 15px 字号的字宽）。
       吸顶栏高度仍是 62px（知乎固定值，未强改）。
     ⚠️ 用户 2026-09-30 追加五条：**只留「关注问题」**（其余按钮一律不显示，含那个蓝色圆形加号）、
        **按钮再往右靠**（margin-left: auto + margin-right: -20px + 右侧内边距归零）、
        **标题再大一号**（13px → 15px）、**按钮与右上角头像之间只留一个空**、
        **标题与「知乎」LOGO 之间留一个字**（padding-left 4px → 14px）。
        注意字号与字数是此消彼长的：13px 时标题能显示 8.6 字，放大到 15px 后若不推按钮只剩 8 字；
        把按钮右推让出 20px 后回到 9.3 字，再给 LOGO 让出一个字宽后落定 **8.7 字**。 */
  .PageHeader .QuestionHeader-content {
    flex-wrap: nowrap !important; align-items: center !important;
    /* padding-left: 14px —— 标题与「知乎」LOGO 之间留一个字（LOGO 右缘 84，标题左端 89 只空 5px 太挤；
       14px ⇒ 标题左端 99、与 LOGO 之间正好 15px ≈ 一个 15px 字号的字宽）。用户 2026-09-30 要求。 */
    padding-left: 14px !important; padding-right: 0 !important; column-gap: 8px !important;
  }
  .PageHeader .QuestionHeader-main { flex: 1 1 0 !important; min-width: 0 !important; padding-left: 0 !important; padding-right: 0 !important; }
  .PageHeader .QuestionHeader-title {
    font-size: 15px !important; line-height: 22px !important; display: block !important;
    white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;
  }
  .PageHeader .QuestionHeader-side {
    flex: 0 0 auto !important; width: auto !important; padding-left: 0 !important; flex-wrap: nowrap !important;
    /* margin-left:auto 先把按钮顶到容器最右；margin-right:-20px 再往右推 20px ——
       否则按钮右端只停在 .PageHeader 的右缘 **273**，而右上角头像左缘在 **304**，
       中间空 31px、看起来很散（用户 2026-09-30 反馈「跟头像中间留一个空就可以了」）。
       推 20px 后按钮右端 **293**、距头像 11px；.PageHeader 是 overflow:visible，溢出不会被裁。
       副作用（正面）：标题可用宽度反而 120px → 140px（约 8 字 → 9.3 字）。 */
    margin-left: auto !important; margin-right: -20px !important;
  }
  .PageHeader .QuestionHeader-profile { display: none !important; }
  .PageHeader .QuestionButtonGroup > button:not(.FollowButton),
  .PageHeader .QuestionHeaderActions { display: none !important; }
  .PageHeader .SearchBar-askDropdownButton { display: none !important; }
  .PageHeader .FollowButton {
    min-width: 0 !important; width: auto !important;
    font-size: 11px !important; padding-left: 5px !important; padding-right: 5px !important;
    height: 24px !important; min-height: 0 !important; line-height: 24px !important;
  }

  /* header nav: swipeable when overlong */
  .AppHeader > div, .AppHeader { overflow-x: auto !important; scrollbar-width: none !important; }
  .AppHeader::-webkit-scrollbar, .AppHeader > div::-webkit-scrollbar { display: none !important; }

  /* readability */
  body { font-size: 16px !important; }
  .RichContent, .RichText, .Post-RichText, .CommentContent { font-size: 16px !important; line-height: 1.75 !important; }
  .ContentItem-title, .Post-Title, h1.QuestionHeader-title { font-size: 20px !important; line-height: 1.4 !important; }

  /* excerpt clamp overlap fix: show full excerpt on mobile */
  .ContentItem .RichContent-inner { max-height: none !important; }
  .ContentItem-excerpt, .RichContent--ellipsis {
    max-height: none !important;
    -webkit-line-clamp: unset !important;
    overflow: visible !important;
  }

  /* ---- 首页信息流：封面缩略图按「正文行数」定高 + 上下与文字对齐 ----
     （开关：CFG.feedThumbLines / CFG.wrapAroundThumb）
     知乎的封面是 float: left 的固定 190x105 盒子（内有 absolute 的 inner 与 object-fit:cover 的图片）。
     190px 占内容列 326px 的 58%，绕在右侧的文字只剩 136px（每行 7~8 字）。
     这里改成**由行数反推**：高度 = 行数 × 正文行高，宽度按原比例跟随 —— 这样图片顶/底正好落在
     正文的行边界上，绕排整齐；宽度也就自然不会再回到 190px。
     ⚠️ 只改尺寸，别动 inner 的 position —— 把它改成 static 会把图片推出屏幕（实测 L=-44），
        卡片只剩一块浮动占位。
     ⚠️ 也别想用 zoom 缩放：浮动盒不会变小，文字列不会变宽。
     ⚠️ 真正决定「下方是否回宽」的是 .RichContent-inner 的 overflow：值为 hidden 时它会成为
        **BFC**，而 BFC 被整体挤到浮动旁边、**永不在浮动下方回宽** ⇒ 文字一路都是窄列。 */
  :root { --z2m-line: 28px; }   /* 正文行高 = 16px x 1.75，与下面的字号规则一致 */
  ${CFG.feedThumbLines > 0 ? `
  .RichContent-cover {
    /* 高度 = N 行**字形墨迹盒**的总高：从第 1 行字形顶到第 N 行字形底。
       注意要跟「字形」对齐，不能跟「行框」或「内联盒」对齐 —— 三者高度差很多（16px 字体实测）：
         行框 28px  >  内联盒 22px（字体的 ascent 17 + descent 5）  >  字形盒 15px（ascent 14 + descent 1）
       公式：(N-1) x 行高 + 字形盒高 ⇒ N=3 时为 2 x 28 + 15 = 71px；等价写法 N x 行高 - 13px
       （13 = 行高 28 - 字形盒 15）。只减一次，行与行之间的间距照留。
       ⚠️ 用 N x 行高（= 84px）会把图片底边压到第 N+1 行文字上；用 N x 行高 - 7px（= 77px）
       仍比第 N 行字形底低 3.7px、且顶边高出第 1 行字形顶 2.3px —— 两版都被用户看出「没对齐」。 */
    height: calc(var(--z2m-line) * ${CFG.feedThumbLines} - 13px) !important;
    width: auto !important;
    aspect-ratio: 190 / 105 !important;
    /* 让图片顶对齐第 1 行的**字形顶**：行框顶 → 字形顶 要下移「半行距 3 + 字形顶偏移 3」≈ 6.3px。 */
    margin-top: 6.3px !important;
    /* ⚠️ 必须把知乎自带的 margin-bottom: 4px 抵消成 0（即 -4px）。
       浮动的**影响高度 = margin-top + height + margin-bottom** —— 只要它超过 N × 行高，
       第 N+1 行的行框就会被它压住、跟着缩成窄列，看上去就像图片占了 N+1 行
       （实测：84 + 4 + 4 = 92 > 84 ⇒ 4 行变窄；改成 84 + 4 + 0 = 88 > 84 仍 4 行；
       84 + 4 + (-4) = 84 ⇒ 第 4 行回到全宽 ✓，且图片底边正好落在第 4 行文字顶上）。 */
    margin-bottom: -4px !important;
  }
  .RichContent-cover-inner { width: 100% !important; height: 100% !important; }
  .RichContent-cover img { width: 100% !important; height: 100% !important; }
  ` : ''}
  ${CFG.wrapAroundThumb ? `
  .ContentItem .RichContent-inner { overflow: visible !important; }
  ` : ''}

  /* ---- 放大后列变窄的副作用：作者行里的名字会被硬切 ----
     CFG.textScale > 0.91 时列宽比 screen.width 窄，而头像/关注按钮仍是原来的 CSS 尺寸，
     作者名那一格就变挤。知乎自己给了 overflow:hidden + nowrap 但没有省略号，长名字会被
     从中间切断、看起来像被右侧「关注」按钮压住。只补一个省略号，不改布局。 */
  .AuthorInfo { text-overflow: ellipsis !important; }

  /* ---- 评论区弹层：只动「溢出」这一种病态情形 ----
     治的是桌面坐标下的两处溢出，不改变正常弹窗（不溢出的弹窗仍由知乎自己居中）：
       1) 卡片高于容器时，容器的 flex 垂直居中会把卡片顶部推到屏幕外，
          且溢出部分落在滚动原点之上，向上滚不回来 —— 标题栏/最初几条评论永久不可达；
       2) 卡片宽于容器时右侧被裁切。
     这两条都只在「卡片越界」时命中，因此对知乎其它弹窗无副作用。 */
  .Modal-content { box-sizing: border-box !important; }
  `;
  (document.head || document.documentElement).appendChild(st);

  // ============================================================
  // 扫描记忆化
  // ------------------------------------------------------------
  // capFixed 扫 `body *`、hideSideRails 扫 `main div`、capWide 扫 main 里的各块 —— 三者都要
  // 对每个元素调 getComputedStyle / getBoundingClientRect（强制样式计算）。真机实测单次
  // tick 因此要 20~44ms：capFixed 7.9~21.2ms、hideSideRails 7.7~11.0ms、capWide 3.2~4.0ms。
  // 而 tick 由 300ms 去抖驱动，滚动长页面时实测约 2.3 次/秒 —— 即滚动期间每秒 46~100ms
  // 花在主线程上，且每次都超过一帧。
  // 记下「这一拍已经看过的元素」，下一拍直接跳过，只有新出现的节点才付代价。
  // 代价：元素**先在 DOM 里、之后才变大 / 才变成 fixed** 的情形会被漏掉，因此每
  // SWEEP_EVERY 拍做一次全量重扫，屏幕尺寸变化（resize）时也清空重扫。
  // ============================================================
  const SWEEP_EVERY = 10;
  let sweepCount = 0;
  let seenFixed = new WeakSet(), seenRailRows = new WeakSet(), seenWide = new WeakSet();
  function clearScanMemo() {
    seenFixed = new WeakSet(); seenRailRows = new WeakSet(); seenWide = new WeakSet();
  }

  // ---- hide side rails ----
  function hideSideRails() {
    document.querySelectorAll('.GlobalSideBar, .Question-sideColumn, [class*="SideBar"]').forEach(e => { e.style.display = 'none'; });
    // generic: Zhihu puts content FIRST, rail AFTER. Hide non-first flex children
    // that look like a side rail purely by their own size (w 80-420, tall >=300).
    document.querySelectorAll('main div').forEach(row => {
      if (seenRailRows.has(row)) return;
      seenRailRows.add(row);
      const cs = getComputedStyle(row);
      if (!cs.display.includes('flex') || cs.flexDirection.startsWith('column')) return;
      const rowR = row.getBoundingClientRect();
      const kids = [...row.children].filter(k => k.getBoundingClientRect().height > 0);
      if (kids.length < 2) return;
      kids.forEach((k, i) => {
        if (i === 0) return;
        const r = k.getBoundingClientRect();
        const cs = getComputedStyle(k);
        if (cs.display === 'none') return;
        // 必须落在该行的**右半边**：侧栏在右、正文在左，
        // 这样「左右两栏都在 80~420 宽」的版式不会被连正文一起隐藏。
        if (r.left < rowR.left + rowR.width / 2) return;
        // 形态 A：正常侧栏 —— 宽 80~420、够高
        const normalRail = r.width >= 80 && r.width <= 420 && r.height >= 300;
        // 形态 B：**被挤塌的侧栏** —— 宽度剩不到 4px，但里面还有文字。
        // 这种最坑：宽度为 0 ⇒ white-space:normal 让每个字各自换行，而 overflow:visible
        // 让文字照旧溢出显示 —— 屏幕上就是右边缘一条逐字竖排的「帮助中心/举报中心/关于知乎…」。
        // 实测首页侧栏（含 大家都在搜 / 广告卡 / 页脚）就是这样塌成 0 宽的，
        // 而形态 A 的宽度条件正好放过它，于是漏了出来。
        const collapsedRail = r.width <= 4 && r.height >= 60 && (k.textContent || '').trim().length > 0;
        if (normalRail || collapsedRail) k.style.display = 'none';
      });
    });
  }

  // ---- cap fixed-position strays ----
  function capFixed() {
    document.querySelectorAll('body *').forEach(e => {
      if (seenFixed.has(e)) return;
      seenFixed.add(e);
      let cs;
      try { cs = getComputedStyle(e); } catch (err) { return; }
      if (cs.position !== 'fixed' || cs.display === 'none') return;
      const r = e.getBoundingClientRect();
      if (r.width > SW + 2) {
        e.style.maxWidth = SW + 'px';
        // ⚠️ 这里必须用 hidden，**不能**用 auto。
        // 这些被收窄的 fixed 层里，典型就是评论弹层：它内部有一个**故意放到屏幕外的原生
        // 「关闭」按钮**（`right: -60px`，见「已知未修」第 1 条），于是层的内容比它本身宽 60px。
        // 若给 auto，这个平时**看不见**的溢出就变成了**可横向滚动的区域** —— 用户一划就能把整个
        // 弹层推走 60px：左边被裁、右边露出底下的页面（实测 scrollLeft 60，弹层从 `0..358`
        // 变成 `-60..298`，且划出去后回不来）。
        // hidden 把那段溢出裁掉、**禁止用户横向滑动**；纵向滚动仍由这一层承担。
        e.style.overflowX = 'hidden';
      } else if (r.right > SW + 2 && r.width > 0) {
        e.style.left = Math.max(4, SW - r.width - 8) + 'px';
        e.style.right = 'auto';
      }
    });
  }

  // ---- cap wide in-flow blocks ----
  function capWide() {
    document.querySelectorAll('main div, main section, main article, main ul, main table, main figure').forEach(e => {
      if (seenWide.has(e)) return;
      seenWide.add(e);
      if (e.closest('pre')) return;
      const r = e.getBoundingClientRect();
      if (r.width > SW + 2) e.style.maxWidth = '100%';
    });
  }

  // ============================================================
  // 评论区弹层（.Modal-content）：返回键关闭 + 溢出定位修正
  // ------------------------------------------------------------
  // 真机（Kiwi 桌面模式 + 1080×2400）实测：
  //   · 弹层结构：body > … > div(fixed, z=203, flex/column, justify-content:center)
  //                    > 卡片外壳 > .Modal-content
  //   · 容器尺寸≈视口（实测 373×734；滚动条/视口变化时会变成 393×773），
  //     卡片尺寸来自知乎的桌面坐标 CSS：实测 688×1832。
  //   · 卡片 1832px > 容器 734px，flex 垂直居中 → 卡片上移 549px（= (734-1832)/2），
  //     标题栏与最初几条评论落在容器滚动原点之上，滚不回来；
  //   · 卡片 688px > 容器 373px → 右侧约 315px 被裁掉；
  //   · 「关闭」按钮被知乎放在卡片右外侧（right:-60px），桌面坐标下本就在屏幕外；
  //   · 打开弹层不压入任何历史记录，而进入回答页时 history.length 常为 1，
  //     此时按返回会直接离开知乎，而不是关闭弹层。
  //   · 卡片高度取决于已加载的评论条数，所以垂直溢出并非每次都能复现 ——
  //     该分支已用受控夹具单测覆盖（scripts/test-modal-layout.js）。
  // 因此这里：① 打开时压入一条哨兵历史，返回键 popstate 时关闭弹层；
  //           ② 只在「卡片越界」时把容器改为顶部对齐、把卡片收进屏幕。
  // ============================================================
  const MODAL_SEL = '.Modal-content';
  const CLOSE_SEL = '[aria-label="关闭"]';

  let guardPushed = false;   // 哨兵历史条目是否处于已压入状态
  let selfPop = false;       // 标记「由脚本主动 history.back()」，用于区分用户返回
  let modalWasOpen = false;  // 上一拍的弹层开关状态

  function modalEl() { return document.querySelector(MODAL_SEL); }

  // 定位弹层的三层结构：卡片(Modal-content) / 容器(承载它的固定定位遮罩) / 是否需要修正
  function locateModal() {
    const mc = modalEl();
    if (!mc) return null;
    let layer = mc;
    while (layer && layer !== document.body) {
      const cs = getComputedStyle(layer);
      if (cs.position === 'fixed' && (parseInt(cs.zIndex, 10) || 0) >= 50) break;
      layer = layer.parentElement;
    }
    if (!layer || layer === document.body) layer = null;
    // 卡片：从 Modal-content 往上，第一层「有限高」的即为卡片外壳
    let card = mc.parentElement;
    while (card && card !== layer && card !== document.body) {
      if (getComputedStyle(card).maxHeight !== 'none') break;
      card = card.parentElement;
    }
    if (!card || card === layer || card === document.body) card = null;
    return { mc, layer, card };
  }

  // 修正弹层定位：只在「卡片比容器更大」这种越界情形下动手
  function fixCommentModal() {
    if (!CFG.fixCommentLayout) return;
    const found = locateModal();
    if (!found) return;
    const { layer, card } = found;
    if (!layer) return;
    const lr = layer.getBoundingClientRect();
    const cr = (card || layer).getBoundingClientRect();

    // ① 卡片高于容器：容器不能再垂直居中，否则顶部溢出且不可滚回
    if (card && cr.height > lr.height + 1) {
      if (layer.style.getPropertyValue('justify-content') !== 'flex-start') {
        layer.style.setProperty('justify-content', 'flex-start', 'important');
      }
    }
    // ② 卡片宽于容器：收进容器，消除右侧裁切
    if (card && cr.width > lr.width + 1) {
      if (card.style.getPropertyValue('max-width') !== '100%') {
        card.style.setProperty('max-width', '100%', 'important');
        card.style.setProperty('width', 'auto', 'important');
        card.style.setProperty('align-self', 'stretch', 'important');
      }
    }
  }

  // 压入一条哨兵历史：返回键会先消费它，而不是直接离开知乎
  function pushGuard() {
    if (guardPushed) return;
    try {
      history.pushState({ z2mComment: 1 }, '', location.href);
      guardPushed = true;
    } catch (e) { guardPushed = false; }
  }

  // 弹层被别的方式关掉（点关闭/收起）时撤掉哨兵，避免用户多按一次返回。
  // 安全点：只有当哨兵仍是「当前历史条目」时才回退它。若期间用户已经导航
  // （例如在弹层里点进了某个链接），当前条目已经不是哨兵，此时 history.back()
  // 会把用户的导航撤销掉，所以必须跳过。
  function dropGuard() {
    if (!guardPushed) return;
    guardPushed = false;
    const cur = history.state;
    if (!cur || cur.z2mComment !== 1) return;
    selfPop = true;
    try { history.back(); } catch (e) { selfPop = false; }
  }

  // 关闭弹层：优先点知乎自己的「关闭」按钮（.click() 不受命中测试限制，
  // 该按钮即使被放在屏幕外也能生效）；否则补一发 Escape。
  function closeCommentModal() {
    const found = locateModal();
    if (!found) return;
    const scope = found.layer || found.mc;
    const btn = scope.querySelector(CLOSE_SEL) || document.querySelector(CLOSE_SEL);
    if (btn) { try { btn.click(); } catch (e) {} }
    else { sendEscape(); }
    // 兜底：一拍之后若仍开着，再补一发 Escape
    setTimeout(() => {
      if (document.querySelector(MODAL_SEL)) sendEscape();
    }, 350);
  }

  function sendEscape() {
    const t = document.activeElement || document.body;
    const ev = new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true,
    });
    try { t.dispatchEvent(ev); } catch (e) {}
    try { document.dispatchEvent(ev); } catch (e) {}
  }

  // 每拍同步弹层状态：处理「打开 → 压哨兵 / 关闭 → 撤哨兵」
  function syncCommentModal() {
    const open = !!modalEl();
    if (open && !modalWasOpen) {
      modalWasOpen = true;
      if (CFG.commentBack) pushGuard();
    } else if (!open && modalWasOpen) {
      modalWasOpen = false;
      dropGuard();
    }
    if (open) fixCommentModal();
  }

  // 返回键：消费哨兵 → 关闭弹层，而不是离开问答页
  window.addEventListener('popstate', () => {
    if (selfPop) { selfPop = false; return; }
    if (!guardPushed) return;
    guardPushed = false;
    if (modalEl()) closeCommentModal();
  });

  // ---- hide the "同时发布到想法" option in the comment composer ----
  // 真机实测：该选项包裹层被挤成 0 宽，7 个汉字竖排成一列（文案 13×121~155，随页面状态），
  // 把发布框从 94px 撑到 185px（另一次实测到 219px）。这里连同它左侧的 radio 图标一起隐藏。
  // 类名是 emotion hash（css-tqtem1），随构建变化，不能作为选择器；改为按文案定位，
  // 再向上收成「除该文案外不含其它文字」的最大祖先 —— 这样能带上 radio 图标，
  // 又不会误伤同一行右侧的「发布」按钮（其父层文案里还有「发布」二字）。
  let ideaBox = null;                       // 缓存已处理节点；SPA 重建后 isConnected 变 false 会自动重找
  function hideIdeaOption() {
    if (!CFG.hideIdeaOption) return;
    if (ideaBox && ideaBox.isConnected) return;
    ideaBox = null;
    // 廉价前置判断：该选项只可能出现在发布框里，而发布框必然带一个可编辑区。
    // 没有可编辑区就直接跳过 —— 否则这条 XPath 会在**每一个**没有发布框的页面上
    // 每拍全量重跑一次（实测单次 3~7ms，白花）。
    if (!document.querySelector('[contenteditable="true"]')) return;
    const Q = '同时发布到想法';
    const strip = s => (s || '').replace(/[\s\u200b\u200c\u200d\ufeff]+/g, '');
    let snap;
    try {
      // 用 XPath 而不是遍历全部元素：原生匹配，命中数少时显著更快
      snap = document.evaluate("//*[contains(., '" + Q + "')]", document, null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    } catch (e) { return; }
    let label = null;
    // 快照按文档顺序（祖先在前），取最后一个「文本恰好等于该文案」的节点 = 最内层
    for (let i = 0; i < snap.snapshotLength; i++) {
      const el = snap.snapshotItem(i);
      if (strip(el.textContent) === Q) label = el;
    }
    if (!label) return;
    let box = label;
    while (box.parentElement && strip(box.parentElement.textContent).replace(Q, '') === '') {
      box = box.parentElement;
    }
    box.style.setProperty('display', 'none', 'important');
    ideaBox = box;
  }

  // ---- 隐藏首页「写想法」卡片里塌成 0 宽的竖排「同步到圈子」 ----
  // 真机实测：那一行只有 234px 可用宽，这个「发到圈子」的开关被挤成 **0 宽**
  // （rect {x:298, w:0, h:95}），7 个汉字因此逐字竖排，在内容列右侧看起来像一条竖排残渣。
  // 它是**发到圈子的功能开关**，隐藏等于去掉该功能 —— 属产品取舍，用户 2026-09-30 明确要求
  // 去掉（这条原是「已知未修」第 2 条，本次给了结论）。
  // 定位方式与 hideIdeaOption 完全一致：按文案 XPath → 向上收成「除该文案外不含其它文字」的
  // 最大祖先 —— 这样能带上它自己的图标，又**不会误伤同一行右侧的「发想法」按钮**
  // （那个按钮的祖先文案里还有「发想法」三个字）。
  let circleSyncBox = null;
  function hideCircleSync() {
    if (!CFG.hideCircleSync) return;
    if (circleSyncBox && circleSyncBox.isConnected) return;
    circleSyncBox = null;
    // 廉价前置判断：该文案只出现在首页的「写想法」卡片里，而那张卡片必然带 .WriteArea。
    // 没有它就直接跳过 —— 否则这条 XPath 会在每一个没有该卡片的页面上每拍全量重跑一次。
    if (!document.querySelector('.WriteArea')) return;
    const Q = '同步到圈子';
    const strip = s => (s || '').replace(/[\s\u200b\u200c\u200d\ufeff]+/g, '');
    let snap;
    try {
      snap = document.evaluate("//*[contains(., '" + Q + "')]", document, null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    } catch (e) { return; }
    let label = null;
    for (let i = 0; i < snap.snapshotLength; i++) {
      const el = snap.snapshotItem(i);
      if (strip(el.textContent) === Q) label = el;
    }
    if (!label) return;
    let box = label;
    while (box.parentElement && strip(box.parentElement.textContent).replace(Q, '') === '') {
      box = box.parentElement;
    }
    box.style.setProperty('display', 'none', 'important');
    circleSyncBox = box;
  }

  // ---- 让发布框那一行放得下「发布」按钮 ----
  // 真机实测：这一行可用宽 225px（clientWidth），内容却需要 304px（scrollWidth）。
  // 原因是编辑区带知乎自己的 `flex: 0 0 auto`（218px，不收缩），而「发布」按钮又被
  // 本脚本的 `main button { flex: 0 0 auto }` 钉住也不收缩 —— 两者都不让，按钮就被
  // 挤出容器 55px 并越过屏幕 20px（62px 只露出 42px）。
  // 解法：把该行首个子元素（那个不收缩的编辑区）改为可收缩，内容即可收进 225px。
  // 实测「发布」按钮完整可见（62/62px），且发布框高度不变（94px），工具栏未被压坏。
  // 定位不依赖 emotion hash（会随构建变）。
  //
  // **上界**：先找到一个「发布框的根」—— 从「发布」按钮向上、第一个含可编辑区的祖先；
  // 之后所有查找都限定在它（或其父层）之内，绝不一路向上到 body。早期版本没有这个上界，
  // 一旦发布框那一行没有目标元素，循环就会继续向上并命中页面里无关的头像/容器。
  const normText = s => (s || '').replace(/[\s\u200b\u200c\u200d\ufeff]+/g, ' ').trim();
  function publishButtons() {
    // ⚠️ 廉价前置：「发布」按钮只存在于发布框里，而发布框必然带一个可编辑区。
    //    没有可编辑区就直接返回空 —— 否则这次**全文档 button 扫描**会在首页加载期
    //    被 observer 回调反复调用（实测首页 125 个按钮，单次 0.6ms；加前置后 0.1ms）。
    //    有了它，publishButtons 及其下游的两个 pass（fitPublishButton / matchComposerAvatar）
    //    才能安全地挂进 observer 回调、不必等 tick 的 300ms 去抖。
    if (!document.querySelector('[contenteditable="true"]')) return [];
    return [...document.querySelectorAll('button')].filter(b => normText(b.innerText) === '发布');
  }
  function composerRoot(btn) {
    let n = btn.parentElement;
    while (n && n !== document.body) {
      if (n.querySelector('[contenteditable="true"]')) return n;
      n = n.parentElement;
    }
    return null;   // 找不到发布框根就什么都不做（宁可不动，也不要乱动）
  }

  const shrinkDone = new WeakSet();   // 已处理过的编辑区；WeakSet 自动回收被替换掉的节点
  function fitPublishButton(btns) {
    if (!CFG.fitPublishButton) return;
    for (const btn of btns) {
      const root = composerRoot(btn);
      if (!root) continue;
      // 在发布框根之内找「放不下内容」的那一行：自身溢出，且首个子元素占了大半内容宽
      // —— 这条规则会跳过按钮直属的那个 7px 宽控件容器。
      let row = btn.parentElement, found = null;
      while (row && row !== root) {
        const first = row.children[0];
        const fw = first ? first.getBoundingClientRect().width : 0;
        // 只处理「窄列」——即手机单列下的情况，避免干扰桌面宽度下的正常布局
        if (row.clientWidth > 0 && row.clientWidth <= SW &&
            row.scrollWidth > row.clientWidth + 4 &&
            row.children.length >= 2 && fw >= 0.6 * row.scrollWidth) { found = row; break; }
        row = row.parentElement;
      }
      if (!found) continue;
      const target = found.children[0];
      if (!target || shrinkDone.has(target)) continue;
      target.style.setProperty('flex', '1 1 auto', 'important');
      target.style.setProperty('min-width', '0', 'important');
      shrinkDone.add(target);
    }
  }

  // ---- 发布框头像：缩到与评论列表头像同尺寸 ----
  // 发布框那个头像只有 `Avatar` 这个通用类，旁边的类名是 emotion hash，CSS 无法表达
  // 「与发布按钮同一行的那个头像」；所以按结构走。
  // 收得比 fitPublishButton 更紧：头像与发布框本体同级，因此只在「发布框根的父层」里找，
  // 且要求它是该层的**直接子元素**（实测结构如此）。找不到就不动 —— 宁可漏，不要误伤
  // 页面别处的头像；测试里有一条断言会盯着这个头像是否真的被改到 24×24。
  // 另外：知乎给它是 40px（评论列表头像是 24px）。缩到 24 是按使用者要求「与评论里的
  // 头像一样大」；这是刻意偏离站点设计，所以留了开关。
  const avatarDone = new WeakSet();
  function matchComposerAvatar(btns) {
    if (!CFG.matchComposerAvatar) return;
    for (const btn of btns) {
      const root = composerRoot(btn);
      const scope = root && root.parentElement;
      if (!scope || scope === document.body) continue;
      const av = [...scope.children].find(c => c.tagName === 'IMG' && c.classList.contains('Avatar'));
      if (!av || avatarDone.has(av)) continue;
      const px = CFG.composerAvatarSize + 'px';
      av.style.setProperty('width', px, 'important');
      av.style.setProperty('height', px, 'important');
      avatarDone.add(av);
    }
  }

  // ---- 让首页「写想法」卡片里的「发想法」按钮完整落在屏幕内 ----
  // 真机实测（v1.2.0 去掉两侧灰边之后）：该按钮越出屏幕右缘 9px。三个原因，缺一不可：
  //   ① 知乎给按钮写了**固定宽度 75px** —— 把它的内边距改成 8px，计算宽度仍是 74.9998px
  //      （宽度根本不随内边距走），所以「只收窄内边距」无效；
  //   ② 它自带 `margin-left: 20px`，把按钮从所在行的 272 顶到 292；
  //   ③ 文字本身 45px + 左右内边距 18px×2 = 81px，而它所在的盒子只有 66px 宽 → 只能溢出。
  // 解法：把宽度交还给内容（width:auto）、清掉那段额外左外边距、内边距收到 12px。
  // 实测：按钮 292..367（越出 9px）→ **272..341**：完整可见，距屏幕右缘 17px，
  // 与块内其它内容的右边界（342）基本对齐。
  // ⚠️ **不要**改用「让所在行换行」的办法：那会让按钮独占一行（实测可完全进屏，越界 −20px），
  //    但观感变化大，用户 2026-09-30 已明确否掉。也别指望 `:has()` —— 它在这个布局里帮不上忙。
  let ideaBtnDone = null;      // 缓存已处理节点；SPA 重建后 isConnected 变 false 会自动重找
  function fitIdeaButton() {
    if (!CFG.fitIdeaButton) return;
    if (ideaBtnDone && ideaBtnDone.isConnected) return;
    ideaBtnDone = null;
    // 廉价前置判断：该按钮只可能出现在首页的「写想法」卡片里，而那张卡片必然带 .WriteArea
    const area = document.querySelector('.WriteArea');
    if (!area) return;
    const btn = [...area.querySelectorAll('button')].find(b => normText(b.innerText) === '发想法');
    if (!btn) return;
    btn.style.setProperty('width', 'auto', 'important');
    btn.style.setProperty('margin-left', '0', 'important');
    btn.style.setProperty('padding-left', '12px', 'important');
    btn.style.setProperty('padding-right', '12px', 'important');
    ideaBtnDone = btn;
  }

  let timer = null;
  let lastTickSW = -1;        // 上一拍的 SW；变了说明阈值全变，记忆作废（applyZoom 会改 SW，见那里的注释）
  function tick() {
    if (SW !== lastTickSW) { lastTickSW = SW; clearScanMemo(); }
    // 周期性全量重扫：见「扫描记忆化」一节，抵消「看过的元素后续变大就漏掉」的代价
    if (++sweepCount % SWEEP_EVERY === 0) clearScanMemo();
    hideSideRails(); capFixed(); capWide();
    // 全量按钮扫描实测 ~1ms，一次查询给两个 pass 共用，不各扫一遍
    const btns = publishButtons();
    hideIdeaOption(); hideCircleSync(); fitIdeaButton(); fitPublishButton(btns); matchComposerAvatar(btns);
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(tick, 300); }

  // 弹层开合要快于 tick 的 300ms 去抖：直接挂在 observer 回调里同步，
  // 避免用户刚点开评论就按返回、哨兵还没压入。
  // ⚠️ 所有「矫正类」pass 都必须**同步**跑在这里，不能只留给 tick ——
  //    tick 有 300ms 去抖（见下面的 schedule），而且**每次 DOM 变动都会重置它**；
  //    未处理的元素会先以「本来该被改掉的样子」渲染出来、一两秒后才被修正，
  //    用户看到的就是「先闪一下 / 先跳出屏幕再跳回来」（2026-10-01 两次反馈）。
  //    MutationObserver 回调是**微任务**，跑在同一帧渲染之前 ⇒ 同步执行即可做到「一出现就改好」。
  //    每个 pass 都有廉价前置判断或记忆化（处理过的节点仍连在 DOM 上就直接 return），
  //    所以挂在这里的稳态成本接近 0：
  //      · hideCircleSync / fitIdeaButton / hideIdeaOption —— 都以 `.WriteArea` 或
  //        `[contenteditable="true"]` 做前置，没有目标容器时连 XPath 都不跑；
  //      · publishButtons（给下面两个 pass 共用）—— 前置见其函数内注释。
  //    实测单次开销：publishButtons 0.1ms、guard 查询 0.06ms。
  //    tick 里原有的那一遍全部保留，作为「周期性全量重扫」的兜底。
  const obs = new MutationObserver(() => {
    syncCommentModal(); hideCircleSync(); fitIdeaButton(); hideIdeaOption();
    const btns = publishButtons();       // 一次查询给下面两个 pass 共用（与 tick 里的做法一致）
    fitPublishButton(btns); matchComposerAvatar(btns);
    schedule();
  });
  function start() {
    obs.observe(document.body, { childList: true, subtree: true, attributes: false });
    tick(); syncCommentModal();
    window.addEventListener('resize', () => {
      // 横竖屏切换后 screen.width 会变：重算基准，再让 applyZoom 按新的可用宽校准 SW。
      // 这里可以安全地直接清扫描记忆（start() 在扫描记忆初始化之后才执行），不必等 tick 发现 SW 变化。
      SW_BASE = Math.max(320, Math.min(screen.width || 393, 500));
      applyZoom();
      clearScanMemo();
    });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  // 兜底轮询：防止某些「就地切换可见性」的开合漏掉 MutationObserver
  const poll = setInterval(syncCommentModal, 800);

  // 注意：这是**半清理** —— 摘掉样式表、断开观察器、清定时器、还原反缩放，
  // 但**不撤销各 pass 写入的内联样式**（display:none / max-width / flex / 头像尺寸等仍在）。
  // 因此不要拿它当「关掉脚本」的对照基线做 A/B 诊断，
  // 详见 docs/project-conventions.md 的「验证」一节与 scripts/README.md 的探针表注。
  window.__z2mStop = () => {
    obs.disconnect(); clearTimeout(timer); clearTimeout(zoomFixTimer); clearInterval(poll); st.remove();
    curZ = 1; document.documentElement.style.removeProperty('zoom');
  };
  window.__z2mTick = tick;
  window.__z2mSync = syncCommentModal;
})();
