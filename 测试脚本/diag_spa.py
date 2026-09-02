"""诊断 SPA 导航后 screen 读数，验证修复"""
from lib import *
V4 = "/workspace/zhihu-mobile/zhihu-desk2mob.user.js"
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
    ctx = b.new_context(locale="zh-CN", **DESKTOP_MODE)
    ctx.add_init_script(path=V4)
    pg = ctx.new_page()
    pg.goto("https://www.zhihu.com/question/19550225", wait_until="domcontentloaded", timeout=45000)
    pg.wait_for_timeout(5000)

    def snap(tag):
        d = pg.evaluate(r"""() => ({
          screenW: screen.width, screenH: screen.height,
          innerW: innerWidth, innerH: innerHeight,
          layoutW: document.documentElement.clientWidth,
          landscape: matchMedia('(orientation: landscape)').matches,
          zoom: getComputedStyle(document.documentElement).zoom,
          fit: window.__zhihuFit ? window.__zhihuFit() : null,
          vvW: visualViewport ? Math.round(visualViewport.width) : null,
          vvScale: visualViewport ? +visualViewport.scale.toFixed(3) : null,
        })""")
        print(f"[{tag}] screen={d['screenW']}x{d['screenH']} inner={d['innerW']}x{d['innerH']} "
              f"layout={d['layoutW']} landscape={d['landscape']} vvScale={d['vvScale']}")
        print(f"        zoom={d['zoom']} fit={d['fit']}")

    snap("初始竖屏")
    pg.set_viewport_size({"width": 2130, "height": 980}); pg.wait_for_timeout(2500); snap("旋屏横")
    pg.set_viewport_size({"width": 980, "height": 2130}); pg.wait_for_timeout(2500); snap("转回竖")

    pg.evaluate("() => location.href = '/question/20120168'"); pg.wait_for_timeout(6000)
    snap("SPA导航后")
    pg.wait_for_timeout(3000); snap("SPA+3s")

    m = pg.evaluate(MEASURE_JS)
    print(f"最终: zoom={m['zoom']} cssW={m['cssW']} overflowX={m['overflowX']} count={m['overflowCount']}")
    pg.screenshot(path="/tmp/spa_final.png")
    b.close()
