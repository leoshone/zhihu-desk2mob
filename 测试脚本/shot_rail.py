"""生成右侧栏去除的对比截图（专栏页 / 首页 × 无脚本 / 装脚本）"""
from lib import *
from playwright.sync_api import sync_playwright
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SHOT = os.path.join(os.path.dirname(HERE), "测试截图")
V4 = "/workspace/zhihu-mobile/zhihu-desk2mob.user.js"
BASE = "file://" + os.path.join(HERE, "testpage_rail.html")

JOBS = [
    ("",    "专栏页", "侧栏-专栏页"),
    ("#home", "首页",   "侧栏-首页"),
]

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for hash_, name, fname in JOBS:
        for mode, script in (("无脚本", None), ("装脚本", V4)):
            ctx = b.new_context(**DESKTOP_MODE)
            if script:
                ctx.add_init_script(path=script)
            pg = ctx.new_page()
            pg.goto(BASE + hash_, wait_until="load", timeout=30000)
            pg.wait_for_timeout(3000)
            # 只截上半屏，侧栏的差异都在首屏
            pg.screenshot(path=os.path.join(SHOT, f"{fname}-{mode}.png"),
                          clip={"x": 0, "y": 0, "width": 980, "height": 900})
            print("saved", f"{fname}-{mode}.png")
            ctx.close()
    b.close()
