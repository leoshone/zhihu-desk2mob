"""验证 __zhihuFit() 自检入口 + 旋屏 + SPA 导航(点击回答) 后的稳定性"""
from lib import *

V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
    ctx = b.new_context(locale="zh-CN", **DESKTOP_MODE)
    ctx.add_init_script(path=V4)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:100]))
    pg.goto("https://www.zhihu.com/question/19550225", wait_until="domcontentloaded", timeout=45000)
    pg.wait_for_timeout(5000)

    print("自检 __zhihuFit():", pg.evaluate("() => window.__zhihuFit ? window.__zhihuFit() : 'MISSING'"))

    # 旋屏：竖 -> 横 (852x393)
    pg.set_viewport_size({"width": 2130, "height": 980})  # 横屏下 layout 仍被撑宽
    pg.wait_for_timeout(2500)
    print("旋屏后:", pg.evaluate("() => window.__zhihuFit()"))
    print("  screen.width =", pg.evaluate("() => screen.width"))
    m = pg.evaluate(MEASURE_JS)
    print(f"  zoom={m['zoom']} cssW={m['cssW']} overflowX={m['overflowX']} count={m['overflowCount']}")

    # 转回竖屏
    pg.set_viewport_size({"width": 980, "height": 2130})
    pg.wait_for_timeout(2500)
    print("转回竖屏:", pg.evaluate("() => window.__zhihuFit()"))
    m = pg.evaluate(MEASURE_JS)
    print(f"  zoom={m['zoom']} cssW={m['cssW']} overflowX={m['overflowX']} count={m['overflowCount']}")

    # SPA 导航：点一个站内链接
    try:
        links = pg.query_selector_all("a[href^='/question/'], a[href^='/p/'], a[href^='/answer/']")
        href = None
        for l in links:
            h = l.get_attribute("href")
            if h and h != "/question/19550225" and len(h) > 12:
                href = h; break
        if href:
            print("SPA 导航到:", href)
            pg.evaluate(f"() => location.href = '{href}'")
            pg.wait_for_timeout(6000)
            print("  导航后:", pg.evaluate("() => window.__zhihuFit()"))
            m = pg.evaluate(MEASURE_JS)
            print(f"  zoom={m['zoom']} cssW={m['cssW']} overflowX={m['overflowX']} count={m['overflowCount']} textLen={m['textLen']}")
    except Exception as e:
        print("SPA 导航跳过:", str(e)[:80])

    print("pageerror:", errs[:4])
    b.close()
