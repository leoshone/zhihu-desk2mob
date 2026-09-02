// ==UserScript==
// @name         知乎适配 · 两栏布局诊断（临时工具）
// @namespace    https://github.com/leoshone/zhihu-desk2mob
// @version      0.2.1
// @author       leoshone
// @description  在知乎专栏页上显示两栏布局的真实 DOM 结构与匹配判定过程，用于定位「侧栏没被移走」的原因。跑完即可删除。
// @match        *://*.zhihu.com/*
// @match        *://zhuanlan.zhihu.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/* 临时诊断工具：不改页面，只读结构并把判定过程摊开给你看。
   用法：装好 → 打开有问题的专栏页 → 等顶部浮层出现 → 点「复制诊断信息」→ 粘贴发我。 */
(function () {
  'use strict';

  var BASE = 393;                 // 手机基准宽（Kiwi 桌面模式下应为 393）
  var LINES = [];                 // 输出文本
  var NEAR = [];                  // 差一点就命中的候选

  function say(s) { LINES.push(s); }

  // ── 扫描：复刻主脚本 fitColumns 的判定逻辑，但把每一步都记下来 ──
  function scan() {
    var zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    var de = document.documentElement;
    var se = document.scrollingElement || de;
    var cssW = Math.round(de.clientWidth / zoom);
    var overflowX = se.scrollWidth - se.clientWidth;

    // 主脚本是否在工作
    var mainOn = !!document.getElementById('zhihu-mobile-badge');
    var badge = mainOn ? document.getElementById('zhihu-mobile-badge').textContent : '(未装主脚本)';

    say('URL      : ' + location.href);
    say('标题     : ' + (document.title || '').slice(0, 50));
    say('角标     : ' + badge);
    say('zoom     : ' + zoom.toFixed(4));
    say('布局宽   : ' + cssW + '  (期望 393)');
    say('横向溢出 : ' + overflowX + '  (期望 0)');
    say('正文字符 : ' + (document.body.innerText || '').trim().length);
    say('');

    // ── 1. 侧栏候选：按类名 ──
    var sels = ['aside', '.Post-SideColumn', '.ColumnSideBar', '.GlobalSideBar',
                '.Post-Row-Content-right', '.ColumnPageSidebar', '.Profile-sideColumn',
                '.Question-sideColumn', '.Topstory-sideColumn',
                '[class*="SideColumn"]', '[class*="SideBar"]', '[class*="Sidebar"]',
                '[class*="sideColumn"]', '[class*="sidebar"]'];
    var hits = [];
    for (var i = 0; i < sels.length; i++) {
      var els;
      try { els = document.querySelectorAll(sels[i]); } catch (e) { continue; }
      for (var j = 0; j < els.length; j++) {
        var el = els[j], cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (el.offsetWidth < 60) continue;
        var r = el.getBoundingClientRect();
        hits.push({
          sel: sels[i],
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').slice(0, 42),
          w: Math.round(el.offsetWidth),
          left: Math.round(r.left / zoom),
          top: Math.round((r.top + window.scrollY) / zoom),
          txt: (el.innerText || '').trim().length
        });
      }
    }
    say('── 侧栏候选（按类名命中 ' + hits.length + ' 个）──');
    if (!hits.length) {
      say('  （无。说明页面里没有带 SideColumn/SideBar/aside 类名的元素，');
      say('    或者它们已经被隐藏/太窄。这时只能靠结构启发式识别。）');
    }
    for (var h = 0; h < Math.min(hits.length, 10); h++) {
      var x = hits[h];
      say('  [' + x.sel + '] <' + x.tag + '> .' + x.cls);
      say('      w=' + x.w + ' left=' + x.left + ' top=' + x.top + ' txt=' + x.txt);
    }
    say('');

    // ── 2. 结构启发式扫描：复刻主脚本每一步，记录拒绝原因 ──
    var stat = { 容器太窄: 0, 子元素数不符: 0, 同行块不足2: 0, 分组后不足2: 0,
                 右侧不够宽: 0, 主列文本不多于侧栏: 0, 主列内容太少: 0, 命中: 0 };
    var all = document.body.querySelectorAll('*');
    var n = Math.min(all.length, 4500);

    for (var a = 0; a < n; a++) {
      var box = all[a];
      var bw = box.offsetWidth;
      if (bw < BASE * 0.6) continue;              // 只看够宽的容器

      var kids = box.children;
      if (kids.length < 2 || kids.length > 8) { stat.子元素数不符++; continue; }

      var row = [];
      for (var k = 0; k < kids.length; k++) {
        var kid = kids[k], kcs;
        try { kcs = getComputedStyle(kid); } catch (e) { continue; }
        if (!kcs || kcs.display === 'none' || kcs.visibility === 'hidden') continue;
        if (kcs.display === 'inline' || kcs.display === 'inline-block') continue;
        if (kcs.position === 'fixed' || kcs.position === 'absolute') continue;
        var kw = kid.offsetWidth;
        if (kw < 60) continue;
        var kr = kid.getBoundingClientRect();
        row.push({ el: kid, w: kw, left: kr.left / zoom, top: kr.top / zoom,
                   txt: (kid.innerText || '').length, cls: String(kid.className || '').slice(0, 34),
                   tag: kid.tagName.toLowerCase() });
      }
      if (row.length < 2) { stat.同行块不足2++; continue; }

      // 按 top 相近分组，取元素最多的那组
      var best = [], grp;
      for (var p = 0; p < row.length; p++) {
        grp = [row[p]];
        for (var q = 0; q < row.length; q++) {
          if (q === p) continue;
          if (Math.abs(row[q].top - row[p].top) <= 40) grp.push(row[q]);
        }
        if (grp.length > best.length) best = grp;
      }
      if (best.length < 2) { stat.分组后不足2++; continue; }

      best.sort(function (m1, m2) { return m1.left - m2.left; });
      var main = best[0], side = best[best.length - 1];
      if (main.el === side.el) continue;

      var boxCls = String(box.className || '').slice(0, 34);
      var snapshot = {
        box: '<' + box.tagName.toLowerCase() + '> .' + boxCls,
        boxW: bw, boxDisp: getComputedStyle(box).display,
        gtc: getComputedStyle(box).gridTemplateColumns,
        main: main, side: side
      };
      // 记录"差一点命中"的，带上卡在哪一关
      var reason = null;
      if (side.w < bw * 0.2) reason = '右侧不够宽';
      else if (main.txt < side.txt) reason = '主列文本不多于侧栏';
      else if (main.txt < 200) reason = '主列内容太少';

      if (reason) { stat[reason]++; snapshot.卡在 = reason; NEAR.push(snapshot); }
      else { stat.命中++; snapshot.卡在 = '(通过)'; NEAR.push(snapshot); }
    }

    say('── 结构启发式扫描统计 ──');
    for (var key in stat) say('  ' + key + ' : ' + stat[key]);
    say('  （扫描元素数 ' + n + '）');
    say('');

    // 差一点命中的：按"主列文本量"倒序，最有可能就是真身
    NEAR.sort(function (m1, m2) { return m2.main.txt - m1.main.txt; });
    say('── 最接近命中的候选（前 5）──');
    if (!NEAR.length) {
      say('  （一个都没有 → 容器层就卡住了：两栏的父容器子元素数不在 2~8，');
      say('    或者同行块级子元素不足 2。请看下一条「够宽容器」清单。）');
    }
    for (var c = 0; c < Math.min(NEAR.length, 5); c++) {
      var t = NEAR[c];
      say('  #' + (c + 1) + ' 卡在：' + t.卡在);
      say('      容器 ' + t.box + '  w=' + t.boxW + ' disp=' + t.boxDisp +
          ' gtc=\'' + t.gtc + '\'');
      say('      主列 <' + t.main.tag + '> .' + t.main.cls);
      say('          w=' + t.main.w + ' left=' + Math.round(t.main.left) +
          ' top=' + Math.round(t.main.top) + ' txt=' + t.main.txt);
      say('      侧栏 <' + t.side.tag + '> .' + t.side.cls);
      say('          w=' + t.side.w + ' left=' + Math.round(t.side.left) +
          ' top=' + Math.round(t.side.top) + ' txt=' + t.side.txt);
    }
    say('');

    // ── 3. 兜底清单：所有够宽的容器，看它们的直接子元素长什么样 ──
    say('── 够宽容器的直接子元素（前 8 个容器，看两栏到底藏在哪一层）──');
    var shown = 0;
    for (var d = 0; d < n && shown < 8; d++) {
      var cb = all[d];
      if (cb.offsetWidth < BASE * 0.6) continue;
      if (cb.children.length < 2) continue;
      if (cb.querySelector('*') && cb.offsetHeight > 6000) continue;   // 跳过超高的整页容器
      shown++;
      var ccls = String(cb.className || '').slice(0, 34);
      say('  ▸ <' + cb.tagName.toLowerCase() + '> .' + ccls +
          '  w=' + cb.offsetWidth + ' disp=' + getComputedStyle(cb).display +
          ' gtc=\'' + getComputedStyle(cb).gridTemplateColumns + '\'');
      for (var e2 = 0; e2 < cb.children.length && e2 < 6; e2++) {
        var ch = cb.children[e2], ccs = getComputedStyle(ch);
        if (ccs.display === 'none') continue;
        var cr = ch.getBoundingClientRect();
        say('      └ <' + ch.tagName.toLowerCase() + '> .' +
            String(ch.className || '').slice(0, 30) +
            ' w=' + ch.offsetWidth +
            ' left=' + Math.round(cr.left / zoom) +
            ' top=' + Math.round(cr.top / zoom) +
            ' txt=' + (ch.innerText || '').length +
            ' disp=' + ccs.display);
      }
    }
  }

  // ── 渲染浮层 ──
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

    // 按钮条
    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:0;bottom:0;width:100%;z-index:2147483648;' +
      'background:#066ac9;padding:10px;display:flex;gap:8px;box-sizing:border-box;';

    var btnCopy = document.createElement('button');
    btnCopy.textContent = '复制诊断信息';
    var btnClose = document.createElement('button');
    btnClose.textContent = '关闭';
    var css = 'flex:1;padding:11px;font-size:14px;font-weight:600;border:0;border-radius:6px;';
    btnCopy.style.cssText = css + 'background:#fff;color:#066ac9;';
    btnClose.style.cssText = css + 'background:rgba(255,255,255,.25);color:#fff;';

    var ta = document.createElement('textarea');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta);

    btnCopy.onclick = function () {
      ta.value = LINES.join('\n');
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      if (!ok && navigator.clipboard) {
        navigator.clipboard.writeText(ta.value).then(function () {
          btnCopy.textContent = '已复制 ✓';
        }, function () {
          btnCopy.textContent = '复制失败，请手动长按选中';
        });
        return;
      }
      btnCopy.textContent = ok ? '已复制 ✓' : '复制失败，请手动长按选中';
    };
    btnClose.onclick = function () {
      box.remove(); bar.remove(); ta.remove();
    };

    bar.appendChild(btnCopy);
    bar.appendChild(btnClose);
    document.body.appendChild(box);
    document.body.appendChild(bar);
  }

  function boot() {
    try {
      LINES = []; NEAR = [];
      scan();
    } catch (e) {
      say('!! 扫描出错: ' + (e && e.message ? e.message : e));
    }
    try { render(); } catch (e2) { console.error('[诊断] 渲染失败', e2); }
  }

  if (document.readyState === 'complete') setTimeout(boot, 1200);
  else window.addEventListener('load', function () { setTimeout(boot, 1200); });

  // 也挂个接口，方便有控制台时直接取
  window.__zhihuDiag = function () { boot(); return LINES.join('\n'); };
})();
