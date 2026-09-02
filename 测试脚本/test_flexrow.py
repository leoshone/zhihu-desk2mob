"""复现：flex 容器多 item 分摊导致正文被压塌"""
from lib import *
from playwright.sync_api import sync_playwright
import os

HERE = os.path.dirname(os.path.abspath(__file__))
V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
URL = "file://" + os.path.join(HERE, "testpage_flexrow.html")

M = r"""
() => {
  const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const se = document.scrollingElement || document.documentElement;
  const box = document.querySelector('.css-kjzwqj');
  const kids = [];
  for (const k of box.children) {
    const cs = getComputedStyle(k);
    kids.push({
      cls: String(k.className || '').slice(0, 20),
      w: k.offsetWidth,
      txt: (k.innerText || '').trim().length,
      shrink: cs.flexShrink,
      minW: cs.minWidth,
    });
  }
  const art = document.querySelector('article.Post-Main');
  return {
    zoom: +zoom.toFixed(4),
    cssW: Math.round(document.documentElement.clientWidth / zoom),
    overflowX: se.scrollWidth - se.clientWidth,
    boxW: box.offsetWidth,
    boxWrap: getComputedStyle(box).flexWrap,
    kids: kids,
    articleW: art.offsetWidth,
    richW: document.querySelector('.RichText').offsetWidth,
  };
}
"""

def show(tag, d):
    print(f"\n===== {tag} =====")
    print(f"zoom={d['zoom']} cssW={d['cssW']} overflowX={d['overflowX']}")
    print(f"  flex容器 .css-kjzwqj  宽={d['boxW']}  wrap={d['boxWrap']}")
    print(f"  {'子元素':<22}{'宽':>6} {'shrink':>7} {'minW':>9} txt")
    for k in d["kids"]:
        print(f"  .{k['cls']:<21}{k['w']:>6} {k['shrink']:>7} {k['minW']:>9} {k['txt']}")
    print(f"  → article.Post-Main 宽={d['articleW']}   .RichText 宽={d['richW']}")
    if d["articleW"] < 200:
        print("  ✗ 正文被压塌")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for label, script in (("无脚本", None), ("装主脚本 v0.2.1", V4)):
        ctx = b.new_context(**DESKTOP_MODE)
        if script:
            ctx.add_init_script(path=script)
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
        pg.goto(URL, wait_until="load", timeout=30000)
        pg.wait_for_timeout(3000)
        show(label, pg.evaluate(M))
        if errs:
            print("  pageerror:", errs[:2])
        ctx.close()
    b.close()
