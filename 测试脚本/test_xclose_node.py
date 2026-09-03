"""回归：弹层用节点移除方式关闭（复刻知乎真实行为）时，缓冲历史必须被 onModalGone 清掉。"""
from lib import *
from playwright.sync_api import sync_playwright
import os, sys
V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
URL = "http://127.0.0.1:8753/testpage_spa_node.html"

def h(pg):
    return pg.evaluate("""() => ({
        len: history.length, state: history.state,
        cm: !!document.getElementById('cm'),
        home: document.getElementById('home').classList.contains('active'),
        art: document.getElementById('article').classList.contains('active')
    })""")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    ctx = b.new_context(**DESKTOP_MODE)
    ctx.add_init_script(path=V4)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
    pg.goto(URL, wait_until="load", timeout=30000)
    pg.wait_for_timeout(1200)
    pg.click("#btnEnter"); pg.wait_for_timeout(500)
    pg.click("#btnComment"); pg.wait_for_timeout(600)
    print("开弹层后:", h(pg))
    buf = bool(h(pg)["state"] and h(pg)["state"].get("zfModal") == 1)
    # 真实行为：移除节点（childList 突变）→ 触发 observer → onModalGone
    pg.evaluate("var c=document.getElementById('cm'); if(c) c.remove();")
    pg.wait_for_timeout(700)
    after_x = h(pg)
    print("节点移除后:", after_x)
    buf_cleared = not (after_x["state"] and after_x["state"].get("zfModal") == 1)
    print("  缓冲历史已清:", buf_cleared, "| 弹层消失:", not after_x["cm"], "| 仍在本页:", after_x["art"] and not after_x["home"])
    # 再按返回 → 应回到首页
    try:
        pg.go_back(wait_until="commit", timeout=8000)
    except Exception as e:
        print("  go_back 异常:", str(e)[:60])
    pg.wait_for_timeout(800)
    after_back = h(pg)
    print("移除后再返回:", after_back)
    back_home = after_back["home"] and not after_back["art"]
    print("\npageerror:", errs[:3])
    ok = buf and buf_cleared and (not after_x["cm"]) and after_x["art"] and not after_x["home"] and back_home and not errs
    print("结论:", "✅ 通过" if ok else "❌ 未通过")
    b.close()
    sys.exit(0 if ok else 1)
