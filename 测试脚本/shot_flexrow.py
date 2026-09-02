"""生成 flex 崩塌「修复前 / 修复后 / 无脚本」三张对比截图"""
from lib import *
from playwright.sync_api import sync_playwright
import os, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
V4 = "/workspace/zhihu-mobile/zhihu-desk2mob.user.js"
URL = "file://" + os.path.join(HERE, "testpage_flexrow.html")
OUT = "/workspace/zhihu-mobile/测试截图"

def variant(src, dst, on):
    with open(src, encoding="utf-8") as f:
        txt = f.read()
    a = "fixFlexRows:  true,"
    b = "fixFlexRows:  false,"
    assert a in txt, "找不到 fixFlexRows 配置行"
    with open(dst, "w", encoding="utf-8") as f:
        f.write(txt.replace(a, b) if not on else txt)
    return dst

OFF = variant(V4, os.path.join(tempfile.gettempdir(), "zf_noflexrow.js"), False)

M = r"""
() => {
  const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const se = document.scrollingElement || document.documentElement;
  const art = document.querySelector('article.Post-Main');
  const box = document.querySelector('.css-kjzwqj');
  return {
    zoom: +zoom.toFixed(4),
    cssW: Math.round(document.documentElement.clientWidth / zoom),
    overflowX: se.scrollWidth - se.clientWidth,
    articleW: art.offsetWidth,
    wrap: getComputedStyle(box).flexWrap,
  };
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for label, script, fname in (
        ("无脚本", None, "flex崩塌-无脚本.png"),
        ("修复前", OFF, "flex崩塌-修复前.png"),
        ("修复后", V4, "flex崩塌-修复后.png"),
    ):
        ctx = b.new_context(**DESKTOP_MODE)
        if script:
            ctx.add_init_script(path=script)
        pg = ctx.new_page()
        pg.goto(URL, wait_until="load", timeout=30000)
        pg.wait_for_timeout(3000)
        m = pg.evaluate(M)
        print(f"[{label}] zoom={m['zoom']} cssW={m['cssW']} overflowX={m['overflowX']} "
              f"正文宽={m['articleW']} wrap={m['wrap']}")
        pg.screenshot(path=os.path.join(OUT, fname))
        ctx.close()
    b.close()
