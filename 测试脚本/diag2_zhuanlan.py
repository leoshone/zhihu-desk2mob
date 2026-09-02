"""再探专栏页：先建会话再进，重点 dump「侧栏 → 祖先链」的真实 DOM 层级。

修复 fitColumns 的关键是知道真实页面里主列和侧栏是不是同一个父容器的直接子元素。
登录墙只替换正文内容，容器骨架通常还在，所以即使拿不到全文也够用。
"""
from lib import *
from playwright.sync_api import sync_playwright

V4 = "/workspace/zhihu-mobile/zhihu-desk2mob.user.js"
URLS = [
    "https://zhuanlan.zhihu.com/p/2044268985798104354",
    "https://zhuanlan.zhihu.com/p/662218709",
    "https://www.zhihu.com/p/2044268985798104354",
]

# 以侧栏线索为锚，向上爬祖先链，输出每一层的布局信息
ANCESTOR_JS = r"""
() => {
  const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const se = document.scrollingElement || document.documentElement;

  // 找「侧栏」候选：语义类名 + 位置偏右
  const sels = ['aside', '.Post-SideColumn', '.ColumnSideBar', '.GlobalSideBar',
                '.Post-Row-Content-right', '.ColumnPageSidebar', '.Profile-sideColumn',
                '[class*="SideColumn"]', '[class*="SideBar"]', '[class*="Sidebar"]'];
  const found = new Map();
  for (const s of sels) {
    for (const el of document.querySelectorAll(s)) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      if (el.offsetWidth < 80) continue;
      found.set(el, s);
    }
  }

  function info(el) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 55),
      w: Math.round(el.offsetWidth),
      left: Math.round(r.left / zoom),
      top: Math.round((r.top + window.scrollY) / zoom),
      disp: cs.display,
      gtc: cs.gridTemplateColumns === 'none' ? '' : cs.gridTemplateColumns,
      flexWrap: cs.flexWrap,
      minW: cs.minWidth,
      kids: el.children.length,
      txt: (el.innerText || '').trim().length,
    };
  }

  const chains = [];
  for (const [el, sel] of found) {
    const chain = [];
    let cur = el;
    for (let i = 0; i < 5 && cur && cur !== document.body; i++) {
      const parent = cur.parentElement;
      if (!parent) break;
      // 父的直接子元素里，和 cur 在同一行的有哪些
      const sibs = [];
      for (const k of parent.children) {
        const ks = getComputedStyle(k);
        if (ks.display === 'none') continue;
        if (k.offsetWidth < 60) continue;
        sibs.push(info(k));
      }
      chain.push({ self: info(cur), parent: info(parent), sibs: sibs });
      cur = parent;
    }
    chains.push({ sel: sel, chain: chain });
    if (chains.length >= 4) break;
  }

  return {
    zoom: +zoom.toFixed(4),
    cssW: Math.round(document.documentElement.clientWidth / zoom),
    overflowX: se.scrollWidth - se.clientWidth,
    title: document.title.slice(0, 60),
    bodyTxt: (document.body.innerText || '').trim().length,
    unhuman: !!document.querySelector('.Unhuman'),
    signin: /登录后|请你登录|请您登录/.test(document.body.innerText || ''),
    err: /存在异常|限制本次访问/.test(document.body.innerText || ''),
    chains: chains,
  };
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
    for attempt, url in enumerate(URLS, 1):
        ctx = b.new_context(locale="zh-CN", **DESKTOP_MODE)
        # 先访问首页建立会话 cookie，再进专栏页
        pg = ctx.new_page()
        try:
            pg.goto("https://www.zhihu.com/", wait_until="domcontentloaded", timeout=30000)
            pg.wait_for_timeout(2500)
        except Exception as e:
            print("  首页:", str(e)[:50])
        try:
            pg.goto(url, wait_until="domcontentloaded", timeout=40000)
        except Exception as e:
            print("  专栏页:", str(e)[:50])
        pg.wait_for_timeout(5000)

        d = pg.evaluate(ANCESTOR_JS)
        print(f"\n{'='*70}")
        print(f"[{attempt}] {url}")
        print(f"    title={d['title']}")
        print(f"    zoom={d['zoom']} cssW={d['cssW']} overflowX={d['overflowX']} "
              f"bodyTxt={d['bodyTxt']}")
        print(f"    登录墙={d['unhuman'] or d['signin']}  风控={d['err']}")
        print(f"    命中侧栏候选：{len(d['chains'])} 个")

        for c in d["chains"]:
            print(f"\n  ── 命中选择器：{c['sel']}")
            for i, lv in enumerate(c["chain"][:3]):
                s, pa = lv["self"], lv["parent"]
                ind = "     " + "  " * i
                print(f"{ind}└─ 自身 <{s['tag']}> .{s['cls'][:36]} w={s['w']} left={s['left']} "
                      f"top={s['top']} disp={s['disp']}")
                print(f"{ind}   父 <{pa['tag']}> .{pa['cls'][:36]} w={pa['w']} "
                      f"disp={pa['disp']} gtc='{pa['gtc']}' wrap={pa['flexWrap']} "
                      f"kids={pa['kids']}")
                for sb in lv["sibs"]:
                    print(f"{ind}     └ 兄弟 <{sb['tag']}> .{sb['cls'][:32]} "
                          f"w={sb['w']} left={sb['left']} top={sb['top']} txt={sb['txt']}")
        pg.screenshot(path=f"/tmp/zl2_{attempt}.png")
        ctx.close()

        if d["chains"]:
            print(f"\n  >>> 第 {attempt} 个 URL 拿到结构，停止尝试")
            break
    b.close()
