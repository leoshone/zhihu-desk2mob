// ==UserScript==
// @name         知乎适配 · 两栏布局诊断（临时工具）v2
// @namespace    https://github.com/leoshone/zhihu-desk2mob
// @version      0.2.2
// @author       leoshone
// @description  从「正文」反查两栏容器的真实 DOM 层级，定位侧栏为什么没被移走。跑完即可删除。
// @match        *://*.zhihu.com/*
// @match        *://zhuanlan.zhihu.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/* v2 改动：全局扫描命中不了真身，改成「从正文反查祖先链」。
   用法：装好 → 打开有问题的页面 → 等浮层 → 点「复制诊断信息」→ 粘贴发我。 */
(function () {
  'use strict';

  var LINES = [];
  function say(s) { LINES.push(s); }

  // className 可能是字符串（HTML）也可能是 SVGAnimatedString（SVG）
  function cls(el) {
    var c = el.className;
    if (typeof c === 'string') return c;
    if (c && typeof c.baseVal === 'string') return c.baseVal;
    return '';
  }
  function path(el) {
    return '<' + el.tagName.toLowerCase() + '> .' + cls(el).slice(0, 40);
  }

  function scan() {
    var zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    var de = document.documentElement;
    var se = document.scrollingElement || de;

    // ── 0. 版本检查：最关键，先确认装的是不是新版 ──
    var badgeEl = document.getElementById('zhihu-mobile-badge');
    var badge = badgeEl ? badgeEl.textContent.trim() : '(未装主脚本)';
    var hasVer = /v\d+\.\d+/.test(badge);

    say('=== 版本检查 ===');
    say('角标     : ' + badge);
    if (!badgeEl) {
      say('判定     : ✗ 没检测到主脚本！先装主脚本再诊断');
    } else if (!hasVer) {
      say('判定     : ✗ 主脚本版本 < 0.2.1（角标不含版本号）');
      say('           → 不含两栏布局处理功能，侧栏不动是必然的');
      say('           → 请更新主脚本：');
      say('             cdn.jsdelivr.net/gh/leoshone/zhihu-desk2mob@main/zhihu-desk2mob.user.js');
    } else {
      say('判定     : ✓ 主脚本 ' + badge.match(/v\d+\.\d+(\.\d+)?/)[0] + '，含两栏处理功能');
    }
    say('');

    say('=== 环境 ===');
    say('URL      : ' + location.href);
    say('标题     : ' + (document.title || '').slice(0, 50));
    say('zoom     : ' + zoom.toFixed(4));
    say('布局宽   : ' + Math.round(de.clientWidth / zoom) + '  (期望 393)');
    say('横向溢出 : ' + (se.scrollWidth - se.clientWidth) + '  (期望 0)');
    say('正文字符 : ' + (document.body.innerText || '').trim().length);
    say('');

    // ── 1. 定位正文 ──
    // 不能用「文本量最大」：外层容器的文本量必然最大，选出来的是 wrapper 不是正文。
    // 改用「深度最大」：在文本量够格（>=300）的元素里取 DOM 最深的那个，
    // 正文容器通常在最内层。
    var all = document.body.querySelectorAll('*');
    var n = Math.min(all.length, 6000);
    function depth(el) { var d = 0; while (el && el !== document.body) { d++; el = el.parentElement; } return d; }

    var main = null, mainDepth = -1, mainTxt = 0;
    for (var i = 0; i < n; i++) {
      var el = all[i];
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (!cs || cs.display === 'none' || cs.visibility === 'hidden') continue;
      var t = (el.innerText || '').trim().length;
      if (t < 300) continue;
      var d = depth(el);
      if (d > mainDepth) { mainDepth = d; main = el; mainTxt = t; }
    }
    if (!main) { say('!! 找不到正文元素（没有文本量 >=300 的可见块）'); return; }

    var mr = main.getBoundingClientRect();
    say('=== 正文定位（文本量>=300 中 DOM 最深的那个）===');
    say('元素     : ' + path(main));
    say('深度     : ' + mainDepth);
    say('宽度     : ' + main.offsetWidth + '   ← 明显小于 393 就说明正文被挤窄了');
    say('left     : ' + Math.round(mr.left / zoom));
    say('top      : ' + Math.round(mr.top / zoom));
    say('文本量   : ' + mainTxt);
    var anc = [], walk = main;
    while (walk && walk !== document.body) { anc.unshift(path(walk)); walk = walk.parentElement; }
    say('路径     : body > ' + anc.join(' > '));
    say('');

    // ── 2. 从正文向上爬祖先链，每层列出所有兄弟的几何 ──
    // 这是核心：一眼看出两栏在哪一层、主列和侧栏是不是直接兄弟
    say('=== 祖先链反查（从正文往上 7 层）===');
    say('每层列出父容器及其全部直接子元素的 宽/left/top/文本量');
    say('');

    var cur = main;
    for (var lv = 0; lv < 7 && cur && cur.parentElement; lv++) {
      var pa = cur.parentElement;
      if (pa === document.documentElement || pa === document.body) {
        say('  [第' + (lv + 1) + '层] 已到 <' + pa.tagName.toLowerCase() + '>，停止');
        break;
      }
      var pcs = getComputedStyle(pa);
      var pr = pa.getBoundingClientRect();
      say('  ┌─ 第' + (lv + 1) + '层 父 ' + path(pa));
      say('  │     w=' + pa.offsetWidth +
          ' left=' + Math.round(pr.left / zoom) +
          ' disp=' + pcs.display +
          ' gtc=\'' + pcs.gridTemplateColumns + '\'' +
          ' wrap=' + pcs.flexWrap +
          ' kids=' + pa.children.length);

      for (var k = 0; k < pa.children.length && k < 10; k++) {
        var ch = pa.children[k];
        var ccs;
        try { ccs = getComputedStyle(ch); } catch (e) { continue; }
        if (ccs.display === 'none' || ccs.visibility === 'hidden') {
          say('  │   ┊ <' + ch.tagName.toLowerCase() + '> (隐藏)');
          continue;
        }
        var cr = ch.getBoundingClientRect();
        var isMain = (ch === cur);
        say('  │   ' + (isMain ? '▶' : '┊') + ' <' + ch.tagName.toLowerCase() + '> .' +
            cls(ch).slice(0, 32));
        say('  │       w=' + ch.offsetWidth +
            ' left=' + Math.round(cr.left / zoom) +
            ' top=' + Math.round(cr.top / zoom) +
            ' txt=' + (ch.innerText || '').trim().length +
            ' disp=' + ccs.display +
            ' pos=' + ccs.position);
      }
      say('  └─');
      cur = pa;
    }
    say('');

    // ── 3. 右侧邻居专项：和正文同层、位置更靠右、有实际内容 ──
    say('=== 右侧邻居（可能是侧栏的元素）===');
    say('条件：与正文同一父容器、left 明显更靠右、宽度 >= 80、非 fixed/absolute');
    var mt = mr.top / zoom;
    var ml = mr.left / zoom;
    var found = 0;
    var probe = main.parentElement;
    for (var d = 0; d < 4 && probe && probe !== document.body; d++) {
      for (var c = 0; c < probe.children.length; c++) {
        var sib = probe.children[c];
        if (sib === main || main.contains(sib)) continue;
        var scs;
        try { scs = getComputedStyle(sib); } catch (e) { continue; }
        if (scs.display === 'none' || scs.visibility === 'hidden') continue;
        if (scs.position === 'fixed' || scs.position === 'absolute') continue;
        var sr = sib.getBoundingClientRect();
        var sl = sr.left / zoom, st = sr.top / zoom;
        if (sib.offsetWidth < 80) continue;
        if (sl <= ml + 10) continue;                 // 不在正文右侧
        if (Math.abs(st - mt) > 300) continue;       // 和正文不在同一区域
        found++;
        say('  [层+' + d + '] ' + path(sib));
        say('       w=' + sib.offsetWidth + ' left=' + Math.round(sl) +
            ' top=' + Math.round(st) + ' txt=' + (sib.innerText || '').trim().length +
            ' disp=' + scs.display);
      }
      probe = probe.parentElement;
    }
    if (!found) {
      say('  （无。说明侧栏和正文不在同一父容器下，或者侧栏是 fixed/absolute 定位，');
      say('    或者页面根本不是两栏结构 —— 那用户看到的"右侧栏"可能是别的东西。）');
    }
    say('');

    // ── 4. 全局扫描统计（修掉 v1 漏计「容器太窄」的 bug，并对比放宽效果）──
    say('=== 全局扫描统计（生产配置 kids<=8）===');
    stat_dump(8);
    say('');
    say('=== 对照组：放宽 kids<=20（验证放宽是否有效）===');
    stat_dump(20);
  }

  function stat_dump(maxKids) {
    var st = { 容器太窄: 0, 子元素数不符: 0, 同行块不足2: 0, 分组后不足2: 0,
               右侧不够宽: 0, 主列文本不多于侧栏: 0, 主列内容太少: 0, 命中: 0 };
    var near = [];
    var all = document.body.querySelectorAll('*');
    var n = Math.min(all.length, 6000);
    var zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;

    for (var a = 0; a < n; a++) {
      var box = all[a];
      var bw = box.offsetWidth;
      if (bw < 393 * 0.6) { st.容器太窄++; continue; }
      var kids = box.children;
      if (kids.length < 2 || kids.length > maxKids) { st.子元素数不符++; continue; }

      var row = [];
      for (var k = 0; k < kids.length; k++) {
        var kid = kids[k], kcs;
        try { kcs = getComputedStyle(kid); } catch (e) { continue; }
        if (!kcs || kcs.display === 'none' || kcs.visibility === 'hidden') continue;
        if (kcs.display === 'inline' || kcs.display === 'inline-block') continue;
        if (kcs.position === 'fixed' || kcs.position === 'absolute') continue;
        if (kid.offsetWidth < 60) continue;
        var kr = kid.getBoundingClientRect();
        row.push({ el: kid, w: kid.offsetWidth, left: kr.left / zoom,
                   top: kr.top / zoom, txt: (kid.innerText || '').length,
                   cls: cls(kid).slice(0, 32), tag: kid.tagName.toLowerCase() });
      }
      if (row.length < 2) { st.同行块不足2++; continue; }

      var best = [], grp;
      for (var p = 0; p < row.length; p++) {
        grp = [row[p]];
        for (var q = 0; q < row.length; q++) {
          if (q === p) continue;
          if (Math.abs(row[q].top - row[p].top) <= 40) grp.push(row[q]);
        }
        if (grp.length > best.length) best = grp;
      }
      if (best.length < 2) { st.分组后不足2++; continue; }

      best.sort(function (m1, m2) { return m1.left - m2.left; });
      var mn = best[0], sd = best[best.length - 1];
      if (mn.el === sd.el) continue;

      var reason = null;
      if (sd.w < bw * 0.2) reason = '右侧不够宽';
      else if (mn.txt < sd.txt) reason = '主列文本不多于侧栏';
      else if (mn.txt < 200) reason = '主列内容太少';

      if (reason) st[reason]++; else st.命中++;
      near.push({ reason: reason || '(通过)', box: path(box), boxW: bw,
                  boxDisp: getComputedStyle(box).display,
                  gtc: getComputedStyle(box).gridTemplateColumns,
                  mn: mn, sd: sd });
    }

    for (var key in st) say('  ' + key + ' : ' + st[key]);

    near.sort(function (x, y) { return y.mn.txt - x.mn.txt; });
    if (near.length) {
      say('  -- 最接近命中的候选（前 3）--');
      for (var c = 0; c < Math.min(near.length, 3); c++) {
        var t = near[c];
        say('    #' + (c + 1) + ' 卡在：' + t.reason);
        say('        容器 ' + t.box + ' w=' + t.boxW + ' disp=' + t.boxDisp +
            ' gtc=\'' + t.gtc + '\'');
        say('        主列 <' + t.mn.tag + '> .' + t.mn.cls +
            ' w=' + t.mn.w + ' left=' + Math.round(t.mn.left) + ' txt=' + t.mn.txt);
        say('        侧栏 <' + t.sd.tag + '> .' + t.sd.cls +
            ' w=' + t.sd.w + ' left=' + Math.round(t.sd.left) + ' txt=' + t.sd.txt);
      }
    }
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

  if (document.readyState === 'complete') setTimeout(boot, 1200);
  else window.addEventListener('load', function () { setTimeout(boot, 1200); });
  window.__zhihuDiag = function () { boot(); return LINES.join('\n'); };
})();
