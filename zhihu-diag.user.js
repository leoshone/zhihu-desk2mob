// ==UserScript==
// @name         知乎适配 · 宽度崩塌诊断（临时工具）v3
// @namespace    https://github.com/leoshone/zhihu-desk2mob
// @version      0.3.0
// @author       leoshone
// @description  定位「正文被压成窄条」：从 body 到正文逐层打印宽度与 inline style，找出变窄的断点。跑完即可删除。
// @match        *://*.zhihu.com/*
// @match        *://zhuanlan.zhihu.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/* v3：不再找侧栏（真机数据显示专栏页没有侧栏），
   转而定位「宽度是在哪一层塌掉的」。
   核心输出：从 body 到正文的宽度链 + 每层的 inline style。 */
(function () {
  'use strict';

  var LINES = [];
  function say(s) { LINES.push(s); }

  function cls(el) {
    var c = el.className;
    if (typeof c === 'string') return c;
    if (c && typeof c.baseVal === 'string') return c.baseVal;
    return '';
  }
  function path(el) {
    return '<' + el.tagName.toLowerCase() + '> .' + cls(el).slice(0, 38);
  }
  // inline style 里只保留脚本改的那些（带 !important 的），避免噪音
  function inlineOf(el) {
    var s = el.getAttribute('style') || '';
    if (!s) return '';
    var keep = [];
    var parts = s.split(';');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (!p) continue;
      if (/important/i.test(p)) keep.push(p.replace(/\s+/g, ' '));
    }
    return keep.length ? keep.join(' ; ') : '(有 inline style 但无 !important)';
  }

  function scan() {
    var zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    var de = document.documentElement;
    var se = document.scrollingElement || de;

    // ── 版本 ──
    var badgeEl = document.getElementById('zhihu-mobile-badge');
    var badge = badgeEl ? badgeEl.textContent.trim() : '(未装主脚本)';
    say('=== 版本 / 环境 ===');
    say('角标     : ' + badge);
    say('URL      : ' + location.href);
    say('zoom     : ' + zoom.toFixed(4));
    say('布局宽   : ' + Math.round(de.clientWidth / zoom) + '  (期望 393)');
    say('横向溢出 : ' + (se.scrollWidth - se.clientWidth) + '  (期望 0)');
    say('正文字符 : ' + (document.body.innerText || '').trim().length);
    say('');

    // ── 1. 定位正文：优先语义类名，退化到「深度最大」──
    // v2 按深度找锚点，结果选到了评论区（评论嵌套深），看不到正文的祖先链
    var cand = null;
    var sels = ['article.Post-Main', '.Post-Main', '.Post-NormalMain',
                '.RichText', '.Post-RichText', '.Post-content',
                'article', 'main article'];
    for (var s = 0; s < sels.length && !cand; s++) {
      var els = document.querySelectorAll(sels[s]);
      for (var e = 0; e < els.length; e++) {
        var cs0;
        try { cs0 = getComputedStyle(els[e]); } catch (err) { continue; }
        if (!cs0 || cs0.display === 'none') continue;
        if ((els[e].innerText || '').trim().length < 300) continue;
        cand = els[e];
        break;
      }
    }
    if (!cand) {
      // 退化：文本量 >=300 里深度最大的
      var all0 = document.body.querySelectorAll('*');
      var n0 = Math.min(all0.length, 6000);
      var bd = -1;
      for (var i0 = 0; i0 < n0; i0++) {
        var el0 = all0[i0], csx;
        try { csx = getComputedStyle(el0); } catch (err2) { continue; }
        if (!csx || csx.display === 'none') continue;
        if ((el0.innerText || '').trim().length < 300) continue;
        var d0 = 0, w0 = el0;
        while (w0 && w0 !== document.body) { d0++; w0 = w0.parentElement; }
        if (d0 > bd) { bd = d0; cand = el0; }
      }
    }
    if (!cand) { say('!! 找不到正文元素'); return; }

    // ── 2. 从 body 到正文：逐层打印宽度链（核心）──
    say('=== 宽度链：从 body 到正文 ===');
    say('每一层的 实际宽 / 计算样式宽 / display / 脚本改过的 inline style');
    say('');

    var chain = [];
    var cur = cand;
    while (cur && cur !== document.documentElement) { chain.unshift(cur); cur = cur.parentElement; }

    var prevW = null, brokeAt = -1;
    for (var i = 0; i < chain.length; i++) {
      var el = chain[i];
      var cs;
      try { cs = getComputedStyle(el); } catch (e3) { cs = null; }
      var w = el.offsetWidth;
      var disp = cs ? cs.display : '?';
      var cw = cs ? cs.width : '?';
      var st = inlineOf(el);
      var ind = new Array(i + 1).join('  ');

      // 标记断点：要求「骤降超过 30%」才算，避免把 padding 造成的正常损耗误报
      var flag = '';
      if (prevW !== null && w < prevW - 30 && w < prevW * 0.7) {
        flag = '   ◀◀ 断点！宽度从 ' + prevW + ' 掉到 ' + w;
        if (brokeAt < 0) brokeAt = i;
      }
      say(ind + '└─ ' + path(el));
      say(ind + '    实测宽=' + w + '  css宽=' + cw + '  disp=' + disp + flag);
      if (st) say(ind + '    style: ' + st.slice(0, 150));
      prevW = w;
    }
    say('');
    if (brokeAt >= 0) {
      say('>>> 宽度在「' + path(chain[brokeAt]) + '」这一层塌掉');
      say('    它的父是 ' + (chain[brokeAt - 1] ? path(chain[brokeAt - 1]) : '(无)'));
    } else {
      say('>>> 宽度链上没有明显断点，正文窄可能是内容本身导致的');
    }
    say('');

    // ── 3. inline style 审计：脚本到底改了哪些元素，改成什么 ──
    say('=== inline style 审计：宽度异常（<150px）且被脚本改过的元素 ===');
    say('（按出现顺序，最多 25 个。重点看 width/max-width/flex 被改成什么）');
    var all = document.body.querySelectorAll('*');
    var n = Math.min(all.length, 6000);
    var cnt = 0;
    for (var a = 0; a < n && cnt < 25; a++) {
      var t = all[a];
      if (t.offsetWidth >= 150) continue;
      if (t.offsetWidth === 0) continue;
      var stl = inlineOf(t);
      if (!stl || stl.indexOf('(有') === 0) continue;
      if (!/width|flex|margin|min-width/i.test(stl)) continue;
      cnt++;
      say('  [' + cnt + '] ' + path(t) + '  实测宽=' + t.offsetWidth);
      say('       ' + stl.slice(0, 160));
    }
    if (!cnt) say('  （无）');
    say('');

    // ── 4. 关键语义元素的当前状态 ──
    say('=== 关键元素现状 ===');
    var keys = ['.Post-content', '.Post-Main', '.Post-NormalMain', '.RichText',
                '.Post-RichText', '.PostHeader', '.Comments-container',
                '.Post-SideColumn', '.ColumnSideBar', '.GlobalSideBar',
                '.Recommendations-List', 'aside', 'article', 'main'];
    for (var k = 0; k < keys.length; k++) {
      var kels = document.querySelectorAll(keys[k]);
      if (!kels.length) { say('  ' + keys[k] + ' : (不存在)'); continue; }
      for (var q = 0; q < kels.length && q < 2; q++) {
        var ke = kels[q], kcs;
        try { kcs = getComputedStyle(ke); } catch (e4) { continue; }
        var kr = ke.getBoundingClientRect();
        say('  ' + keys[k] + ' : 实测宽=' + ke.offsetWidth +
            ' left=' + Math.round(kr.left / zoom) +
            ' top=' + Math.round(kr.top / zoom) +
            ' disp=' + kcs.display +
            ' txt=' + (ke.innerText || '').trim().length);
        var kst = inlineOf(ke);
        if (kst) say('        style: ' + kst.slice(0, 140));
      }
    }
    say('');

    // ── 5. 快照大小（评估能否导出复现）──
    try {
      var html = document.documentElement.outerHTML;
      say('=== 快照可行性 ===');
      say('outerHTML 大小 : ' + (html.length / 1024).toFixed(1) + ' KB');
      say('（如果下面的复制失败，可以让我改成只导出正文所在子树）');
    } catch (e5) { /* 忽略 */ }
  }

  // ── 渲染 ──
  function render() {
    var box = document.createElement('div');
    box.id = 'zf-diag-panel';
    box.style.cssText = 'position:fixed;left:0;top:0;width:100%;max-height:72vh;' +
      'overflow:auto;z-index:2147483647;background:#fff;color:#111;' +
      'font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:10px 12px 56px;' +
      'box-shadow:0 2px 12px rgba(0,0,0,.35);white-space:pre-wrap;word-break:break-all;';
    var pre = document.createElement('div');
    pre.textContent = LINES.join('\n');
    box.appendChild(pre);

    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:0;bottom:0;width:100%;z-index:2147483648;' +
      'background:#066ac9;padding:10px;display:flex;gap:8px;box-sizing:border-box;';
    var bCopy = document.createElement('button');
    bCopy.textContent = '复制诊断信息';
    var bClose = document.createElement('button');
    bClose.textContent = '关闭';
    var css = 'flex:1;padding:11px;font-size:14px;font-weight:600;border:0;border-radius:6px;';
    bCopy.style.cssText = css + 'background:#fff;color:#066ac9;';
    bClose.style.cssText = css + 'background:rgba(255,255,255,.25);color:#fff;';

    var ta = document.createElement('textarea');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta);

    bCopy.onclick = function () {
      ta.value = LINES.join('\n');
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      if (!ok && navigator.clipboard) {
        navigator.clipboard.writeText(ta.value).then(function () {
          bCopy.textContent = '已复制 ✓';
        }, function () { bCopy.textContent = '复制失败，请手动长按选中'; });
        return;
      }
      bCopy.textContent = ok ? '已复制 ✓' : '复制失败，请手动长按选中';
    };
    bClose.onclick = function () { box.remove(); bar.remove(); ta.remove(); };

    bar.appendChild(bCopy);
    bar.appendChild(bClose);
    document.body.appendChild(box);
    document.body.appendChild(bar);
  }

  function boot() {
    try { LINES = []; scan(); }
    catch (e) { say('!! 扫描出错: ' + (e && e.message ? e.message : e)); }
    try { render(); } catch (e2) { console.error('[诊断] 渲染失败', e2); }
  }

  if (document.readyState === 'complete') setTimeout(boot, 1500);
  else window.addEventListener('load', function () { setTimeout(boot, 1500); });
  window.__zhihuDiag = function () { boot(); return LINES.join('\n'); };
})();
