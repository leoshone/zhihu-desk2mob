// patch-thread-back.js — 用行间替换重写「返回键 → 线程视图」这一整块（v1.9.16）
'use strict';
const fs = require('fs');
const P = process.argv[2] || (__dirname + '/../zhihu-desk2mob.user.js');
let s = fs.readFileSync(P, 'utf8');

const START = '  // ---- 评论回复线程视图的返回键（v1.9.7 建立';
const END = '  // ---- 图片查看器（.ImageView）';
const i = s.indexOf(START);
const j = s.indexOf(END);
if (i < 0 || j < 0 || j < i) { console.error('marker not found', i, j); process.exit(1); }

const NEW = `  // ---- 评论回复线程视图：返回键语义（v1.9.16 重写）----
  // 知乎怎么显示线程（真机实测 2026-11-24，问题页 138 条评论）：
  //   · 点「查看全部 N 条回复」→ 知乎在 .Modal-content **末尾追加**一个新视图节点
  //     （列表视图 css-feetku 仍留在原位、仍 display:flex；新线程 css-tpyajk 追加在后面），
  //     然后把弹层滚动容器（.css-1e7fksk，overflow:auto）滚到该节点 —— 用户看到的就是线程页；
  //   · 线程页头部是「‹ 评论回复」，那颗 ‹（svg.ZDI--ArrowLeftSmall24，包在 cursor:pointer
  //     的 div 里）就是知乎自己的返回：点它 → 滚动回 0、线程节点收起，**全程不动 history**。
  //
  // ⚠️ v1.9.7~v1.9.15 八版全败的根因（真机实锤，别再走回头路）：
  //   旧版用「display 手术」模拟切换（列表写 flex、线程写 none），再用「每进一次线程压一层
  //   z2mThread 哨兵」逐层返回。真机上双输：
  //     ① 内联 display 钉死后，知乎自己的切换改不动这些节点 —— 第二次点「查看全部回复」，
  //        知乎复用了被我们藏掉的节点（或我们又把刚建的线程藏掉），界面纹丝不动
  //        = 用户说的「第二次点不动」；
  //     ② 每轮进出压一层哨兵，残留层越堆越多；返回时弹出的是**上一轮的残留层**，判据错位，
  //        落进「关弹层」分支 = 用户说的「跳过评论页直接回问答页」。
  //   （现场证据：用户页 .Modal-content 里躺着 4 个 inline display:none 的线程尸体 + 1 个
  //     可见线程 + 列表 inline flex；history.state 顶层是 z2mThread 而画面是列表 —— 典型错位。）
  // v1.9.16 新模型：
  //   · **不再碰 display**，列表/线程切换完全交给知乎；
  //   · 哨兵**恒为一层**：弹层打开压一层 {z2mComment}；返回键弹出后按当前 UI 决定，需要继续
  //     守弹层就**立刻补压**（re-arm）。栈里永远不会出现第二层哨兵 → 没有残留可错位；
  //   · 返回键语义 = 撤销当前 UI 的一层：
  //       线程视图可见 → 点知乎自己的 ‹（原生回到列表）+ 补压哨兵 → 弹层仍受保护；
  //       列表视图     → 关弹层（不再补压）。
  //   · 旧版本遗留的多层哨兵在启动时静默排空（drainSentinels），一次性清账。
  function threadBackArrow() {
    // 只认「可见」的箭头：线程收起时知乎把节点 display:none，svg 的 rect 为 0
    for (const svg of document.querySelectorAll('svg[class*="ArrowLeft"]')) {
      const r = svg.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      const head = svg.parentElement && svg.parentElement.parentElement;
      const t = (head ? head.textContent : '').replace(/[\\u200b]/g, '').trim();
      if (!/^评论回复/.test(t)) continue;   // 头部那行必须就是「评论回复」
      return svg;
    }
    return null;
  }
  // 点知乎自己的返回箭头。⚠️ 它是个 cursor:pointer 的 div（没有 .click()），React 的监听
  // 挂在根节点上，因此必须按真实指针序列派发。真机/现场实测：派发后滚动容器回 0、线程收起。
  function leaveThreadView() {
    const svg = threadBackArrow();
    if (!svg) return false;
    let el = svg;
    while (el && el !== document.body
           && !(el.tagName === 'BUTTON' || el.getAttribute('role') === 'button'
                || getComputedStyle(el).cursor === 'pointer')) el = el.parentElement;
    const target = (el && el !== document.body) ? el : svg;
    const r = target.getBoundingClientRect();
    const o = {
      bubbles: true, cancelable: true, view: window,
      clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
    };
    try {
      target.dispatchEvent(new PointerEvent('pointerdown', o));
      target.dispatchEvent(new MouseEvent('mousedown', o));
      target.dispatchEvent(new PointerEvent('pointerup', o));
      target.dispatchEvent(new MouseEvent('mouseup', o));
      target.dispatchEvent(new MouseEvent('click', o));
    } catch (e) {
      try { target.dispatchEvent(new MouseEvent('click', o)); } catch (e2) { return false; }
    }
    return true;
  }
  // 补压哨兵（re-arm）：让「弹层开着时栈顶恒有一条哨兵」这个不变式重新成立
  function rearmGuard() {
    try { history.pushState({ z2mComment: 1 }, '', location.href); guardPushed = true; }
    catch (e) { guardPushed = false; }
  }
  // 静默排空残留哨兵。仅用于清理**旧版本**留下的层（新版恒为一层、不会产生残留）：
  // 每 150ms 退一层，落到非 z2m 条目即停，最多 10 层防失控。
  function drainSentinels(depth) {
    const n = depth || 0;
    if (n >= 10) return;
    const cur = history.state;
    if (cur && (cur.z2mThread === 1 || cur.z2mComment === 1)) {
      backOnce();
      setTimeout(() => drainSentinels(n + 1), 150);
    }
  }
  // 点「查看全部 N 条回复」：只记录「内联入口」的滚动锚点，**不再压哨兵、不再碰 display**。
  // v1.9.12 的锚点用途：内联评论 → 独立回复页弹层（点时弹层不存在，点击后知乎新开一个
  // 只有线程视图的弹层）关闭后，知乎会把视口留在回答正文深处，用户看到「跳过评论页」。
  // 变量声明在 pendingReveal 处（避免 TDZ），消费在 syncCommentModal 的关闭边沿。
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    const t = (b.textContent || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '');
    if (!/查看全部\\s*[\\d,]*\\s*条回复/.test(t)) return;
    if (!modalEl()) preThreadScroll = { y: Math.round(scrollY), until: Date.now() + 60000 };
  }, true);

  // 返回键：弹出栈顶哨兵后，按当前 UI 决定回到哪一层
  window.addEventListener('popstate', () => {
    if (selfPop) { selfPop = false; return; }
    guardPushed = false;                 // 栈顶哨兵已被用户弹出
    if (modalEl()) {
      // 线程视图 → 交给知乎自己的 ‹ 原生回到列表，再补压一层守住弹层
      if (leaveThreadView()) { rearmGuard(); return; }
      // 列表视图 → 关弹层（不再补压），顺带清掉旧版本残留
      closeCommentModal();
      drainSentinels();
      return;
    }
    // 弹层已关或从未开：弹出的是旧版本残留哨兵 → 排空，避免多吃用户一次返回
    drainSentinels();
  });

`;

s = s.slice(0, i) + NEW + s.slice(j);
fs.writeFileSync(P, s);
console.log('patched, new length', s.length);
