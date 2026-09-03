"""验证诊断脚本在两栏测试页上能正常工作并输出合理结论"""
from lib import *
from playwright.sync_api import sync_playwright
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DIAG = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-diag.user.js"
V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
URL = "file://" + os.path.join(HERE, "testpage_zhuanlan.html")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for label, scripts in (("诊断脚本（单独）", [DIAG]),
                           ("主脚本 + 诊断脚本", [V4, DIAG])):
        ctx = b.new_context(**DESKTOP_MODE)
        for s in scripts:
            ctx.add_init_script(path=s)
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
        pg.goto(URL, wait_until="load", timeout=30000)
        pg.wait_for_timeout(2500)

        print(f"\n{'='*66}\n===== {label} =====")
        has = pg.evaluate("!!document.getElementById('zf-diag-panel')")
        print("浮层是否出现:", has)
        if has:
            txt = pg.evaluate("document.getElementById('zf-diag-panel').innerText")
            print(txt[:2600])
        print("pageerror:", errs[:2] if errs else "无")
        pg.screenshot(path=f"/tmp/diag_{'both' if len(scripts) > 1 else 'only'}.png")
        ctx.close()
    b.close()
