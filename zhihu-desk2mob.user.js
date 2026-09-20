// ==UserScript==
// @name         知乎桌面版·手机单列适配 (Zhihu Desktop for Mobile)
// @namespace    zhihu2mob
// @version      1.0.0
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

  let timer = null;
  function tick() {
    hideSideRails(); capFixed(); capWide();
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(tick, 300); }

  const obs = new MutationObserver(schedule);
  function start() {
    obs.observe(document.body, { childList: true, subtree: true, attributes: false });
    tick();
    window.addEventListener('resize', () => {
      document.documentElement.style.setProperty('--z2m-w', Math.max(320, Math.min(screen.width || 393, 500)) + 'px');
    });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  window.__z2mStop = () => { obs.disconnect(); clearTimeout(timer); st.remove(); };
  window.__z2mTick = tick;
})();
