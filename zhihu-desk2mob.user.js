// ==UserScript==
// @name         知乎桌面版 → 手机宽度适配
// @namespace    https://github.com/leoshone/zhihu-desk2mob
// @version      0.7.7
// @description  在 Kiwi 等手机浏览器里把知乎桌面版网页收进手机宽度：修复桌面模式视口缩放、min-width 硬编码、emotion 原子 CSS、vh/vw 单位失真、顶栏溢出。支持旋屏与 SPA 导航。
// @author       leoshone
// @match        https://*.zhihu.com/*
// @match        https://zhihu.com/*
// @icon         https://www.zhihu.com/favicon.ico
// @updateURL    https://raw.githubusercontent.com/leoshone/zhihu-desk2mob/main/zhihu-desk2mob.user.js
// @downloadURL  https://raw.githubusercontent.com/leoshone/zhihu-desk2mob/main/zhihu-desk2mob.user.js
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
 * ─────────────────────────────────────────────────────────────────────────
 *  为什么需要 zoom？
 *
 *  Kiwi 勾选「桌面版网站」后，Chromium 会把 layout viewport 强行撑到 980 CSS px，
 *  再把整页缩小到 0.4 倍塞进 393px 的屏幕。结果就是：正文字号 15px 变成 6px，
 *  页面还得横向拖。
 *
 *  解法不是改布局，而是「抵消浏览器的缩小」：
 *      html { width: 393px; zoom: 980/393 }
 *  393px 的布局 × 2.49 倍放大 = 980px，正好填满 layout viewport；
 *  浏览器再整体缩 0.4 倍投到屏幕上 → 393 × 2.49 × 0.4 = 393，
 *  净效果 1 CSS px = 1 设备独立 px，字号回到正常，且知乎的桌面版布局得以保留。
 *
 *  zoom 的三个陷阱（v3 全踩了，这里已修）：
 *    1. vh/vw 基于 layout viewport，在 zoom 下会放大 2.49 倍 → 改为 JS 折算成 px
 *    2. getBoundingClientRect() 返回的是缩放后坐标 → 溢出检测改用 offsetWidth
 *    3. document-start 时 document.head 还是 null → CSS 注入直接抛错，整个脚本失效
 * ─────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  var TAG = '[知乎适配]';
  var VER = '0.7.7';

  // ═══════════════════════════════════════════════════════════════
  // 可调参数
  // ═══════════════════════════════════════════════════════════════
  var CONFIG = {
    debug:        true,   // 右上角状态角标（点一下可临时关闭适配，再点恢复）
    fitHeader:    true,   // 顶栏自适应裁剪（超过宽度的导航项自动收起）
    hideSidebar:  true,   // 隐藏右侧栏、悬浮按钮、App 下载条
    sideColumn:   'hide',   // 右侧栏处理：'hide' 直接去掉（默认）/ 'bottom' 移到底部 / 'keep' 不动
    hideRightRail:true,   // 按位置兜底去掉右侧栏（现代知乎用哈希类名，类名选择器盖不全）
    fixFlexRows:  true,   // 修「多列 flex 把正文压成一条」：容器换行，内容块各占一行
    modalBackClose:true,  // 弹层（展开回复等）：按手机返回键关掉弹层而不是退出页面
    fixVUnits:    true,   // 修正 vh/vw 在 zoom 下的失真
    bodyFont:     16,     // 正文字号（px）；设 0 表示不改
    maxScan:      4500,   // 单次宽度修复最多扫描的元素数
    sidePadding:  12,     // 页面左右留白（px）
    maxColumnDepth: 8     // 两栏布局容器的最大 DOM 深度：页面骨架很浅，卡片内部很深，
                          // 超过这个深度的一律不当两栏处理（发现页的卡片就栽在这上面）
  };

  var S = {};   // 运行时状态

  function log() {
    if (!CONFIG.debug) return;
    try { console.log.apply(console, [TAG].concat(Array.prototype.slice.call(arguments))); } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. 健壮的样式注入
  //    document-start 阶段 document.head / documentElement 都可能还是 null，
  //    v3 就是在这里 appendChild 抛错、整个 IIFE 挂掉的。
  // ═══════════════════════════════════════════════════════════════
  function injectStyle(cssText, id) {
    var done = false;
    function apply() {
      var parent = document.head || document.documentElement;
      if (!parent) return false;
      var old = document.getElementById(id);
      if (old) old.parentNode.removeChild(old);
      var st = document.createElement('style');
      st.id = id;
      st.textContent = cssText;
      parent.appendChild(st);
      done = true;
      return true;
    }
    if (apply()) return;
    var mo = new MutationObserver(function () {
      if (apply()) mo.disconnect();
    });
    try { mo.observe(document, { childList: true, subtree: true }); } catch (e) {}
    // 双保险：无论如何 1 秒内一定落地
    var t0 = Date.now();
    var timer = setInterval(function () {
      if (apply() || Date.now() - t0 > 1000) { clearInterval(timer); try { mo.disconnect(); } catch (e) {} }
    }, 10);
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. 环境测量
  // ═══════════════════════════════════════════════════════════════
  function screenWidth() {
    // 为什么要这么绕：旋屏 / 键盘弹出时，部分内核（含 Kiwi）会让 screen.width
    // 短暂返回 layout viewport 的宽度而不是物理屏幕宽。一旦采到脏值，zoom 会被
    // 算成 1 且再也回不来 —— 表现为「旋一次屏，适配就永久失效」。
    // 对策：以「设备短边」为锚（竖屏横屏恒定，如 393），只有读数落在合理手机
    // 区间且小于 layout viewport 时才刷新缓存；方向用 viewport 的 orientation 判定。
    var s = window.screen || {};
    var vw = viewportWidth();
    var a = +s.width || 0, b = +s.height || 0;
    var vals = [];
    if (a >= 280 && a <= 2000) vals.push(a);
    if (b >= 280 && b <= 2000) vals.push(b);

    if (vals.length) {
      var lo = Math.min.apply(null, vals);
      // 手机短边区间 [280, 700]，且不应超过 layout viewport
      if (lo >= 280 && lo <= 700 && lo <= vw) S.SHORT = lo;
    }
    var short = S.SHORT || (vals.length ? Math.min.apply(null, vals) : 360);

    // 方向：跟随 viewport（桌面模式下 viewport 也会跟着旋）
    var landscape = false;
    try { landscape = !!(window.matchMedia && window.matchMedia('(orientation: landscape)').matches); } catch (e) {}
    var sw = short;
    if (landscape && vals.length) {
      var long = Math.max.apply(null, vals);
      // 横屏取长边，但必须是「短边的 1~3 倍」且小于 layout viewport，否则退回短边
      if (long > short && long <= short * 3 && long < vw) sw = long;
    }
    if (!sw || sw < 280) sw = short || 360;

    // 物理不可能性兜底：手机屏幕宽不可能 ≥ layout viewport。
    // 若读到 sw >= vw，说明 screen 被内核污染了（旋屏 / 导航后部分内核会让
    // screen.width 返回 layout 宽度），退回缓存短边；连短边都没有就按
    // Chrome 默认比例 980/393 反推。
    if (sw >= vw) {
      var fb = S.SHORT || Math.round(vw / 2.494);
      sw = Math.max(280, Math.min(fb, vw));
    }
    return sw;
  }

  function viewportWidth() {
    return document.documentElement.clientWidth || window.innerWidth || screenWidth();
  }

  function compute() {
    var sw = screenWidth();
    var vw = viewportWidth();
    var ratio = vw / sw;
    // 桌面模式下 vw 远大于 sw；普通移动模式两者基本相等。
    // 一旦判定为桌面模式就锁定，避免旋屏瞬间的脏读数把 zoom 打回 1。
    if (ratio > 1.25) S.desktop = true;
    var needZoom = S.desktop === true;
    S.sw = sw;
    S.vw = vw;
    S.ratio = ratio;
    S.needZoom = needZoom;
    S.Z = needZoom ? Math.min(5, Math.max(1, vw / sw)) : 1;
    S.BASE = needZoom ? sw : Math.min(vw, 680);   // 布局基准宽度
    // 基准坐标系下的「可视高度」（vh 单位要用）
    S.VH = (window.innerHeight || (sw * 2)) / S.Z;
    log('屏幕=' + sw + 'px 视口=' + vw + 'px 比值=' + ratio.toFixed(3) +
        ' → zoom=' + S.Z.toFixed(3) + ' 基准宽=' + S.BASE + 'px');
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. 核心 CSS
  //    只写「知乎改版也不容易失效」的规则：语义 class、结构选择器、
  //    以及针对当前 emotion 结构的通用兜底。硬骨头交给 JS 扫描器。
  // ═══════════════════════════════════════════════════════════════
  function buildCSS() {
    var P = CONFIG.sidePadding;
    var z = S.Z, base = S.BASE;

    return [
      /* ---- 根节点 ---- */
      'html{',
        '-webkit-text-size-adjust:100%!important;text-size-adjust:100%!important;', // 防 Chromium 字体自动放大
        'min-width:0!important;',
        'overflow-x:clip!important;',                      // clip 不创建滚动容器，不破坏 sticky
      S.needZoom
        ? 'zoom:' + z.toFixed(5) + '!important;width:' + base + 'px!important;margin:0 auto!important;'
        : 'width:100%!important;max-width:' + base + 'px!important;margin:0 auto!important;',
      '}',

      /* ---- 主干容器：干掉 min-width，允许收缩 ---- */
      'body{min-width:0!important;max-width:100%!important;overflow-x:clip!important;margin:0 auto!important;',
      'background:#fff!important}',   /* 桌面版 body 是 #f6f6f6 灰底，主列收窄后两侧露灰，
                                          手机上没有"卡片"概念，整页刷白让可视区最大化 */
      'body,#root,.App,.App-main,.QuestionPage,.Question-main,.Topstory-container,',
      'main,article,section,.ExploreHomePage,.ExploreHomePage-ContentSection{',
        'min-width:0!important;width:100%!important;max-width:100%!important;',
        'box-sizing:border-box!important;margin-left:auto!important;margin-right:auto!important;',
        'background:transparent!important;',
      '}',

      /* ---- 主内容列 ---- */
      '.Question-mainColumn,.Question-main .Question-mainColumn,.Topstory-mainColumn,',
      '.Post-NormalMain,.Post-content,.Article-content,.QuestionHeader,.QuestionHeader-main,',
      '.QuestionHeader-content,.PageHeader,.Card,.ContentItem,.List-item,.List{',
        'min-width:0!important;width:100%!important;max-width:100%!important;',
        'box-sizing:border-box!important;',
      '}',

      /* ---- 顶栏（emotion 结构，用语义/结构选择器）---- */
      'header.AppHeader{min-width:0!important;width:100%!important;max-width:100%!important;overflow-x:clip!important}',
      'header.AppHeader,header.AppHeader div,header.AppHeader nav,header.AppHeader form,header.AppHeader ul{',
        'min-width:0!important;max-width:100%!important;box-sizing:border-box!important}',
      /* 顶栏内所有直接文本层禁止不换行导致的撑宽 */
      'header.AppHeader a{min-width:0!important;flex-shrink:1!important}',
      /* 搜索框：可收缩，隐藏右侧「直答」入口 */
      '.SearchBar,.SearchBar-tool{min-width:0!important;max-width:100%!important;flex:1 1 80px!important}',
      '.SearchBar > a{display:none!important}',

      /* ---- 侧栏 / 悬浮件 / 推广 ----
         关键：光把侧栏 display:none 是不够的。如果容器是 grid，列宽是硬分配的，
         隐藏内容并不会让列消失 —— 主列照样被压成一条缝（实测只剩 49px）。
         所以必须 simultaneously 把容器改成单列 / 允许换行。 */
      CONFIG.hideSidebar ? [
        /* 推广、悬浮件：始终隐藏，不影响布局结构 */
        '.AppBanner,.MobileAppBanner,[class*="DownloadApp"],[class*="MobileAppHeader"],',
        '[class*="QRCode"],[class*="QrCode"],[class*="BackToTop"],[class*="Adblock"],',
        '.Toast,.Toast-wrapper,.CornerButtons,.QuestionButtonGroup{display:none!important}',
        /* 侧栏本身：按 sideColumn 模式处理
           ── 为什么没有 [class*="Recommend"] / [class*="Related"]（0.4.0 回归事故）──
           首页信息流每一条帖子的类名都是 TopstoryItem TopstoryItem-isRecommend，
           子串匹配把整列帖子全部 display:none，首页直接白屏（复刻页 A/B 实锤：
           v0.3.3 可见 5/5，v0.4.0 可见 0/5）。类名子串匹配只能认「完整语义词」，
           像 Recommend/Related 这种既出现在侧栏名又出现在内容名里的词，
           一律交给 hideRightRail() 的位置判断去处理，不进 CSS。 */
        CONFIG.sideColumn === 'hide'
          ? [
            '.Question-sideColumn,.Topstory-sideColumn,.ColumnSideBar,.Post-SideColumn,',
            '.GlobalSideBar,.Profile-sideColumn,.ColumnPageSidebar,.Post-Row-Content-right,',
            '.AuthorCard,[class*="AuthorCard"],[class*="HotList"],',
            'aside,[class*="SideColumn"],[class*="SideBar"],[class*="Sidebar"],',
            '[class*="Post-Side"],[class*="Article-Side"],[class*="ColumnPage-Side"]{display:none!important}'
          ].join('')
          : [
            '.Question-sideColumn,.Topstory-sideColumn,.ColumnSideBar,.Post-SideColumn,',
            '.GlobalSideBar,.Profile-sideColumn,.ColumnPageSidebar,.Post-Row-Content-right,',
            '.AuthorCard,[class*="AuthorCard"],[class*="HotList"],',
            'aside,[class*="SideColumn"],[class*="SideBar"],[class*="Sidebar"],',
            '[class*="Post-Side"],[class*="Article-Side"],[class*="ColumnPage-Side"]{',
              'width:100%!important;max-width:100%!important;min-width:0!important;',
              'flex:1 1 100%!important;margin-top:16px!important;box-sizing:border-box!important}'
          ].join(''),
        /* 容器兜底：含侧栏的容器强制单列 / 允许换行（:has 需 Chrome 105+） */
        'div:has(> aside),div:has(> [class*="SideColumn"]),div:has(> [class*="SideBar"]),',
        'div:has(> [class*="Sidebar"]),div:has(> [class*="Post-Side"]),',
        'main:has(> aside),section:has(> aside){',
          'grid-template-columns:1fr!important;flex-wrap:wrap!important}',
      ].join('') : '',
      /* 顶栏里的「切换模式 / 划线」等次要项 */
      'header.AppHeader .Popover{display:none!important}',

      /* ---- 富文本：换行 + 图片视频自适应 ----
         注意：只对内容容器内的媒体生效，绝不碰 svg（图标会变成块级并居中，v3 就是这么炸的） */
      '.RichText,.RichContent,.ztext,.Post-content,.Article-content,',
      '.RichText p,.RichContent p,.ztext p,li,blockquote{',
        'overflow-wrap:break-word!important;word-break:break-word!important;',
        'max-width:100%!important;min-width:0!important;',
      '}',
      '.RichText img,.RichContent img,.ztext img,figure img,',
      '.RichText video,.RichContent video,.ztext video,',
      '.RichText iframe,.RichContent iframe,.ztext iframe,',
      '.RichText canvas,.RichContent canvas{',
        'max-width:100%!important;height:auto!important;display:block!important;margin:12px auto!important;',
      '}',
      'figure{max-width:100%!important;min-width:0!important;margin:12px 0!important}',
      'figure img{width:100%!important}',
      '.RichText iframe,.RichContent iframe{width:100%!important;height:auto!important;min-height:200px!important}',

      /* ---- 代码 / 表格 ---- */
      'pre{max-width:100%!important;min-width:0!important;overflow-x:auto!important;',
        'white-space:pre-wrap!important;word-break:break-word!important}',
      'code{max-width:100%!important;word-break:break-word!important;white-space:pre-wrap!important}',
      'table{max-width:100%!important;display:block!important;overflow-x:auto!important}',

      /* ---- 弹窗 / 抽屉：不能用 vh（zoom 下会放大 z 倍），改用 JS 算好的 px ---- */
      '.Modal-wrapper,.Modal,[role="dialog"],.Drawer,.Drawer-inner,.MuiDialog-paper{',
        'max-width:100%!important;min-width:0!important;box-sizing:border-box!important;',
      '}',
      '.Modal,.Drawer,[role="dialog"]{left:0!important;right:0!important;margin:0 auto!important}',
      /* 弹层顶部对齐 + 限高：桌面版弹层是「top:50% + translate(-50%,-50%)」居中，
         一旦内容高度超过手机视口，上半截（连同关闭按钮）会被顶到屏幕外 → 关不掉。
         这里改成贴顶 + 内部滚动，关闭按钮永远露在视口里。 */
      '.Modal,.Modal-wrapper>*,[role="dialog"],.Drawer,.Drawer-inner{',
        'top:0!important;transform:none!important;',
        'max-height:100%!important;overflow-y:auto!important;overflow-x:hidden!important}',
      '.Modal-closeButton,[class*="Modal-close"],[class*="Drawer-close"]{',
        'position:fixed!important;right:10px!important;top:10px!important;z-index:2147483000!important}',

      /* ---- 去卡片化：窄屏下阴影和圆角没有意义，还占视觉 ---- */
      '.Card,.ContentItem,.List-item{box-shadow:none!important;border-radius:0!important;',
        'background:#fff!important}',   /* 卡片白底 + 容器刷白 = 灰边彻底消失 */
      '.List-item,.ContentItem{border-bottom:1px solid #f0f0f0!important}',

      /* ---- 字号：桌面版 15px 在手机上偏小 ---- */
      CONFIG.bodyFont ? ('.RichText,.RichContent,.ztext{font-size:' + CONFIG.bodyFont +
        'px!important;line-height:1.75!important}') : '',
      '.QuestionHeader-title{font-size:19px!important;line-height:1.45!important}',

      /* ---- 内边距 ----
         窄屏下多层容器各留 12~20px 会叠出 30px+ 的空耗，把外层压到 6px，
         只保留最内层内容容器的 12px 舒适边距 */
      '.Question-mainColumn,.Topstory-mainColumn,.Post-NormalMain,.QuestionHeader-content,',
      '.Post-Main,[class*="Post-Main"],.Post-RichTextContainer,.ColumnPage-main,',
      '.ExploreHomePage-ContentSection{padding-left:' + P + 'px!important;padding-right:' + P + 'px!important}',
      '.Topstory-container,.Topstory-recommend,.Topstory-recommend .List,.Card.List{padding-left:6px!important;padding-right:6px!important}',
      '.TopstoryItem{padding-left:0!important;padding-right:0!important}',
      'header.AppHeader > div{padding-left:' + P + 'px!important;padding-right:' + P + 'px!important}',

      /* ---- 自适应留白 ---- */
      '@media (max-width:400px){.QuestionHeader-title{font-size:18px!important}}'
    ].join('');
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. JS 宽度修复器（主力）
  //    知乎把 1175/1032/694 这些宽度硬编码在 emotion 原子类里，
  //    CSS 选择器追不上改版，只能按「计算后的实际宽度」来收拾。
  // ═══════════════════════════════════════════════════════════════
  var SKIP_TAGS = { SVG:1, PATH:1, G:1, CIRCLE:1, RECT:1, DEFS:1, LINE:1,
                    POLYGON:1, CANVAS:1, BR:1, NOSCRIPT:1, SCRIPT:1, STYLE:1, META:1, LINK:1 };

  function isFixed(cs) { return cs.position === 'fixed' || cs.position === 'sticky'; }

  // 有意的横向滚动容器（代码块、表格、轮播轨道）里的宽元素不能压，
  // 否则内容会挤成一坨。给整棵子树打标记，后面用 O(1) 的 hasAttribute 判断。
  function markScrollables() {
    if (!document.body) return 0;
    var els = document.body.querySelectorAll('*');
    var n = 0;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.hasAttribute('data-zskip')) continue;
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (!cs) continue;
      var ox = cs.overflowX;
      if (ox !== 'auto' && ox !== 'scroll') continue;
      el.setAttribute('data-zskip', '1');
      var sub = el.querySelectorAll('*');
      for (var j = 0; j < sub.length; j++) sub[j].setAttribute('data-zskip', '1');
      n++;
    }
    return n;
  }

  function applyFix(el, cs, base) {
    el.style.setProperty('max-width', '100%', 'important');
    el.style.setProperty('box-sizing', 'border-box', 'important');
    if (parseFloat(cs.minWidth) > base) el.style.setProperty('min-width', '0', 'important');
    // 显式 px 宽度 / flex-basis 写死的，光有 max-width 不够，得直接改
    if (/px$/.test(cs.width) && parseFloat(cs.width) > base) {
      el.style.setProperty('width', '100%', 'important');
    }
    if (/px$/.test(cs.flexBasis) && parseFloat(cs.flexBasis) > base) {
      el.style.setProperty('flex-basis', 'auto', 'important');
    }
    if (cs.flexShrink === '0') el.style.setProperty('flex-shrink', '1', 'important');
    // 负 margin 是知乎做通栏的常见手法，会把内容顶出去
    var ml = parseFloat(cs.marginLeft), mr = parseFloat(cs.marginRight);
    if (ml < 0 || mr < 0) {
      el.style.setProperty('margin-left', '0', 'important');
      el.style.setProperty('margin-right', '0', 'important');
    }
  }

  /**
   * 宽度修复主循环。
   * 读写分离：先整批读 offsetWidth（只触发一次 reflow），再整批写 style，
   * 然后重复若干轮让「父先收缩、子跟着收缩」逐层收敛。
   * 注意用 offsetWidth 而不是 getBoundingClientRect —— 后者在 zoom 下返回放大后的坐标。
   */
  function fixWidths(root, rounds) {
    if (!document.body) return 0;
    var base = S.BASE;
    var total = 0;
    rounds = rounds || 3;

    for (var r = 0; r < rounds; r++) {
      var nodes = (root || document.body).querySelectorAll('*');
      var n = nodes.length;
      var widths = new Array(n);

      // ① 只读一遍宽度
      for (var i = 0; i < n; i++) widths[i] = nodes[i].offsetWidth;

      // ② 只对超宽的做决策（getComputedStyle 很贵，能省则省）
      var batch = [];
      for (var i = 0; i < n; i++) {
        var el = nodes[i];
        if (SKIP_TAGS[el.tagName]) continue;
        if (widths[i] <= base + 1) continue;
        if (el.hasAttribute('data-zskip')) continue;
        var cs;
        try { cs = getComputedStyle(el); } catch (e) { continue; }
        if (!cs || cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (isFixed(cs)) continue;                       // 悬浮层另有处理
        batch.push([el, cs]);
      }
      if (!batch.length) break;

      // ③ 统一写
      for (var i = 0; i < batch.length; i++) applyFix(batch[i][0], batch[i][1], base);
      total += batch.length;
    }
    return total;
  }

  // 处理 position:fixed / sticky 的悬浮层（坐标系不同，单独量）
  function fixFixedLayers() {
    if (!document.body) return 0;
    var base = S.BASE, fixed = 0;
    var nodes = document.body.querySelectorAll('*');
    for (var i = 0, n = Math.min(nodes.length, CONFIG.maxScan); i < n; i++) {
      var el = nodes[i];
      if (SKIP_TAGS[el.tagName]) continue;
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (!cs || cs.display === 'none') continue;
      if (!isFixed(cs)) continue;
      // 屏幕外的（负 left / 藏在右侧）不管
      var r = el.getBoundingClientRect();
      var w = r.width / S.Z;                  // 折算回基准坐标系
      if (w > base + 1) {
        el.style.setProperty('max-width', '100%', 'important');
        el.style.setProperty('box-sizing', 'border-box', 'important');
        fixed++;
      }
      if (r.left / S.Z < -2 || r.right / S.Z > base + 2) {
        // 横向跑出去了：拉回可视范围
        el.style.setProperty('left', '0', 'important');
        el.style.setProperty('right', '0', 'important');
        el.style.setProperty('margin-left', 'auto', 'important');
        el.style.setProperty('margin-right', 'auto', 'important');
      }
    }
    return fixed;
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. 顶栏自适应裁剪
  //    393px 装不下 logo + 7 个导航 + 搜索框 + 登录。
  //    做法：让顶栏换行，导航按实测宽度保留前 N 个，其余收起。
  // ═══════════════════════════════════════════════════════════════
  function fitHeader() {
    if (!CONFIG.fitHeader || !document.body) return;
    var hd = document.querySelector('header.AppHeader');
    if (!hd) return;

    var avail = S.BASE - CONFIG.sidePadding * 2 - 64;   // 扣掉 logo 与左右留白
    var nav = hd.querySelector('nav');
    if (nav) {
      // 让导航的父容器可以换行：超宽的搜索区会掉到第二行
      var wrap = nav.parentElement;
      if (wrap && wrap !== hd) {
        wrap.style.setProperty('flex-wrap', 'wrap', 'important');
        wrap.style.setProperty('min-width', '0', 'important');
      }
      if (wrap && wrap.parentElement && wrap.parentElement !== hd) {
        wrap.parentElement.style.setProperty('flex-wrap', 'wrap', 'important');
        wrap.parentElement.style.setProperty('min-width', '0', 'important');
      }
      nav.style.setProperty('max-width', '100%', 'important');
      nav.style.setProperty('min-width', '0', 'important');

      // 从前往后累加，放不下的整段收起
      var items = Array.prototype.slice.call(nav.children);
      items.forEach(function (it) { it.style.removeProperty('display'); });
      var used = 0, cut = false;
      for (var i = 0; i < items.length; i++) {
        used += items[i].offsetWidth || 0;
        if (!cut && used > avail) {
          for (var j = i; j < items.length; j++) {
            items[j].style.setProperty('display', 'none', 'important');
          }
          cut = true;
        }
      }
    }

    var sb = hd.querySelector('.SearchBar');
    if (sb) {
      sb.style.setProperty('flex', '1 1 100px', 'important');
      sb.style.setProperty('min-width', '0', 'important');
      sb.style.setProperty('max-width', '100%', 'important');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 5.5 两栏布局处理（专栏页等）
  //     知乎专栏页是「主列 + 右侧栏」两栏，窄屏下侧栏会把正文挤成一条。
  //     这里不依赖类名（知乎改版就失效），而是按「同一行、左主右辅」的
  //     结构识别：左边那个文本量大的当主列，右边那个当侧栏。
  //     注意按 left 位置而非宽度判断 —— 正文被挤窄时它反而更窄。
  // ═══════════════════════════════════════════════════════════════
  function fitColumns() {
    var mode = CONFIG.sideColumn;
    if (mode === 'keep' || !document.body || !CONFIG.hideSidebar) return 0;
    var base = S.BASE;
    var all = document.body.querySelectorAll('*');
    var n = Math.min(all.length, CONFIG.maxScan);
    var done = 0;

    for (var i = 0; i < n && done < 6; i++) {
      var box = all[i];
      var bw = box.offsetWidth;
      if (bw < base * 0.6) continue;          // 只看够宽的容器
      var kids = box.children;
      if (kids.length < 2 || kids.length > 8) continue;
      // 深度上限：页面的两栏骨架永远在浅层，卡片、列表项内部的元素深度都在
      // 10 以上。没有这条约束，发现页卡片里的「内容 + 标签行」会被当成
      // 两栏，标签行（回答281 赞同35 评论）被当成侧栏删掉。
      var dp = 0, pk = box;
      while (pk && pk !== document.body) { dp++; pk = pk.parentElement; }
      if (dp > CONFIG.maxColumnDepth) continue;

      // 收集块级、可见、有宽度的子元素
      var row = [];
      for (var k = 0; k < kids.length; k++) {
        var el = kids[k];
        var cs;
        try { cs = getComputedStyle(el); } catch (e) { continue; }
        if (!cs || cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (cs.display === 'inline' || cs.display === 'inline-block') continue;
        if (cs.position === 'fixed' || cs.position === 'absolute') continue;
        var w = el.offsetWidth;
        if (w < 60) continue;
        var r = el.getBoundingClientRect();
        row.push({ el: el, w: w, left: r.left / S.Z, top: r.top / S.Z,
                   txt: (el.innerText || '').length, cs: cs });
      }
      if (row.length < 2) continue;

      // 取 top 相近（同一行）里元素最多的那组
      var best = [], grp;
      for (var a = 0; a < row.length; a++) {
        grp = [row[a]];
        for (var b = 0; b < row.length; b++) {
          if (b === a) continue;
          if (Math.abs(row[b].top - row[a].top) <= 40) grp.push(row[b]);
        }
        if (grp.length > best.length) best = grp;
      }
      if (best.length < 2) continue;

      best.sort(function (x, y) { return x.left - y.left; });
      var main = best[0], side = best[best.length - 1];
      if (main.el === side.el) continue;

      // 侧栏得占够比例才处理（小挂件不是侧栏）
      if (side.w < bw * 0.2) continue;
      // 反过来也成立：占了大半个容器的那不是侧栏，是主内容
      if (side.w > bw * 0.55) continue;
      // 侧栏通常顶到容器右边缘；卡片里那种紧跟在文字后面的小标签不是
      if (side.left + side.w < bw * 0.7) continue;
      // 主列文本量应多于侧栏，避免把辅助栏误判成主列
      if (main.txt < side.txt) continue;
      // 主列至少得有点内容
      if (main.txt < 300) continue;

      // 主列撑满
      main.el.style.setProperty('flex', '1 1 auto', 'important');
      main.el.style.setProperty('width', '100%', 'important');
      main.el.style.setProperty('min-width', '0', 'important');
      main.el.style.setProperty('max-width', '100%', 'important');
      main.el.style.setProperty('box-sizing', 'border-box', 'important');

      if (mode === 'hide') {
        side.el.style.setProperty('display', 'none', 'important');
      } else {
        // 移到底部：父容器允许换行，侧栏独占一整行
        var bcs = getComputedStyle(box);
        if (bcs.display === 'grid' || bcs.display === 'inline-grid') {
          box.style.setProperty('grid-template-columns', '1fr', 'important');
        } else {
          box.style.setProperty('display', 'flex', 'important');
          box.style.setProperty('flex-wrap', 'wrap', 'important');
        }
        side.el.style.setProperty('flex', '1 1 100%', 'important');
        side.el.style.setProperty('width', '100%', 'important');
        side.el.style.setProperty('min-width', '0', 'important');
        side.el.style.setProperty('max-width', '100%', 'important');
        side.el.style.setProperty('margin-top', '16px', 'important');
        side.el.style.setProperty('box-sizing', 'border-box', 'important');
      }
      done++;
    }
    if (done) log('两栏布局处理 ' + done + ' 处（右侧栏 → ' +
                  (mode === 'hide' ? '隐藏' : '底部') + '）');
    return done;
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. vh / vw 单位修正
  //    zoom 之后 100vh = layout viewport 高度（约 2130px），
  //    在 393 的布局里等于 5 个屏幕高，弹窗会直接顶飞。
  // ═══════════════════════════════════════════════════════════════
  // 用 CSS 变量而不是把数值写死：文本替换只能做一次，旋屏后旧的 px 值无法还原。
  // 换成 calc(N * var(--zf-vw)) 之后，方向变化只要更新变量值即可，无需重扫。
  var VVAR_ID = 'zf-vunits-vars';
  function setVUnitVars() {
    if (!CONFIG.fixVUnits) return;
    var css = ':root{' +
      '--zf-vw:' + (S.BASE / 100).toFixed(4) + 'px;' +
      '--zf-vh:' + (S.VH / 100).toFixed(4) + 'px;' +
      '}';
    injectStyle(css, VVAR_ID);
  }

  function fixViewportUnits() {
    if (!CONFIG.fixVUnits) return 0;
    var reVw = /(-?\d*\.?\d+)vw/g;
    var reVh = /(-?\d*\.?\d+)vh/g;
    var count = 0;
    var sheets = document.styleSheets;

    for (var i = 0; i < sheets.length; i++) {
      var rules;
      try { rules = sheets[i].cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) {
        var r = rules[j];
        if (!r || !r.style) continue;
        for (var k = 0; k < r.style.length; k++) {
          var prop = r.style[k];
          var val = r.style.getPropertyValue(prop);
          if (val.indexOf('vw') < 0 && val.indexOf('vh') < 0) continue;
          if (val.indexOf('--zf-v') >= 0) continue;      // 已处理过
          var nv = val.replace(reVw, function (m, num) {
            return 'calc(' + num + ' * var(--zf-vw))';
          }).replace(reVh, function (m, num) {
            return 'calc(' + num + ' * var(--zf-vh))';
          });
          if (nv === val) continue;
          try {
            r.style.setProperty(prop, nv, r.style.getPropertyPriority(prop));
            count++;
          } catch (e) {}
        }
      }
    }

    if (count) log('视口单位修正 ' + count + ' 条 → 1vw=' + (S.BASE / 100).toFixed(2) +
                   'px, 1vh=' + (S.VH / 100).toFixed(2) + 'px (CSS 变量)');
    return count;
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. 表格包装（table 直接 display:block 会让列彻底塌掉）
  // ═══════════════════════════════════════════════════════════════
  function wrapTables() {
    var tables = document.querySelectorAll('.RichText table,.RichContent table,.ztext table,table');
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      var p = t.parentElement;
      if (p && p.hasAttribute && p.hasAttribute('data-zfit-table')) continue;
      var d = document.createElement('div');
      d.setAttribute('data-zfit-table', '1');
      d.setAttribute('data-zfit-skip', '1');
      d.style.cssText = 'max-width:100%!important;overflow-x:auto!important;-webkit-overflow-scrolling:touch;';
      p.insertBefore(d, t);
      d.appendChild(t);
      t.style.setProperty('display', 'table', 'important');
      t.style.setProperty('width', 'auto', 'important');
      t.style.setProperty('min-width', '100%', 'important');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 8. 一次性适配流程
  // ═══════════════════════════════════════════════════════════════
  var applied = 0;

  // 任何一步出错都不能让整条适配链断掉
  // ═══════════════════════════════════════════════════════════════
  // 5.6 flex / grid 行崩塌修复
  //
  //     场景（真机专栏页实测）：flex 容器里一排 item 都有硬编码宽度。
  //     fixWidths 只处理「超宽」的那个（把它的 min-width 清零、允许收缩），
  //     其余兄弟的 min-width 原样保留。于是收缩时压力全落在唯一被解锁的
  //     那个 item 身上 —— 正文从 694px 被压到 16px，正文区只剩 24px。
  //
  //     判据：容器里存在「内容很多（txt>=200）但被压得很窄（< 容器 30%）」
  //     的 item。这个组合只会出现在被压塌的内容块上，顶栏图标、导航条
  //     因为文本量不够不会被误伤。
  //
  //     处理：容器改成换行，内容块各占一整行。手机上本就该纵向堆叠，
  //     横向硬挤 7 列没有任何意义。
  //
  //     必须放在 fixWidths 之后 —— 崩塌是它造成的，得先发生才能检测到。
  // ═══════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════
  // 5.7 按位置去掉右侧栏（类名兜底）
  //
  //     类名选择器盖不全：现代知乎大量用 emotion 哈希类名，真机专栏页
  //     实测「侧栏候选（按类名）命中 0 个」——一个 SideColumn 都没有。
  //     所以再补一层按位置的判断：从正文出发，把「在正文右边、和正文
  //     垂直重叠、有实质内容、但比正文短」的兄弟元素去掉。
  //
  //     四条判据一起用，误伤风险很低：顶栏图标太窄、评论区在正文下方
  //     不重叠、比正文长的只能是真的主内容。
  // ═══════════════════════════════════════════════════════════════
  function findMainContent() {
    var sels = ['article.Post-Main', '.Post-Main', '.Post-NormalMain',
                '.Question-main', '.Question-mainColumn', '.Topstory-mainColumn',
                '.Post-content', '.RichText', 'article', 'main'];
    for (var i = 0; i < sels.length; i++) {
      var els;
      try { els = document.querySelectorAll(sels[i]); } catch (e) { continue; }
      for (var j = 0; j < els.length; j++) {
        var el = els[j], cs;
        try { cs = getComputedStyle(el); } catch (e2) { continue; }
        if (!cs || cs.display === 'none' || cs.visibility === 'hidden') continue;
        // 关键：父元素被隐藏时，子元素的 computed display 仍是原值（'block'），
        // 上面的判断漏得掉。而 innerText 对不渲染的元素又会退化成 textContent，
        // 于是「文本够长」也照样成立 —— 两个条件一起失效，就会选中一个
        // 根本不在渲染树里的隐藏节点，它的坐标全是 0，后续所有位置判断全部落空。
        // getClientRects() 是唯一可靠的「真在渲染」判据。
        if (!el.getClientRects().length) continue;
        if (el.offsetWidth < 40) continue;
        if ((el.innerText || '').trim().length < 300) continue;
        return el;
      }
    }
    return null;
  }

  function hideRightRail() {
    if (!CONFIG.hideRightRail || CONFIG.sideColumn !== 'hide' || !document.body) return 0;
    var main = findMainContent();
    if (!main) return 0;

    var mr = main.getBoundingClientRect();
    var mRight = (mr.left + mr.width) / S.Z;
    var mTop = mr.top / S.Z;
    var mBot = mTop + main.offsetHeight;
    var mTxt = (main.innerText || '').trim().length;
    var hidden = 0;

    var probe = main;
    for (var d = 0; d < 5 && probe; d++) {
      var pa = probe.parentElement;
      if (!pa || pa === document.body || pa === document.documentElement) break;
      for (var k = 0; k < pa.children.length && k < 12; k++) {
        var sib = pa.children[k];
        if (sib === probe || sib.contains(main)) continue;
        var cs;
        try { cs = getComputedStyle(sib); } catch (e) { continue; }
        if (!cs || cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (cs.position === 'fixed' || cs.position === 'absolute') continue;
        var w = sib.offsetWidth;
        if (w < 100) continue;                                    // 小挂件不是侧栏
        if (sib.hasAttribute('data-zskip')) continue;

        var r = sib.getBoundingClientRect();
        var left = r.left / S.Z;
        if (left < mRight - 10) continue;                          // 不在正文右侧
        var top = r.top / S.Z;
        if (top > mBot || top + sib.offsetHeight < mTop) continue; // 垂直不重叠
        var txt = (sib.innerText || '').trim().length;
        if (txt >= mTxt) continue;                                 // 比正文长，不可能是侧栏

        sib.style.setProperty('display', 'none', 'important');
        sib.setAttribute('data-zrail', '1');      // 打标记，方便诊断时区分是谁干的
        log('右侧栏@' + d + '层 <' + sib.tagName.toLowerCase() + '> .' +
            String(sib.className || '').slice(0, 30) +
            ' | 宽=' + w + ' left=' + Math.round(left) + ' 正文右边界=' + Math.round(mRight) +
            ' | txt=' + txt + '(正文 ' + mTxt + ')');
        hidden++;
        if (hidden >= 8) break;
      }
      if (hidden >= 8) break;
      probe = pa;
    }
    if (hidden) log('按位置去掉右侧栏 ' + hidden + ' 处');
    return hidden;
  }

  // ═══════════════════════════════════════════════════════════════
  // 5.8 弹层：返回键关闭
  //
  //     知乎的「展开其他 N 条回复」会弹出一个层，这个层通常没有可用的
  //     关闭方式，按手机返回键又会直接退出整个页面。
  //
  //     做法：监听 popstate —— 如果此时有弹层开着，先关掉它，再用
  //     pushState 把历史顶回去，页面就不会真的后退。没弹层时不干预，
  //     返回键行为完全正常。
  //
  //     检测弹层不依赖类名（同样是哈希类名的问题）：fixed/absolute +
  //     覆盖大部分屏幕 + 可见 + z-index 最高。脚本自己的角标尺寸太小，
  //     会被过滤掉。
  // ═══════════════════════════════════════════════════════════════
  // 收集所有「够格当弹层」的元素。minArea 越小越宽松：
  //   0.55×0.35 = 常规判据；返回键那一刻会用 0.85×0.5 的宽松档再兜一次。
  function collectLayers(minW, minH) {
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    var out = [];
    if (!vw || !vh || !document.body) return out;
    var all = document.body.querySelectorAll('*');
    var n = Math.min(all.length, CONFIG.maxScan);

    for (var i = 0; i < n; i++) {
      var el = all[i];
      if (el.id === 'zhihu-mobile-badge' || el.id === 'zf-modal-close') continue;
      // 注意：这里只跳过「被我们强制隐藏过的层」(data-zhidden)，
      // 不能跳过 markScrollables 打的 data-zskip —— 否则凡是带 overflow 滚动的
      // 浮层（评论层常见 overflow-y:auto → 计算值 overflow-x 也变 auto，被误标）
      // 一旦在加载期被打上标记，之后以 class/属性切换显示的弹层就永远检测不到，
      // 缓冲历史压不进去，系统返回键会直接退出页面而不是关弹层。
      if (el.hasAttribute('data-zhidden')) continue;
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (!cs) continue;
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (parseFloat(cs.opacity) < 0.15) continue;
      var r = el.getBoundingClientRect();
      if (r.width < vw * minW || r.height < vh * minH) continue;
      var z = parseInt(cs.zIndex, 10);
      out.push({ el: el, z: isNaN(z) ? 0 : z, w: r.width, h: r.height, top: r.top });
    }
    return out;
  }

  // 给候选层打分：有内容、有交互的才是「弹层本体」，
  // 纯半透明遮罩（backdrop）通常和内容层同级同 z-index、且插入更早 ——
  // 老逻辑「取 z-index 最高的」会挑中它，结果点了没反应、移除也白搭。
  function layerScore(c) {
    var el = c.el, s = 0;
    var txt = '';
    try { txt = (el.innerText || '').trim(); } catch (e) {}
    if (txt.length > 0) s += 100;
    if (txt.length > 40) s += 50;
    // 内容层里通常有按钮/输入框，遮罩里没有
    try {
      var inter = el.querySelectorAll('button,a,input,textarea,[role="button"]').length;
      s += Math.min(inter, 15);
    } catch (e2) {}
    return s;
  }

  function findOpenModal() {
    var cands = collectLayers(0.55, 0.35);
    if (!cands.length) return null;
    var best = null, bestScore = -1, bestZ = -1;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i], sc = layerScore(c);
      if (sc > bestScore || (sc === bestScore && c.z > bestZ)) {
        best = c.el; bestScore = sc; bestZ = c.z;
      }
    }
    return best;
  }

  // 返回键专用：常规判据没命中时的兜底 —— 覆盖 85% 宽 × 50% 高，
  // 且带可见文字（纯 loading 遮罩、纯背景层不算，避免吞掉正常返回）
  function findOpenModalLoose() {
    var m = findOpenModal();
    if (m) return m;
    var cands = collectLayers(0.85, 0.5);
    for (var i = 0; i < cands.length; i++) {
      var t = '';
      try { t = (cands[i].el.innerText || '').trim(); } catch (e) {}
      if (t.length >= 15) return cands[i].el;
    }
    return null;
  }

  // 找到弹层的「关闭按钮」：优先用强信号（aria / text / class），
  // 都找不到再退回几何（最靠上、贴边、尺寸像关闭键的小元素——
  // 这正是桌面版评论层那个被顶出屏幕、还没有任何 close 关键字的 X 图标）。
  function findCloseButton(m, strict) {
    if (!m) return null;
    var vh = document.documentElement.clientHeight || 0;
    var vw = document.documentElement.clientWidth || 0;
    var sel = ['.Modal-closeButton', '[class*="Modal-close"]', '[class*="modal-close"]',
               '[class*="ModalClose"]', '[class*="CloseButton"]', '[class*="closeButton"]',
               '[class*="Drawer-close"]', '[class*="close-icon"]', '[class*="closeIcon"]',
               '[class*="close-x"]', '[class*="Close"]', '[class*="close"]',
               'button[aria-label="关闭"]', '[aria-label="关闭"]', '[aria-label="收起"]',
               '[aria-label="close"]', 'button[title="关闭"]', '[title="关闭"]'];
    var pools = [m];
    if (m.parentNode) pools.push(m.parentNode);
    // 1) 强信号：选择器
    for (var p = 0; p < pools.length; p++) {
      var host = pools[p];
      if (!host || !host.querySelectorAll) continue;
      for (var i = 0; i < sel.length; i++) {
        var els;
        try { els = host.querySelectorAll(sel[i]); } catch (e) { continue; }
        for (var j = 0; j < els.length; j++) {
          var b = els[j], bcs;
          try { bcs = getComputedStyle(b); } catch (e2) { continue; }
          if (bcs.display === 'none' || bcs.visibility === 'hidden') continue;
          var br = b.getBoundingClientRect();
          if (br.width < 1 || br.height < 1) continue;
          return b;
        }
      }
      // 2) 强信号：textContent / aria-label 命中「✕ / 关闭 / 收起 / close」
      var btns;
      try { btns = host.querySelectorAll('button,a,[role="button"],svg'); } catch (e3) { btns = []; }
      for (var k = 0; k < btns.length; k++) {
        var el = btns[k], t = '';
        try { t = (el.getAttribute('aria-label') || el.textContent || '').trim(); } catch (e4) {}
        if (/^(✕|×|x|关闭|收起|close)$/i.test(t) || t.indexOf('关闭') >= 0 || t.indexOf('收起') >= 0) {
          var ec;
          try { ec = getComputedStyle(el); } catch (e5) { continue; }
          if (ec.display === 'none' || ec.visibility === 'hidden') continue;
          var er = el.getBoundingClientRect();
          if (er.width < 1 || er.height < 1) continue;
          return el;
        }
      }
    }
    // 3) 几何兜底：弹层里最靠上（top 最小）、贴边、尺寸像关闭键的小元素
    //    （strict 模式不走到这——避免拿几何结果去"点"，误触回复之类的按钮）
    if (strict) return null;
    var cand = null, candTop = 1e9;
    var all;
    try { all = m.querySelectorAll('button,a,svg,[role="button"]'); } catch (e6) { return null; }
    for (var q = 0; q < all.length; q++) {
      var c = all[q], ccs;
      try { ccs = getComputedStyle(c); } catch (e7) { continue; }
      if (ccs.display === 'none' || ccs.visibility === 'hidden') continue;
      var cr = c.getBoundingClientRect();
      if (cr.width < 12 || cr.width > 90 || cr.height < 12 || cr.height > 90) continue;
      if (cr.top > vh * 0.35) continue;            // 只关心顶部区域
      var nearEdge = (cr.left < vw * 0.4) || (cr.right > vw * 0.6);
      if (!nearEdge && cr.top >= 0) continue;       // 视口内又不贴边的不算
      if (cr.top < candTop) { candTop = cr.top; cand = c; }
    }
    return cand;
  }

  // 弹层归位：桌面版弹层居中 + 超高时，上半截（含关闭按钮）会跑到屏幕外，
  // 用户就「关不掉」了。这里把越界的弹层拉回视口顶部并限高内部滚动；
  // 若弹层本体没越界、但关闭按钮被内层相对定位的层顶出去了
  // （真实知乎评论层：本体 fixed 满屏不越界，内容层却 relative top:-620），
  // 则把「关闭按钮 → 弹层本体」之间所有负 top 的相对/绝对祖先拉回正常流，
  // 关闭按钮随之回到弹层顶部、在弹层内可见可点。
  function normalizeLayer(m) {
    if (!m) return;
    var vh = document.documentElement.clientHeight;
    var vw = document.documentElement.clientWidth;
    if (!vh || !vw) return;
    var r = m.getBoundingClientRect();
    var cs;
    try { cs = getComputedStyle(m); } catch (e) { return; }

    var bodyOut = !(r.top >= -2 && r.height <= vh + 4 && r.left >= -2 &&
                    r.width <= vw + 4 && cs.transform === 'none');

    var closeBtn = findCloseButton(m);
    var closeOut = false;
    if (closeBtn) {
      var cr = closeBtn.getBoundingClientRect();
      closeOut = (cr.bottom < 0 || cr.top > vh || cr.right < 0 || cr.left > vw);
    }

    // 本体没越界、关闭按钮也在视口内 → 一切正常，不打扰
    if (!bodyOut && !closeOut) return;

    // 1) 弹层本体越界：旧归位逻辑（兼容居中超高弹层）
    if (bodyOut) {
      var st = m.style;
      st.setProperty('top', '0px', 'important');
      st.setProperty('transform', 'none', 'important');
      st.setProperty('margin', '0 auto', 'important');
      st.setProperty('max-height', vh + 'px', 'important');
      st.setProperty('overflow-y', 'auto', 'important');
      st.setProperty('overflow-x', 'hidden', 'important');
      if (cs.position === 'absolute') {
        // absolute 弹层的定位基准未必是视口，改 fixed 才保证贴住屏幕
        st.setProperty('position', 'fixed', 'important');
        st.setProperty('left', '0', 'important');
        st.setProperty('right', '0', 'important');
      }
      log('弹层：本体越界归位（原 top=' + Math.round(r.top) + ' 高=' + Math.round(r.height) + '）');
    }

    // 2) 关闭按钮被内层负偏移顶出屏幕：把「关闭按钮 → 弹层本体」之间
    //    所有负 top 的相对/绝对祖先拉回正常流，内容便从顶部流入本体滚动容器，
    //    关闭按钮也随之回到弹层顶部、在弹层内可见可点。
    //    （不把按钮单独钉成 fixed：那样会被困在弹层堆叠上下文里，
    //      永远低于根层的覆盖物，反而点不到。）
    if (closeOut && closeBtn) {
      var a = closeBtn.parentElement, fixedAny = false;
      while (a && a !== m && a !== document.body) {
        var acs;
        try { acs = getComputedStyle(a); } catch (e2) { break; }
        if (acs.position === 'relative' || acs.position === 'absolute') {
          var topVal = parseFloat(acs.top);
          if (!isNaN(topVal) && topVal < 0) {
            a.style.setProperty('position', 'static', 'important');
            a.style.setProperty('top', 'auto', 'important');
            a.style.setProperty('transform', 'none', 'important');
            fixedAny = true;
          }
        }
        a = a.parentElement;
      }
      if (fixedAny) log('弹层：内层负偏移归位（关闭按钮拉回视口）');
    }
  }

  function fireEsc(m) {
    try {
      var opt = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
      (m || document.body).dispatchEvent(new KeyboardEvent('keydown', opt));
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', opt));
      document.dispatchEvent(new KeyboardEvent('keydown', opt));
    } catch (e) { /* 忽略 */ }
  }

  function clickCloseButton(m) {
    var btnSels = ['.Modal-closeButton', '[class*="Modal-close"]', '[class*="modal-close"]',
                   '[class*="ModalClose"]', '[class*="CloseButton"]', '[class*="closeButton"]',
                   '[class*="Drawer-close"]', '[class*="close-icon"]', '[class*="closeIcon"]',
                   'button[aria-label="关闭"]', '[aria-label="关闭"]', '[aria-label="收起"]',
                   'button[title="关闭"]'];
    var pools = [m];
    // 有些弹层的关闭按钮挂在兄弟节点或 portal 的另一支上，光搜弹层内部会漏
    if (m && m.parentNode) pools.push(m.parentNode);
    for (var p = 0; p < pools.length; p++) {
      var host = pools[p];
      if (!host || !host.querySelectorAll) continue;
      for (var i = 0; i < btnSels.length; i++) {
        var btns;
        try { btns = host.querySelectorAll(btnSels[i]); } catch (e) { continue; }
        for (var j = 0; j < btns.length; j++) {
          var b = btns[j], bcs;
          try { bcs = getComputedStyle(b); } catch (e2) { continue; }
          if (bcs.display === 'none' || bcs.visibility === 'hidden') continue;
          var br = b.getBoundingClientRect();
          if (br.width < 1 || br.height < 1) continue;
          b.click();
          log('弹层：点了关闭按钮（' + btnSels[i] + '）');
          return true;
        }
      }
    }
    // 类选择器都没命中时，退回「语义强信号」定位（aria/text 含 关闭/收起 的按钮）。
    // 真实知乎评论层的 X 没有 close 类名，但弹层里通常有「✕ 关闭」按钮——
    // 点它能触发知乎自己的关闭逻辑，比 forceHide(display:none) 更稳（React 不一定镇得住 none）。
    var fb = findCloseButton(m, true);
    if (fb) {
      fb.click();
      log('弹层：点了关闭按钮（语义兜底）');
      return true;
    }
    return false;
  }

  // 兜底：把所有够格的浮层直接藏掉，并解开知乎加的滚动锁
  // （弹层打开时知乎会给 body/html 上 overflow:hidden，不解锁的话关了也滑不动）
  function forceHideLayers() {
    var cands = collectLayers(0.5, 0.3);
    var n = 0;
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i].el;
      try {
        el.style.setProperty('display', 'none', 'important');
        el.setAttribute('data-zhidden', '1');
        n++;
      } catch (e) { /* 忽略 */ }
    }
    try {
      var de = document.documentElement, bd = document.body;
      if (de) de.style.removeProperty('overflow');
      if (bd) { bd.style.removeProperty('overflow'); bd.style.removeProperty('position'); }
    } catch (e2) {}
    log('弹层：兜底隐藏 ' + n + ' 层');
    return n > 0;
  }

  // 每一步做完都必须复核 —— 老版本「点一下就算成功」，
  // 碰到 React 不响应 click、按钮在视口外等情形就永远关不掉。
  function closeTopModal() {
    var m = findOpenModal();
    if (!m) return false;
    normalizeLayer(m);

    var ok = false;
    if (clickCloseButton(m) && !findOpenModal()) { log('弹层：关闭按钮生效'); ok = true; }
    if (!ok) {
      fireEsc(m);
      if (!findOpenModal()) { log('弹层：ESC 关闭'); ok = true; }
    }
    if (!ok) ok = forceHideLayers();

    // 兜底按钮自己收尾：forceHide 只改 style，不触发 childList 观察器，
    // 不在这里摘掉的话它会一直挂在屏幕上
    if (ok) {
      var zb = document.getElementById('zf-modal-close');
      if (zb) { try { zb.remove(); } catch (e) {} }
    }
    return ok;
  }

  var modalBackReady = false;
  var smbRetrying = false;
  function setupModalBack() {
    if (!CONFIG.modalBackClose) return;
    if (modalBackReady) return;
    // 真实站点（知乎等）页面生命周期很乱：applyAll 有时在 document.body 还没就绪
    // 时被调用（如客户端路由切换、整页重渲染的瞬间），此时若直接 return，等到用户
    // 真正点开评论弹层时，这一轮 setupModalBack 早就被「跳过」了——缓冲历史永远压不
    // 进去，系统返回键就直接退出页面。所以 body 没好就定时重试，直到就绪为止。
    if (!document.body) {
      if (!smbRetrying) {
        smbRetrying = true;
        setTimeout(function () { smbRetrying = false; setupModalBack(); }, 60);
      }
      return;
    }
    modalBackReady = true;

    var pushed = false;   // 我们压进去的「缓冲历史」还在不在栈顶
    var silent = false;   // 正在做静默 back（清理缓冲历史），别当成用户按了返回

    // ── 核心思路：弹层一出现就先压一条历史当缓冲 ──
    //
    //   用户按返回时，消费掉的是这条缓冲，而缓冲的地址和当前完全一样，
    //   所以 URL 自始至终没变，页面不会跳走。
    //
    //   一开始的做法是「等 popstate 再 pushState 把历史顶回去」，那是错的：
    //   popstate 触发时 location.href 已经变成后退后的地址了，再 pushState
    //   只是把新地址重复压栈。后果在真机上很明显 —— 从 A 页点进 B 页开弹层，
    //   按返回会直接被送回 A 页，弹层虽然关了但人也走了。
    function onModalOpen() {
      if (pushed) return;
      try {
        history.pushState({ zfModal: 1 }, '', location.href);
        pushed = true;
        log('弹层：压入缓冲历史');
      } catch (e) { /* file:// 或跨域下可能失败，忽略 */ }
    }

    // 弹层自己关掉时把缓冲历史也退掉，否则用户下次按返回会「没反应」
    function onModalGone() {
      if (!pushed) return;
      pushed = false;
      try {
        // 只有栈顶确实是我们压的那条才敢 back，避免误退真实页面
        if (history.state && history.state.zfModal) {
          silent = true;
          history.back();
        }
      } catch (e) { silent = false; }
    }

    // ── 判定一个元素是否是「打开评论」的入口 ──
    //   知乎不同页面评论区的 UI 形态差异极大：
    //     • 问题页/回答页 → 点后弹出 fixed 满屏弹层（collectLayers 能检测）
    //     • 专栏页/文章页 → 内联展开或滚动定位（无 fixed 层，永远检测不到）
    //   所以必须在「点击入口」时就主动压缓冲，不等检测结果。
    //
    //   ⚠ 判据里禁止用 \b（单词边界）：\b 依赖 ASCII 词字符与非词字符的切换，
    //   「评论」前后都是中文/数字时 \b 不成立——v0.7.5 的 /\b评论\b/ 是永远
    //   匹配不到的死代码，专栏页按钮就这样全部漏网。一律用 indexOf / 无边界正则。
    function isCommentTrigger(el) {
      if (!el || el === document) return false;
      var tag = (el.tagName || '').toLowerCase();
      if (!/^(button|a|div|span|li|svg|use|path|img)$/.test(tag)) return false;

      var txt = '';
      try { txt = (el.textContent || el.innerText || '').trim().replace(/\s+/g, ' '); } catch (e) { }
      // ① 短文本含「评论」：「评论」「N 条评论」「写评论」「添加评论」……
      if (txt.length <= 16 && txt.indexOf('评论') >= 0) return true;

      // ② class / id 含 comment（无边界，commentList/Comments-container 都算）
      var cls = (el.className || '').toString();
      var id = el.id || '';
      if (/comment/i.test(cls) || /comment/i.test(id)) return true;

      // ③ aria-label / title 命中
      var label = '';
      try { label = (el.getAttribute('aria-label') || el.getAttribute('title') || ''); } catch (e) { }
      if (label && (label.indexOf('评论') >= 0 || /comment/i.test(label))) return true;

      // ④ svg 图标按钮：自身无文本，看父容器短文本（「N 条评论」等）
      if (tag === 'svg' || tag === 'use' || tag === 'path' || tag === 'img' || txt === '') {
        var p = el.parentElement;
        if (p && p !== document.body) {
          var pt = '';
          try { pt = (p.textContent || p.innerText || '').trim().replace(/\s+/g, ' '); } catch (e2) { }
          if (pt.length <= 20 && pt.indexOf('评论') >= 0) return true;
        }
      }
      return false;
    }

    window.addEventListener('popstate', function () {
      if (silent) { silent = false; pushed = false; return; }

      // 先尝试找浮层弹窗（问题页/回答页的 fixed 评论层）
      var m = findOpenModalLoose();
      if (m) {
        normalizeLayer(m);
        var had = pushed;
        pushed = false;
        closeTopModal();
        if (!had) {
          try { history.pushState({ zfStay: 1 }, '', location.href); } catch (e) {}
        }
        return;
      }

      // 没有浮层 —— 但如果缓冲被消费了，说明是「滚动到内联评论区」这类
      // 无固定层的场景（专栏页/文章页的评论就是内联的，用户直接往下滚就到）。
      // 此时必须阻止浏览器真后退，否则用户会被送离正文页。
      if (pushed) {
        pushed = false;
        log('弹层：无浮层但消耗了缓冲（内联评论），阻止后退');
        try { history.pushState({ zfStay: 1 }, '', location.href); } catch (e) {}
        // 内联评论区的"关闭"语义 ≈ 滚回正文阅读位置
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e2) { }
        return;
      }

      // 既无浮层也无缓冲 → 放行，这是正常的浏览器后退
      pushed = false;
    });

    // 统一检测：找出当前打开的弹层，并按「出现 / 消失」同步缓冲历史与归位。
    // 同一份逻辑驱动两路触发：
    //   ① MutationObserver —— DOM 一变立刻查，低延迟；
    //   ② 持久 setInterval（每 400ms）—— 兜底。
    // 为什么必须有第 ② 路？真实站点里评论层是 React 异步挂载的，挂载后常常
    // 不再产生新的 DOM 变动，于是 observer 只触发在面板稳定之前、抓不到它；
    // 此外页面 JS 上下文偶尔会被重置（定时器被清掉），靠脚本在导航后重新注入
    // 拉起检测。第 ② 路不依赖单次点击或某次 mutation，只要页面还活着就一直查，
    // 专门兜住这两类「一次性时机检测必漏」的场景。
    var lastHad = false;
    function checkModal() {
      var m = findOpenModal();
      var had = !!m;
      if (had && !lastHad) onModalOpen();
      else if (!had && lastHad) onModalGone();
      lastHad = had;
      // 弹层一出现就归位：桌面版居中且超高的弹层，关闭按钮会被顶出屏幕，
      // 用户连「点 ✕」这条路都没有，只能指望返回键
      if (m) normalizeLayer(m);

      var btn = document.getElementById('zf-modal-close');
      if (!m) { if (btn) btn.remove(); return; }
      if (btn) return;

      btn = document.createElement('button');
      btn.id = 'zf-modal-close';
      btn.textContent = '✕ 关闭';
      btn.style.cssText =
        'position:fixed;left:10px;top:10px;z-index:2147483646;' +
        'padding:7px 13px;font-size:14px;font-weight:600;color:#fff;' +
        'background:rgba(0,0,0,.62);border:0;border-radius:16px;';
      btn.onclick = function () { closeTopModal(); btn.remove(); };
      document.body.appendChild(btn);
    }

    // 点击后做两件事：
    //   ① 主动拦截：如果点的是「评论」入口，立刻压缓冲历史（不等浮层检测）；
    //   ② 被动检测：照常跑 checkModal 兜住非点击触发的弹层。
    //   冒泡爬升从 3 层放宽到 6 层：专栏页按钮是 svg/use 图标，点击 target 往往
    //   是 path，到带语义的按钮容器隔了好几层。
    document.addEventListener('click', function (e) {
      var t = e.target;
      for (var d = 0; d < 6 && t && t !== document.body; d++) {
        if (isCommentTrigger(t)) {
          if (!pushed) {
            try {
              history.pushState({ zfModal: 1 }, '', location.href);
              pushed = true;
              log('弹层：点击评论入口，主动压入缓冲历史');
            } catch (err) { }
          }
          break;
        }
        t = t.parentElement || t.parentNode;
      }

      // 被动检测保留（兜住非点击方式打开的弹层，如键盘/快捷键）
      setTimeout(checkModal, 0);
      setTimeout(checkModal, 150);
    }, true);

    // ── 滚动压缓冲（专栏页/文章页内联评论区的正解）──
    //   专栏页的评论区没有浮层、也不需要点按钮——它就长在页面流里，
    //   用户往下滚就"进入"了评论区。此时没有任何 click 可拦截，
    //   唯一的时机信号就是「滚动深度」。滚过一半正文后压入缓冲，
    //   返回键消费缓冲时滚回顶部（≈ 回到正文），而不是退出页面。
    //   ⚠ 边界：
    //   • SPA 路由切换会重置 scrollY → 监听 popstate 前后不能误判，
    //     用 zfMark 标记的「是否我们刚压过」来区分；
    //   • 缓冲消费后立即补一条 zfStay，保证连续两次返回不会漏栈。
    var scrollArmed = true;   // 滚回顶部后重新武装，一次滚动只压一次
    window.addEventListener('scroll', function () {
      if (!scrollArmed) return;
      var y = window.scrollY || window.pageYOffset || 0;
      var ih = document.documentElement.scrollHeight || 1;
      var vh = window.innerHeight || 1;
      // 滚动超过「文档高度 - 一屏」的一半（≈ 进入页面下半部/评论区）就压缓冲
      if (y > Math.max((ih - vh) * 0.5, 600)) {
        if (!pushed) {
          try {
            history.pushState({ zfModal: 1 }, '', location.href);
            pushed = true;
            log('弹层：滚动过深，压入缓冲历史（内联评论区）');
          } catch (e) { return; }
        }
        scrollArmed = false;   // 只压一次，滚回顶部才重新武装
      }
    }, { passive: true });
    // 滚回顶部（含脚本 scrollTo(0) 的"关评论"动作）→ 重新武装
    (function watchTop() {
      setInterval(function () {
        var y = window.scrollY || window.pageYOffset || 0;
        if (y < 100 && !scrollArmed) scrollArmed = true;
      }, 600);
    })();

    if (window.MutationObserver) {
      var lastCheck = 0;
      new MutationObserver(function () {
        var now = Date.now();
        if (now - lastCheck < 150) return;      // findOpenModal 不便宜，节流一下
        lastCheck = now;
        checkModal();
      }).observe(document.body, { childList: true, subtree: true });
    }
    // 持久兜底：只要页面还活着就一直查，迟挂载 / 上下文重置都能兜住
    setInterval(checkModal, 400);
  }

  function fixFlexRows() {
    if (!CONFIG.fixFlexRows || !document.body) return 0;
    var base = S.BASE;
    var nodes = document.body.querySelectorAll('*');
    var n = Math.min(nodes.length, CONFIG.maxScan);
    var done = 0;

    for (var i = 0; i < n; i++) {
      var box = nodes[i];
      if (SKIP_TAGS[box.tagName]) continue;
      var cs;
      try { cs = getComputedStyle(box); } catch (e) { continue; }
      if (!cs) continue;
      var isFlex = cs.display === 'flex' || cs.display === 'inline-flex';
      var isGrid = cs.display === 'grid' || cs.display === 'inline-grid';
      if (!isFlex && !isGrid) continue;
      if (cs.flexWrap === 'wrap' || cs.flexWrap === 'wrap-reverse') continue;
      if (box.hasAttribute('data-zskip')) continue;

      var boxW = box.offsetWidth;
      if (boxW < base * 0.5) continue;
      var kids = box.children;
      if (kids.length < 2) continue;

      // 有没有「内容多却被压得窄」的 item？
      var victim = false;
      var victimEl = null;
      for (var k = 0; k < kids.length && k < 12; k++) {
        var kid = kids[k], kcs;
        try { kcs = getComputedStyle(kid); } catch (e2) { continue; }
        if (!kcs || kcs.display === 'none' || kcs.visibility === 'hidden') continue;
        if (kcs.position === 'fixed' || kcs.position === 'absolute') continue;
        if ((kid.innerText || '').trim().length < 200) continue;   // 不是内容块
        if (kid.offsetWidth >= boxW * 0.3) continue;               // 没被压塌
        victim = true;
        victimEl = kid;
        break;
      }
      if (!victim) continue;

      /* ── 先看这行是不是「主列 + 右侧栏」的两栏结构（v0.5.1 新增）──
         真实专栏页：fixWidths 压缩容器后，正文被固定宽度的右栏挤成窄条，
         走到这里时容器里就是「一宽一窄两个块」。窄的是被挤的主列还是侧栏？
         看文本量：文本多的是正文（被挤了），文本少的是侧栏。这种情况下
         不做 wrap + 撑满（否则侧栏会被撑到正文底部），直接把侧栏藏掉。
         ⚠ 只处理「恰好两个可见块」的行：3 个以上的多列 flex 行不是两栏，
         乱藏会把行里正常的辅助块删掉（flexrow 测试页 7-item 行就栽过）。 */
      var visCount = 0, other = null;
      for (var k2 = 0; k2 < kids.length && k2 < 12; k2++) {
        var oc0;
        try { oc0 = getComputedStyle(kids[k2]); } catch (e4) { continue; }
        if (!oc0 || oc0.display === 'none' || oc0.visibility === 'hidden') continue;
        if (oc0.position === 'fixed' || oc0.position === 'absolute') continue;
        visCount++;
        if (kids[k2] !== victimEl && !other && kids[k2].offsetWidth >= 60) other = kids[k2];
      }
      if (visCount === 2 && other) {
        var vTxt = (victimEl.innerText || '').trim().length;
        var oTxt = (other.innerText || '').trim().length;
        // victim 是文本多的那个 → 它是被挤的正文，另一个就是侧栏
        if (vTxt > oTxt * 2 && vTxt >= 200 && other.offsetWidth >= 100) {
          other.style.setProperty('display', 'none', 'important');
          other.setAttribute('data-zrail', '1');
          log('崩塌行内识别侧栏（文本 ' + oTxt + ' vs 正文 ' + vTxt + '）→ 直接隐藏');
          done++;
          if (done >= 6) break;
          continue;
        }
      }

      if (isGrid) {
        box.style.setProperty('grid-template-columns', '1fr', 'important');
      } else {
        box.style.setProperty('flex-wrap', 'wrap', 'important');
      }
      // 内容块各占一整行；小挂件（图标、按钮）保持原样，不撑满
      for (var v = 0; v < kids.length && v < 12; v++) {
        var el = kids[v], ecs;
        try { ecs = getComputedStyle(el); } catch (e3) { continue; }
        if (!ecs || ecs.display === 'none' || ecs.visibility === 'hidden') continue;
        if (ecs.position === 'fixed' || ecs.position === 'absolute') continue;
        if ((el.innerText || '').trim().length < 200 && el.offsetHeight < 60) continue;
        el.style.setProperty('flex', '1 1 100%', 'important');
        el.style.setProperty('width', '100%', 'important');
        el.style.setProperty('min-width', '0', 'important');
        el.style.setProperty('max-width', '100%', 'important');
        el.style.setProperty('box-sizing', 'border-box', 'important');
      }
      done++;
      if (done >= 6) break;
    }
    if (done) log('flex 行崩塌修复 ' + done + ' 处');
    return done;
  }

  function safe(name, fn) {
    try { return fn(); } catch (e) { log(name + ' 失败', e && e.message); return undefined; }
  }

  function applyAll(deep) {
    compute();
    injectStyle(buildCSS(), 'zhihu-mobile-fix');
    safe('vunitVars', setVUnitVars);

    var t0 = (performance && performance.now) ? performance.now() : Date.now();
    var a = 0, b = 0;
    safe('markScrollables', markScrollables);
    a = safe('fixWidths', function () { return fixWidths(); }) || 0;
    b = safe('fixFixedLayers', fixFixedLayers) || 0;
    safe('fitHeader', fitHeader);
    safe('fitColumns', fitColumns);
    safe('hideRightRail', hideRightRail);
    safe('fixFlexRows', fixFlexRows);
    safe('setupModalBack', setupModalBack);
    safe('wrapTables', wrapTables);
    var t1 = (performance && performance.now) ? performance.now() : Date.now();

    applied++;
    log('第 ' + applied + ' 轮：修正 ' + a + ' 处 + ' + b + ' 个悬浮层，耗时 ' +
        (t1 - t0).toFixed(0) + 'ms，横向溢出 ' + overflowX() + 'px');
  }

  function overflowX() {
    var se = document.scrollingElement || document.documentElement;
    return Math.max(0, se.scrollWidth - se.clientWidth);
  }

  // ═══════════════════════════════════════════════════════════════
  // 9. 状态角标
  // ═══════════════════════════════════════════════════════════════
  var paused = false;
  function drawBadge() {
    if (!CONFIG.debug || !document.body) return;
    var el = document.getElementById('zhihu-mobile-badge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'zhihu-mobile-badge';
      el.style.cssText =
        'position:fixed;top:6px;right:6px;z-index:2147483647;' +
        'background:rgba(0,140,255,.92);color:#fff;padding:3px 7px;' +
        'font:11px/1.5 system-ui,sans-serif;border-radius:4px;' +
        'pointer-events:none;opacity:.92;max-width:60%;text-align:right;';
      el.title = '状态角标（不拦截点击）';
      el.addEventListener('click', function () {
        paused = !paused;
        var st = document.getElementById('zhihu-mobile-fix');
        if (st) st.disabled = paused;
        el.textContent = paused ? '✕ 已暂停' : badgeText();
        el.style.background = paused ? 'rgba(120,120,120,.9)' : 'rgba(0,140,255,.92)';
        if (!paused) applyAll();
      });
      document.body.appendChild(el);
      setTimeout(function () { if (el && !paused) el.style.opacity = '.35'; }, 4000);
    }
    if (!paused) el.textContent = badgeText();
  }
  function badgeText() {
    return '✓ v' + VER + ' ' + S.BASE + 'px' + (S.needZoom ? ' ×' + S.Z.toFixed(2) : '') +
           (overflowX() ? ' 溢出' + overflowX() : '');
  }

  // ═══════════════════════════════════════════════════════════════
  // 10. 启动
  // ═══════════════════════════════════════════════════════════════
  var started = false;
  function boot() {
    if (paused || started) return;
    if (!document.documentElement) { setTimeout(boot, 0); return; }
    started = true;

    // 尽早把 viewport meta 摆正（非桌面模式下这步就能拿到 1:1 视口）
    try {
      var mv = document.querySelector('meta[name="viewport"]');
      if (mv) {
        mv.setAttribute('content',
          'width=' + screenWidth() + ', initial-scale=1, minimum-scale=0.5, maximum-scale=5, user-scalable=yes');
      }
    } catch (e) {}

    applyAll();

    // 轻量刷新：不动 zoom，只收拾新出现的宽元素
    function refresh(deep) {
      if (paused) return;
      safe('refresh', function () {
        fixWidths(null, deep ? 3 : 2);
        fixFixedLayers();
        fitHeader();
        wrapTables();
      });
      safe('badge', drawBadge);
    }

    // SPA 路由 / 懒加载 / 无限滚动
    // 只处理新增节点所在子树，避免每次都全量重扫（那在全屏信息流下会明显掉帧）
    var deb, pending = [];
    if (window.MutationObserver) {
      safe('observer', function () {
        new MutationObserver(function (records) {
          for (var i = 0; i < records.length; i++) {
            var added = records[i].addedNodes;
            for (var j = 0; j < added.length; j++) {
              if (added[j].nodeType === 1) pending.push(added[j]);
            }
          }
          clearTimeout(deb);
          deb = setTimeout(function () {
            if (paused) return;
            var list = pending; pending = [];
            if (!list.length) return;
            var big = false;
            for (var i = 0; i < list.length; i++) {
              // 新增的是大块内容（切页、展开回答）就全量重扫；否则只扫这棵子树
              if (list[i] === document.body || list[i].querySelectorAll('*').length > 120) { big = true; break; }
              safe('sub', function () { fixWidths(list[i], 2); });
            }
            // SPA 切页后必须重跑 hideRightRail —— 否则新页面的侧栏要等到刷新才消失。
            // 顺序和 applyAll 保持一致：先去侧栏，再修崩塌。
            if (big) { safe('full', function () { markScrollables(); fixWidths(null, 3); fitHeader(); fitColumns(); hideRightRail(); fixFlexRows(); }); }
            safe('fixed', fixFixedLayers);
            safe('tables', wrapTables);
            safe('badge', drawBadge);
          }, 260);
        }).observe(document.documentElement, { childList: true, subtree: true });
      });
    }

    // 旋屏 / 键盘弹出：重算 zoom
    var rt;
    function onResize() {
      clearTimeout(rt);
      rt = setTimeout(function () {
        if (paused) return;
        if (S.sw !== screenWidth() || S.vw !== viewportWidth()) {
          log('视口变化 → 重新适配');
          safe('applyAll', applyAll);
          safe('vunits', fixViewportUnits);
        }
        safe('badge', drawBadge);
      }, 220);
    }
    safe('resize', function () {
      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', onResize);
    });

    // 图片 / iframe 加载完会改变尺寸
    safe('load', function () {
      window.addEventListener('load', function () {
        refresh(true);
        setTimeout(function () { refresh(false); safe('vunits', fixViewportUnits); }, 1200);
        // vh/vw 折算要等样式表全部就绪，放最后做，避免拖慢首屏
        setTimeout(function () { if (!paused) safe('vunits', fixViewportUnits); }, 2500);
      });
    });

    [400, 1000, 2500].forEach(function (d) {
      setTimeout(function () { refresh(d === 400); }, d);
    });

    safe('badge', drawBadge);
    log('就绪');
  }

  // 调试/自检入口：控制台执行 __zhihuFit() 可查看当前状态
  window.__zhihuFit = function () {
    compute();
    return {
      屏幕宽: S.sw, layout视口: S.vw, zoom: +S.Z.toFixed(3), 基准宽: S.BASE,
      横向溢出: overflowX(),
      文档宽: (document.scrollingElement || document.documentElement).scrollWidth,
      基准高: Math.round(S.VH)
    };
  };

  // ═══════════════════════════════════════════════════════════════
  // 11. 早期侧栏猎手（v0.6.0）
  //
  //     现象：右栏（关于作者/推荐阅读）先显示、几百毫秒后才被
  //     fixFlexRows/hideRightRail 干掉 —— 肉眼可见闪烁。
  //     原因：无语义类名的右栏只能靠 JS 位置/文本判定，而判定链
  //     要等布局稳定后才跑，中间是空窗。
  //
  //     对策：从 document-start 起常驻一个 MutationObserver，
  //     新节点插入的**同一帧**内做文本特征判定，命中立即隐藏。
  //     「不加载」做不到 —— DOM 是知乎自己的代码插的，脚本拦不住，
  //     这是肉眼无闪烁的极限。
  //
  //     防误伤两道闸：
  //     ① 正文富文本容器（.RichText/.RichContent/.Post-RichTextContainer/
  //        .QuestionAnswer-content）内的节点一律不动 —— 文章里的
  //        「相关推荐」章节、评论区里的「推荐」字样不能杀；
  //     ② 特征词要求短文本（<400 字）：侧栏卡片文本短，正文长。
  // ═══════════════════════════════════════════════════════════════
  var RAIL_KEYWORDS = /关于作者|推荐阅读|大家都在搜|CircleCard|作者专栏/;
  function insideRichContent(el) {
    for (var p = el; p && p !== document.body; p = p.parentElement) {
      var c = p.className;
      if (typeof c === 'string' &&
          (c.indexOf('RichText') >= 0 || c.indexOf('RichContent') >= 0 ||
           c.indexOf('Post-RichTextContainer') >= 0 ||
           c.indexOf('QuestionAnswer-content') >= 0)) return true;
    }
    return false;
  }
  function earlyRailCheck(el) {
    if (!CONFIG.hideSidebar || CONFIG.sideColumn !== 'hide') return;
    if (el.nodeType !== 1 || el.hasAttribute('data-zrail')) return;
    if (insideRichContent(el)) return;
    /* ⚠ 白屏事故（v0.6.0）：
       节点插入瞬间尚未布局，offsetWidth 全是 0，向上爬「宽 ≥200 祖先」
       会爬穿卡片直到整页容器 —— 关键词命中的是一张提到「知乎热榜」的
       普通卡片，结果把整页 display:none = 白屏。
       对策①：未布局（offsetWidth===0）的节点一律不判定，等下一轮
       MutationObserver 再看 —— 布局完成后卡片自己就是 ≥200px 的边界。 */
    if (el.offsetWidth === 0) return;
    var txt = '';
    try { txt = (el.innerText || '').trim(); } catch (e) { return; }
    if (!txt || txt.length >= 400) return;          // 长文本是正文，不是侧栏卡片
    if (!RAIL_KEYWORDS.test(txt)) return;
    /* 对策②：命中节点本身宽度 ≥200 才有资格当侧栏卡片；不向上爬。
       v0.6.0 的爬升逻辑在布局未完成时会穿透一切容器，是白屏根源。
       保守换安全：只藏「自己就是宽卡片且文本命中特征词」的节点。 */
    if (el.offsetWidth < 200) return;
    // 对策③：确认它不是「包含其他内容块的大容器」——侧栏卡片里
    // 只有关键词和少量文字，不会同时装有图片/按钮等富内容
    if (el.querySelectorAll('img,video,button,form').length > 2) return;
    el.style.setProperty('display', 'none', 'important');
    el.setAttribute('data-zrail', '1');
    log('早期猎手：拦截侧栏（含「' + (txt.match(RAIL_KEYWORDS) || ['?'])[0] + '」）');
  }
  var earlyMoInstalled = false;
  function setupEarlyRailHunter() {
    if (earlyMoInstalled || !window.MutationObserver || !document.body) return;
    earlyMoInstalled = true;
    var mo = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1) continue;
          earlyRailCheck(n);
          // 新插入的可能是大容器，里面的子孙卡片也要查（浅查一层防抖动）
          if (n.querySelectorAll) {
            var subs = n.querySelectorAll('div,section,aside');
            for (var k = 0; k < subs.length && k < 30; k++) earlyRailCheck(subs[k]);
          }
        }
      }
    });
    try { mo.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  }
  // body 一出现就装上（比 boot 的 DOMContentLoaded 更早）
  // ⚠ document-start 时 documentElement 也可能还是 null（v3 就栽在这），
  //   observe 前必须确认，且 observe 失败不能让后续代码挂掉
  (function waitBody() {
    if (document.body) { setupEarlyRailHunter(); return; }
    var de = document.documentElement;
    if (de && window.MutationObserver) {
      try {
        new MutationObserver(function (m, obs) {
          if (document.body) { obs.disconnect(); setupEarlyRailHunter(); }
        }).observe(de, { childList: true });
      } catch (e) { /* documentElement 还没就绪，等下一轮 */ }
    }
    setTimeout(waitBody, 0);
  })();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  }
  boot();
})();
