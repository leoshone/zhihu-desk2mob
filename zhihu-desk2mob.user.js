// ==UserScript==
// @name         知乎桌面版·手机单列适配 (Zhihu Desktop for Mobile)
// @namespace    zhihu2mob
// @version      1.0.1
// @description  在 Kiwi/Chrome「桌面版网站」模式下，把知乎桌面版重排为手机单列、正常字号。适配首页/问答/专栏，评论可正常展开收起。提示：需配合浏览器「请求桌面版网站」开关使用；未开桌面模式时脚本自动不生效。
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

  /* ---- unify content-block widths: answer column should match the question block ---- */
  .QuestionPage > div { padding-left: 0 !important; padding-right: 0 !important; }
  .QuestionAnswer-content, .AnswerCard, .Question-mainColumn, .ListShortcut,
  .QuestionAnswers-answers, .ContentItem, .Comments-container, .CommentItem {
    padding-left: 0 !important; padding-right: 0 !important;
    margin-left: 0 !important; margin-right: 0 !important;
    width: auto !important; max-width: 100% !important;
  }

  /* ---- image / media viewer: Zhihu positions it in desktop coords, so it lands off-screen.
         We detect those layers (see fixViewers) and force them centered on the phone screen. ---- */
  .z2m-viewer {
    position: fixed !important; left: 0 !important; top: 0 !important; right: 0 !important; bottom: 0 !important;
    margin: auto !important;
    /* transform:none !important is the key: Zhihu's viewer re-writes style.transform
       (translateX/Y off-screen in desktop coords) on every animation frame; a stylesheet
       !important beats that inline non-important value no matter how often it's re-set. */
    transform: none !important;
    width: auto !important; height: auto !important;
    /* px caps, NOT vw/vh: in Kiwi desktop mode 100vw = the 1430px layout viewport,
       so vw caps are no-ops. --z2m-w is the real 393px column. */
    max-width: var(--z2m-w) !important;
    z-index: 2147483646 !important;
  }
  .z2m-viewer:not(img) {
    display: flex !important; align-items: center !important; justify-content: center !important;
  }
  .z2m-viewer img, .z2m-viewer .origin_image {
    max-width: 94% !important; max-height: 92% !important;
    width: auto !important; height: auto !important; object-fit: contain !important;
  }
  .z2m-backdrop {
    position: fixed !important; inset: 0 !important;
    width: 100vw !important; height: 100vh !important; z-index: 2147483645 !important;
  }
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

  // ---- center the image/media viewer (Zhihu layers it as position:absolute in desktop coords) ----
  function tagViewer(el) {
    el.classList.add('z2m-viewer');
    const s = el.style; // inline !important beats Zhihu's own inline !important (last-writer-wins)
    // visible-viewport px caps (vw/vh are useless here: they resolve against the 1430px layout viewport)
    const vv = window.visualViewport;
    const visH = Math.max(480, Math.round(vv ? vv.height * vv.scale : 0) ||
      Math.round(SW * (screen.height || 1560) / (screen.width || SW)));
    s.setProperty('position', 'fixed', 'important');
    s.setProperty('left', '0', 'important'); s.setProperty('top', '0', 'important');
    s.setProperty('right', '0', 'important'); s.setProperty('bottom', '0', 'important');
    // margin:auto centers a replaced element (img) inside inset:0; harmless (0) for stretched divs
    s.setProperty('margin', 'auto', 'important'); s.setProperty('transform', 'none', 'important');
    s.setProperty('max-width', SW + 'px', 'important'); s.setProperty('max-height', visH + 'px', 'important');
    s.setProperty('width', 'auto', 'important'); s.setProperty('height', 'auto', 'important');
    s.setProperty('z-index', '2147483646', 'important');
    if (el.tagName === 'IMG') s.setProperty('object-fit', 'contain', 'important');
    else { s.setProperty('display', 'flex', 'important'); s.setProperty('align-items', 'center', 'important'); s.setProperty('justify-content', 'center', 'important'); }
  }
  // Only layers that actually hold the viewed image (the <img> itself, or a wrapper
  // containing one). Zhihu also appends empty control bars — forcing those fullscreen
  // would put a transparent click-eating overlay over the viewer.
  function looksLikeViewer(el) {
    if (el.tagName === 'IMG') return true;
    if (el.querySelector && el.querySelector('img')) return true;
    return false;
  }
  function fixViewers() {
    const body = document.body; if (!body) return;
    const br = body.getBoundingClientRect();
    const refRight = br.right, refCx = br.left + br.width / 2; // visible content bounds (393px column)
    const kids = [...body.children];
    for (const el of kids) {
      if (el.classList.contains('z2m-viewer') || el.classList.contains('z2m-backdrop')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (cs.position !== 'absolute' && cs.position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 120) continue;
      // element extends past the visible content column -> a desktop-coord positioned viewer layer
      if (r.right > refRight + 5 || r.left > refCx + 40) {
        if (looksLikeViewer(el)) tagViewer(el);
      }
      else if (cs.position === 'fixed' && r.width >= br.width * 0.8 && r.height >= br.height * 0.8) el.classList.add('z2m-backdrop');
    }
  }

  let timer = null;
  function tick() {
    // stray horizontal scroll offset shifts the 393px column left (blocks land at x<0)
    if (window.scrollX) window.scrollTo(0, window.scrollY);
    hideSideRails(); capFixed(); capWide(); fixViewers();
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(tick, 300); }

  const obs = new MutationObserver(schedule);
  function start() {
    obs.observe(document.body, { childList: true, subtree: true, attributes: false });
    tick(); fixViewers();
    window.addEventListener('resize', () => {
      document.documentElement.style.setProperty('--z2m-w', Math.max(320, Math.min(screen.width || 393, 500)) + 'px');
    });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  window.__z2mStop = () => { obs.disconnect(); clearTimeout(timer); st.remove(); };
  window.__z2mTick = tick;
})();
