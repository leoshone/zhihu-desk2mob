"""在复刻的两栏布局测试页上验证 fitColumns 逻辑"""
from lib import *
from playwright.sync_api import sync_playwright

V4 = "/workspace/zhihu-mobile/zhihu-desk2mob.user.js"
URL = "file:///workspace/zhihu-mobile/测试脚本/testpage_zhuanlan.html"

MEASURE = r"""
() => {
  const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const se = document.scrollingElement || document.documentElement;
  function pick(sel) {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      w: el.offsetWidth,
      left: Math.round(r.left / zoom),
      top: Math.round((r.top + window.scrollY) / zoom),
      display: cs.display,
      visible: cs.display !== 'none',
      txt: (el.innerText || '').trim().length,
    };
  }
  return {
    zoom: +zoom.toFixed(4),
    cssW: Math.round(document.documentElement.clientWidth / zoom),
    overflowX: se.scrollWidth - se.clientWidth,
    A_main: pick('.css-main01'), A_side: pick('.css-side01'),
    B_main: pick('.css-main02'), B_side: pick('.css-side02'),
  };
}
"""

def show(tag, m):
    print(f"\n===== {tag} =====")
    print(f"zoom={m['zoom']} cssW={m['cssW']} overflowX={m['overflowX']}")
    for k in ("A_main", "A_side", "B_main", "B_side"):
        v = m[k]
        if not v:
            continue
        vis = "" if v["visible"] else "  [已隐藏]"
        print(f"  {k:<7} w={v['w']:>4} left={v['left']:>4} top={v['top']:>5} "
              f"txt={v['txt']:>4} disp={v['display']:<12}{vis}")

    # 判定
    for pair, tag2 in ((("A_main", "A_side"), "flex 变体"), (("B_main", "B_side"), "grid 变体")):
        m1, s1 = m[pair[0]], m[pair[1]]
        if not m1 or not s1:
            continue
        if not s1["visible"]:
            print(f"  → {tag2}: 侧栏已隐藏，主列宽 {m1['w']}")
        elif s1["top"] > m1["top"] + 20:
            print(f"  → {tag2}: 侧栏已移到底部 ✓（主列 top={m1['top']} 侧栏 top={s1['top']}）")
        else:
            print(f"  → {tag2}: 侧栏仍在主列右侧 ✗（主列宽仅 {m1['w']}）")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for label, script in (("无脚本", None), ("装脚本 v0.1", V4)):
        ctx = b.new_context(**DESKTOP_MODE)
        if script:
            ctx.add_init_script(path=script)
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
        pg.goto(URL, wait_until="load", timeout=30000)
        pg.wait_for_timeout(3000)
        show(label, pg.evaluate(MEASURE))
        if errs:
            print("  pageerror:", errs[:2])
        pg.screenshot(path=f"/tmp/cols_{'with' if script else 'no'}.png")
        ctx.close()
    b.close()
