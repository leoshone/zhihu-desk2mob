"""grid 变体单独成页截图，补视觉证据"""
from lib import *
from playwright.sync_api import sync_playwright

import tempfile, os

HERE = os.path.dirname(os.path.abspath(__file__))
V4 = os.path.join(HERE, "..", "zhihu-desk2mob.user.js")
URL = "file://" + os.path.join(HERE, "testpage_grid.html")
OUT = os.path.join(HERE, "..", "测试截图")

def make_hide_variant(src, dst):
    """由主脚本派生 sideColumn='hide' 变体，避免依赖手改的临时文件"""
    with open(src, encoding="utf-8") as f:
        txt = f.read()
    assert "sideColumn:   'bottom'" in txt, "主脚本里找不到 sideColumn 配置行"
    with open(dst, "w", encoding="utf-8") as f:
        f.write(txt.replace("sideColumn:   'bottom'", "sideColumn:   'hide'"))
    return dst

HIDE = make_hide_variant(V4, os.path.join(tempfile.gettempdir(), "zf_hide.js"))

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
      h: el.offsetHeight,
      display: cs.display,
      visible: cs.display !== 'none',
      txt: (el.innerText || '').trim().length,
    };
  }
  const wrap = document.querySelector('.css-wrap02');
  return {
    zoom: +zoom.toFixed(4),
    cssW: Math.round(document.documentElement.clientWidth / zoom),
    overflowX: se.scrollWidth - se.clientWidth,
    gtc: wrap ? getComputedStyle(wrap).gridTemplateColumns : null,
    B_main: pick('.css-main02'), B_side: pick('.css-side02'),
  };
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for label, script, fname in (
        ("无脚本", None, "grid变体-无脚本.png"),
        ("装脚本-底部", V4, "grid变体-侧栏移到底部.png"),
        ("装脚本-隐藏", HIDE, "grid变体-侧栏隐藏.png"),
    ):
        ctx = b.new_context(**DESKTOP_MODE)
        if script:
            ctx.add_init_script(path=script)
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
        pg.goto(URL, wait_until="load", timeout=30000)
        pg.wait_for_timeout(3000)
        m = pg.evaluate(MEASURE)
        print(f"\n===== {label} =====")
        print(f"zoom={m['zoom']} cssW={m['cssW']} overflowX={m['overflowX']}")
        print(f"  grid-template-columns = {m['gtc']}")
        for k in ("B_main", "B_side"):
            v = m[k]
            vis = "" if v["visible"] else "  [已隐藏]"
            print(f"  {k:<7} w={v['w']:>4} left={v['left']:>4} top={v['top']:>5} "
                  f"h={v['h']:>4} txt={v['txt']:>4} disp={v['display']:<12}{vis}")
        mm, ss = m["B_main"], m["B_side"]
        if not ss["visible"]:
            print(f"  → grid 变体: 侧栏已隐藏，主列宽 {mm['w']}")
        elif ss["top"] > mm["top"] + 20:
            print(f"  → grid 变体: 侧栏已移到底部 ✓（主列 top={mm['top']} 侧栏 top={ss['top']}）")
        else:
            print(f"  → grid 变体: 侧栏仍在主列右侧 ✗（主列宽仅 {mm['w']}）")
        if errs:
            print("  pageerror:", errs[:2])
        pg.screenshot(path=f"{OUT}/{fname}")
        print(f"  截图 → {OUT}/{fname}")
        ctx.close()
    b.close()
