// ==UserScript==
// @name         知乎桌面版·手机单列适配 (Zhihu Desktop for Mobile)
// @namespace    zhihu2mob
// @version      1.0.4
// @description  在 Kiwi/Chrome「桌面版网站」模式下，把知乎桌面版重排为手机单列、正常字号。适配首页/问答/专栏，评论可正常展开收起；评论弹层支持返回键关闭，并修正其顶部不可达/右侧裁切；隐藏发布框里会把布局撑高的「同时发布到想法」选项。提示：需配合浏览器「请求桌面版网站」开关使用；未开桌面模式时脚本自动不生效。
// @match        https://www.zhihu.com/*
// @match        https://zhuanlan.zhihu.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
// zhihu2mob adaptation payload v1 — becomes the userscript body.
(function () {
  'use strict';
  // Only adapt when Zhihu served its DESKTOP layout (Kiwi "桌面版网站" ON).
  // In real mobile mode innerWidth ≈ 393 and the page is already fine.
  if ((window.innerWidth || 0) <= 600) return;
  if (window.__z2mStop) { try { window.__z2mStop(); } catch (e) {} }

  const SW = Math.max(320, Math.min(screen.width || 393, 500));

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
    if (s >= 0.9) return;                 // already normal (no desktop-mode shrink)
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
  img, video { max-width: 100% !important; height: auto !important; }
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
  header div { min-width: 0 !important; }
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

  /* buttons: never squeeze into vertical text */
  main button, header button { white-space: nowrap !important; }
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

  // ---- hide side rails ----
  function hideSideRails() {
    document.querySelectorAll('.GlobalSideBar, .Question-sideColumn, [class*="SideBar"]').forEach(e => { e.style.display = 'none'; });
    // generic: Zhihu puts content FIRST, rail AFTER. Hide non-first flex children
    // that look like a side rail purely by their own size (w 80-420, tall >=300).
    document.querySelectorAll('main div').forEach(row => {
      const cs = getComputedStyle(row);
      if (!cs.display.includes('flex') || cs.flexDirection.startsWith('column')) return;
      const kids = [...row.children].filter(k => k.getBoundingClientRect().height > 0);
      if (kids.length < 2) return;
      kids.forEach((k, i) => {
        if (i === 0) return;
        const r = k.getBoundingClientRect();
        if (r.width >= 80 && r.width <= 420 && r.height >= 300 && getComputedStyle(k).display !== 'none') {
          k.style.display = 'none';
        }
      });
    });
  }

  // ---- cap fixed-position strays ----
  function capFixed() {
    document.querySelectorAll('body *').forEach(e => {
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
  // 真机实测：该选项被挤成 0 宽度，7 个汉字竖排成一列（13×155），把整个发布框
  // 从 122px 撑到 219px。这里连同它左侧的 radio 图标一起隐藏。
  // 类名是 emotion hash（css-tqtem1），随构建变化，不能作为选择器；改为按文案定位，
  // 再向上收成「除该文案外不含其它文字」的最大祖先 —— 这样能带上 radio 图标，
  // 又不会误伤同一行右侧的「发布」按钮（其父层文案里还有「发布」二字）。
  let ideaBox = null;                       // 缓存已处理节点；SPA 重建后 isConnected 变 false 会自动重找
  function hideIdeaOption() {
    if (!CFG.hideIdeaOption) return;
    if (ideaBox && ideaBox.isConnected) return;
    ideaBox = null;
    const Q = '同时发布到想法';
    const strip = s => (s || '').replace(/[\s\u200b\u200c\u200d\ufeff]+/g, '');
    let snap;
    try {
      // 用 XPath 而不是遍历全部元素：原生匹配，代价与命中数成正比
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
  // 定位不依赖 emotion hash（会随构建变）：从「发布」按钮往上找第一个「自身溢出且
  // 首个子元素占了大半内容宽」的行 —— 这条规则会跳过按钮直属的那个 7px 宽控件容器。
  let publishShrink = null;                  // 缓存已处理的编辑区；SPA 重建后自动重找
  function fitPublishButton() {
    if (!CFG.fitPublishButton) return;
    if (publishShrink && publishShrink.isConnected) return;
    publishShrink = null;
    const norm = s => (s || '').replace(/[\s\u200b\u200c\u200d\ufeff]+/g, ' ').trim();
    const btn = [...document.querySelectorAll('button')].find(b => norm(b.innerText) === '发布');
    if (!btn) return;
    let row = btn.parentElement, found = null;
    while (row && row !== document.body) {
      const first = row.children[0];
      const fw = first ? first.getBoundingClientRect().width : 0;
      // 只处理「窄列」——即手机单列下的情况，避免干扰桌面宽度下的正常布局
      if (row.clientWidth > 0 && row.clientWidth <= SW &&
          row.scrollWidth > row.clientWidth + 4 &&
          row.children.length >= 2 && fw >= 0.6 * row.scrollWidth) { found = row; break; }
      row = row.parentElement;
    }
    if (!found) return;
    const target = found.children[0];
    if (!target) return;
    target.style.setProperty('flex', '1 1 auto', 'important');
    target.style.setProperty('min-width', '0', 'important');
    publishShrink = target;
  }

  let timer = null;
  function tick() {
    hideSideRails(); capFixed(); capWide(); hideIdeaOption(); fitPublishButton();
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(tick, 300); }

  // 弹层开合要快于 tick 的 300ms 去抖：直接挂在 observer 回调里同步，
  // 避免用户刚点开评论就按返回、哨兵还没压入。
  const obs = new MutationObserver(() => { syncCommentModal(); schedule(); });
  function start() {
    obs.observe(document.body, { childList: true, subtree: true, attributes: false });
    tick(); syncCommentModal();
    window.addEventListener('resize', () => {
      document.documentElement.style.setProperty('--z2m-w', Math.max(320, Math.min(screen.width || 393, 500)) + 'px');
    });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  // 兜底轮询：防止某些「就地切换可见性」的开合漏掉 MutationObserver
  const poll = setInterval(syncCommentModal, 800);

  window.__z2mStop = () => {
    obs.disconnect(); clearTimeout(timer); clearInterval(poll); st.remove();
  };
  window.__z2mTick = tick;
  window.__z2mSync = syncCommentModal;
})();
