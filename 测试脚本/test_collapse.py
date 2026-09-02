"""复现「正文宽度逐层塌缩」：嵌套 flex + flex-shrink:0 + min-width 的场景"""
from lib import *
from playwright.sync_api import sync_playwright
import os

HERE = os.path.dirname(os.path.abspath(__file__))
V4 = "/workspace/zhihu-mobile/zhihu-desk2mob.user.js"
URL = "file://" + os.path.join(HERE, "testpage_collapse.html")

CHAIN = r"""
() => {
  const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const se = document.scrollingElement || document.documentElement;
  const picks = ['.Post-content', '.css-kjzwqj', '.css-c0fani', '.css-yq5nsh',
                 'article.Post-Main', '.Comments-container', '.RichText'];
  const out = [];
  for (const s of picks) {
    const el = document.querySelector(s);
    if (!el) { out.push({ sel: s, miss: true }); continue; }
    const cs = getComputedStyle(el);
    out.push({
      sel: s,
      w: el.offsetWidth,
      cssW: cs.width,
      disp: cs.display,
      flex: cs.flex,
      shrink: cs.flexShrink,
      minW: cs.minWidth,
      txt: (el.innerText || '').trim().length,
      style: (el.getAttribute('style') || '').replace(/\s+/g, ' ').slice(0, 110),
    });
  }
  return {
    zoom: +zoom.toFixed(4),
    cssW: Math.round(document.documentElement.clientWidth / zoom),
    overflowX: se.scrollWidth - se.clientWidth,
    chain: out,
  };
}
"""

def show(tag, d):
    print(f"\n===== {tag} =====")
    print(f"zoom={d['zoom']} cssW={d['cssW']} overflowX={d['overflowX']}")
    print(f"  {'元素':<28}{'实测宽':>7} {'css宽':>10} {'disp':<12}{'shrink':>7} {'minW':>9} txt")
    for c in d["chain"]:
        if c.get("miss"):
            print(f"  {c['sel']:<28}(不存在)")
            continue
        print(f"  {c['sel']:<28}{c['w']:>7} {c['cssW']:>10} {c['disp']:<12}"
              f"{c['shrink']:>7} {c['minW']:>9} {c['txt']}")
        if c["style"]:
            print(f"      style: {c['style']}")

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
        show(label, pg.evaluate(CHAIN))
        if errs:
            print("  pageerror:", errs[:2])
        ctx.close()
    b.close()
