"""验证 v0.7.14「返回键 → 模拟点击弹层外区域」关闭弹层。

复刻页 testpage_click_outside.html：
  • 弹层遮罩只监听自身 click（e.target === overlay 才关）
  • 没有关闭按钮、不监听 ESC → closeTopModal 前两级必然失败
  • 只能靠「点击弹层外」或 forceHide 兜底

断言（关键：必须是 clickOutside 生效，而不是 forceHide 兜底）：
  1) 弹层打开后按返回 → 弹层关闭、留在本页
  2) 日志里出现「点击弹层外生效」—— 证明走的是新路径，不是兜底
  3) __closedByClickOutside 计数 ≥ 1 —— 证明知乎式 backdrop 监听真的收到了合成 click
  4) 第 2 次返回 → 正常退出页面（不劫持）
"""
from lib import *
from playwright.sync_api import sync_playwright
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
URL = "http://127.0.0.1:8753/testpage_click_outside.html"

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    ctx = b.new_context(**DESKTOP_MODE)
    ctx.add_init_script(path=V4)
    pg = ctx.new_page()
    errs, logs = [], []
    pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
    pg.on("console", lambda m: logs.append(m.text))
    pg.goto(URL, wait_until="load", timeout=30000)
    pg.wait_for_timeout(1200)

    snap = lambda: pg.evaluate("""() => ({
        url: location.href,
        st: history.state,
        overlayShown: document.getElementById('overlay').classList.contains('show'),
        closedByClickOutside: window.__closedByClickOutside || 0
    })""")

    # 开弹层
    pg.evaluate("document.getElementById('entry').click()")
    pg.wait_for_timeout(800)
    s0 = snap()
    print("开弹层后:", s0)

    # 第 1 次返回
    print()
    print(">> 第 1 次返回")
    try:
        pg.go_back(wait_until="commit", timeout=8000)
    except Exception as e:
        print("   异常:", str(e)[:60])
    pg.wait_for_timeout(2000)
    s1 = snap()
    print("   返回后:", s1)

    # 第 2 次返回
    print()
    print(">> 第 2 次返回")
    try:
        pg.go_back(wait_until="commit", timeout=8000)
    except Exception as e:
        print("   异常:", str(e)[:60])
    pg.wait_for_timeout(2000)
    s2 = pg.evaluate("() => ({url: location.href})")
    print("   返回后:", s2)

    print()
    print("== 脚本日志 ==")
    for l in logs:
        if "弹层" in l:
            print("   ", l[:130])

    closed_via_click_outside = s1["overlayShown"] is False and s1["closedByClickOutside"] >= 1
    stayed = s1["url"] == s0["url"]
    escaped = s2["url"] != s1["url"]

    print()
    print("弹层已关(经 backdrop 点击):", closed_via_click_outside,
          "(计数=%s)" % s1["closedByClickOutside"])
    print("第1次返回留在本页:", stayed)
    print("第2次返回正常退出:", escaped)
    print("pageerror:", errs[:3])

    log_hit = any("点击弹层外生效" in l for l in logs)
    print("日志确认走 clickOutside 路径:", log_hit)

    ok = (closed_via_click_outside and stayed and escaped and log_hit and not errs)
    print()
    print("结论:", "✅ 通过" if ok else "❌ 未通过")
    b.close()
    sys.exit(0 if ok else 1)
