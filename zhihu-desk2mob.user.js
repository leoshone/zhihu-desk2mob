// ==UserScript==
// @name         知乎桌面版·手机单列适配 (Zhihu Desktop for Mobile)
// @namespace    zhihu2mob
// @version      1.0.7
// @description  在 Kiwi/Chrome「桌面版网站」模式下，把知乎桌面版重排为手机单列、正常字号。适配首页/问答/专栏，评论可正常展开收起；评论弹层支持返回键关闭，并修正其顶部不可达/右侧裁切；发布框去掉会撑高布局的「同时发布到想法」、按钮与头像尺寸归一；清掉右边缘残留的侧栏/页脚（帮助中心、举报中心、关于知乎等）。提示：需配合浏览器「请求桌面版网站」开关使用；未开桌面模式时脚本自动不生效。
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

  // 窄列宽度。会随屏幕旋转变化，故不是常量 —— resize 时更新（消费者的阈值也跟着变）。
  let SW = Math.max(320, Math.min(screen.width || 393, 500));

  // ============================================================
  // 配置开关
  // ============================================================
  const CFG = {
    // 评论弹层：点开时压入一条哨兵历史，返回键（手势/按钮）关闭弹层
    commentBack: true,
    // 评论弹层：修正定位（卡片顶部对齐 + 宽度收进屏幕）
    fixCommentLayout: true,
    // 评论区发布框：隐藏「同时发布到想法」选项（radio 图标 + 文案）
    hideIdeaOption: true,
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

  // ---- counter-zoom: Kiwi desktop mode locks layout viewport (~980) & scale (~0.4);
  // zoom = 1/scale makes content render at natural size filling the screen exactly.
  let curZ = 1;
  function applyZoom() {
    const s = (window.visualViewport && visualViewport.scale) || 1;
    if (s >= 0.9) {
      // 比例恢复到正常（桌面模式关掉、或用户缩放到 1x）：必须把之前写进去的 zoom 撤掉，
      // 否则页面会保持 3.8 倍放大 + 桌面宽度排版。早期版本在这里直接 return，留下了这个坑。
      if (curZ !== 1) { curZ = 1; document.documentElement.style.removeProperty('zoom'); }
      return;
    }
    const Z = Math.min(4, Math.max(1, 1 / s));
    if (Math.abs(Z - curZ) < 0.02) return;
    curZ = Z;
    document.documentElement.style.setProperty('zoom', String(Z));
  }
  applyZoom();
  [300, 1000, 2500].forEach(t => setTimeout(applyZoom, t));   // overview zoom settles late
  window.addEventListener('resize', applyZoom);

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
  .App-main { padding-left: 10px !important; padding-right: 10px !important; }

  /* kill Zhihu's hard min-widths inside content (min-width beats max-width) */
  main div, main section, main article, main ul, main ol, main li,
  main table, main figure, main p, header div {
    min-width: 0 !important;
    max-width: 100% !important;
  }

  /* action bars wrap */
  .ContentItem-actions { flex-wrap: wrap !important; row-gap: 4px !important; }

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
  .QuestionHeader-footer-inner { flex-direction: column !important; align-items: flex-start !important; }
  .QuestionHeaderActions { margin-left: 0 !important; max-width: 100% !important; }

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
        e.style.overflowX = 'auto';
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

  let timer = null;
  function tick() {
    // 周期性全量重扫：见「扫描记忆化」一节，抵消「看过的元素后续变大就漏掉」的代价
    if (++sweepCount % SWEEP_EVERY === 0) clearScanMemo();
    hideSideRails(); capFixed(); capWide();
    // 全量按钮扫描实测 ~1ms，一次查询给两个 pass 共用，不各扫一遍
    const btns = publishButtons();
    hideIdeaOption(); fitPublishButton(btns); matchComposerAvatar(btns);
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(tick, 300); }

  // 弹层开合要快于 tick 的 300ms 去抖：直接挂在 observer 回调里同步，
  // 避免用户刚点开评论就按返回、哨兵还没压入。
  const obs = new MutationObserver(() => { syncCommentModal(); schedule(); });
  function start() {
    obs.observe(document.body, { childList: true, subtree: true, attributes: false });
    tick(); syncCommentModal();
    window.addEventListener('resize', () => {
      // SW 是常量时会过期：横竖屏切换后 capFixed / capWide / fitPublishButton 仍按旧宽度判断。
      // 同时屏幕尺寸变了，之前「看过就跳过」的结论也不再成立，清空重扫。
      SW = Math.max(320, Math.min(screen.width || 393, 500));
      document.documentElement.style.setProperty('--z2m-w', SW + 'px');
      clearScanMemo();
    });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  // 兜底轮询：防止某些「就地切换可见性」的开合漏掉 MutationObserver
  const poll = setInterval(syncCommentModal, 800);

  // 注意：这是**半清理** —— 摘掉样式表、断开观察器、清定时器、还原反缩放，
  // 但**不撤销各 pass 写入的内联样式**（display:none / max-width / flex / 头像尺寸等仍在）。
  // 因此不要拿它当「关掉脚本」的对照基线做 A/B 诊断，详见 ARTIFACTS.md。
  window.__z2mStop = () => {
    obs.disconnect(); clearTimeout(timer); clearInterval(poll); st.remove();
    curZ = 1; document.documentElement.style.removeProperty('zoom');
  };
  window.__z2mTick = tick;
  window.__z2mSync = syncCommentModal;
})();
