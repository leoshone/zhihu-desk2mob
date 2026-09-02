"""最终回归：三种配置 × 两个 URL，桌面模式 + 移动模式，量化对比。"""
from lib import *
from PIL import Image
import json, os

V4 = "/workspace/zhihu-mobile/zhihu-desk2mob.user.js"
V3 = "/root/uploads/1788273074515509197-zhihu-desk2mob.user.js"
URLS = ["https://www.zhihu.com/question/19550225", "https://www.zhihu.com/explore"]

CASES = [("no_script", None), ("v3", V3), ("v4", V4)]

def measure(pg, url, label, mode):
    try:
        pg.goto(url, wait_until="domcontentloaded", timeout=45000)
    except Exception as e:
        print(f"  goto warn: {str(e)[:60]}")
    pg.wait_for_timeout(5000)
    # 触发懒加载
    for y in (800, 1800, 3000):
        pg.mouse.wheel(0, y); pg.wait_for_timeout(400)
    pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(600)
    m = pg.evaluate(MEASURE_JS)
    name = url.rstrip('/').split('/')[-1]
    print(f"  [{mode}/{label}] {name}: zoom={m['zoom']} layoutW={m['layoutW']} cssW={m['cssW']} "
          f"scrollW={m['scrollWidth']} clientW={m['clientWidth']} overflowX={m['overflowX']} "
          f"count={m['overflowCount']} textLen={m['textLen']}")
    for w in m['worst'][:4]:
        print(f"      {w['w']:>5}px <{w['tag']}> .{w['cls'][:40]} [{w['pos']}]")
    return m, name

out = {}
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
    for mode, kw in (("DESKTOP", DESKTOP_MODE), ("MOBILE", MOBILE_MODE)):
        print(f"===== {mode} =====")
        for label, script in CASES:
            ctx = b.new_context(locale="zh-CN", **kw)
            errs = []
            if script:
                ctx.add_init_script(path=script)
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
            for url in URLS:
                m, name = measure(pg, url, label, mode)
                out[f"{mode}/{label}/{name}"] = m
                if label == "v4" and mode == "DESKTOP":
                    pg.screenshot(path=f"reg_{mode}_{label}_{name}.png", full_page=False)
            if errs:
                print(f"      pageerror: {errs[:2]}")
            ctx.close()
    b.close()

json.dump(out, open("regress.json", "w"), ensure_ascii=False, indent=1)
print("\nsaved regress.json")
