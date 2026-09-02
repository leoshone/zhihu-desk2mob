// ==UserScript==
// @name         知乎桌面版 → 手机宽度适配
// @namespace    https://github.com/user/zhihu-mobile
// @version      0.1.0
// @description  在 Kiwi 等手机浏览器里把知乎桌面版网页收进手机宽度：修复桌面模式视口缩放、min-width 硬编码、emotion 原子 CSS、vh/vw 单位失真、顶栏溢出。支持旋屏与 SPA 导航。
// @author       You
// @match        https://*.zhihu.com/*
// @match        https://zhihu.com/*
// @icon         https://www.zhihu.com/favicon.ico
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

  // ═══════════════════════════════════════════════════════════════
  // 可调参数
  // ═══════════════════════════════════════════════════════════════
  var CONFIG = {
    debug:        true,   // 右上角状态角标（点一下可临时关闭适配，再点恢复）
    fitHeader:    true,   // 顶栏自适应裁剪（超过宽度的导航项自动收起）
    hideSidebar:  true,   // 隐藏右侧栏、悬浮按钮、App 下载条
    fixVUnits:    true,   // 修正 vh/vw 在 zoom 下的失真
    bodyFont:     16,     // 正文字号（px）；设 0 表示不改
    maxScan:      4500,   // 单次宽度修复最多扫描的元素数
    sidePadding:  12      // 页面左右留白（px）
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
      'body{min-width:0!important;max-width:100%!important;overflow-x:clip!important;margin:0 auto!important}',
      'body,#root,.App,.App-main,.QuestionPage,.Question-main,.Topstory-container,',
      'main,article,section,.ExploreHomePage,.ExploreHomePage-ContentSection{',
        'min-width:0!important;width:100%!important;max-width:100%!important;',
        'box-sizing:border-box!important;margin-left:auto!important;margin-right:auto!important;',
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

      /* ---- 隐藏侧栏 / 悬浮件 / 推广 ---- */
      CONFIG.hideSidebar ? [
        '.Question-sideColumn,.Topstory-sideColumn,.ColumnSideBar,.Post-SideColumn,',
        '.GlobalSideBar,.Profile-sideColumn,.CornerButtons,.QuestionButtonGroup,',
        '.AppBanner,.MobileAppBanner,[class*="BackToTop"],[class*="DownloadApp"],',
        '[class*="MobileAppHeader"],.Toast,.Toast-wrapper,',
        'aside,[class*="SideColumn"],[class*="SideBar"],[class*="Sidebar"],',
        '[class*="QRCode"],[class*="QrCode"],[class*="Adblock"]{display:none!important}'
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

      /* ---- 去卡片化：窄屏下阴影和圆角没有意义，还占视觉 ---- */
      '.Card,.ContentItem,.List-item{box-shadow:none!important;border-radius:0!important}',
      '.List-item,.ContentItem{border-bottom:1px solid #f0f0f0!important}',

      /* ---- 字号：桌面版 15px 在手机上偏小 ---- */
      CONFIG.bodyFont ? ('.RichText,.RichContent,.ztext{font-size:' + CONFIG.bodyFont +
        'px!important;line-height:1.75!important}') : '',
      '.QuestionHeader-title{font-size:19px!important;line-height:1.45!important}',

      /* ---- 内边距 ---- */
      '.Question-mainColumn,.Topstory-mainColumn,.Post-NormalMain,.QuestionHeader-content,',
      '.ExploreHomePage-ContentSection{padding-left:' + P + 'px!important;padding-right:' + P + 'px!important}',
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
        'pointer-events:auto;opacity:.92;max-width:60%;text-align:right;';
      el.title = '点击暂停/恢复适配';
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
    return '✓ ' + S.BASE + 'px' + (S.needZoom ? ' ×' + S.Z.toFixed(2) : '') +
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
            if (big) { safe('full', function () { markScrollables(); fixWidths(null, 3); fitHeader(); }); }
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  }
  boot();
})();
