"""移动模式（不勾选桌面版网站）下，脚本不应破坏知乎"""
from lib import *
import json
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox","--disable-blink-features=AutomationControlled"])
    for label, with_script in [("no_script",None),("with_v4","/workspace/zhihu-mobile/zhihu-desk2mob.user.js")]:
        ctx = b.new_context(locale="zh-CN", **MOBILE_MODE)
        if with_script: ctx.add_init_script(path=with_script)
        pg = ctx.new_page()
        try:
            r = pg.goto("https://www.zhihu.com/question/19550225", wait_until="domcontentloaded", timeout=45000)
            pg.wait_for_timeout(5000)
            m = pg.evaluate(MEASURE_JS)
            print(f"[{label}] status={r.status if r else '?'} final={pg.url}")
            print(f"  zoom={m['zoom']} layoutW={m['layoutW']} cssW={m['cssW']} scrollW={m['scrollWidth']} clientW={m['clientWidth']} overflowX={m['overflowX']} count={m['overflowCount']} textLen={m['textLen']}")
            if m['worst']: print("  最宽 5 个:", m['worst'][:5])
            name = f"mobile_{label}"
            pg.screenshot(path=f"{name}_raw.png")
        except Exception as e:
            print(f"[{label}] ERR",e)
        ctx.close()
    b.close()
