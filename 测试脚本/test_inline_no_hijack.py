"""内联评论区：返回键【不应该】被干预（v0.7.13 需求变更）

需求（用户 2026-09-07）：
  「如果评论是弹出来的弹窗，才返回关闭；如果评论是展开的内联，你不用管。」

本用例专门守住「内联不干预」这条红线：
  场景一 点击评论入口（复刻页是内联展开，不弹窗）→ 按返回 → 必须正常后退
  场景二 纯滚动到评论区（无点击）          → 按返回 → 必须正常后退

反例即 v0.7.8~v0.7.12 的行为：滚过阈值/点了评论入口就压缓冲，
返回键被吃掉一格变成「滚回顶部」，用户得按两次才退得出去。
"""
from lib import *
from playwright.sync_api import sync_playwright
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
BASE = "http://127.0.0.1:8753/testpage_zhuanlan_inline.html"


def hstate(pg):
    return pg.evaluate("""() => ({
        url: location.href,
        len: history.length,
        state: history.state,
        commentsShown: document.getElementById('comments').classList.contains('show'),
        articleActive: getComputedStyle(document.getElementById('article')).display !== 'none'
    })""")


def back(pg):
    try:
        pg.go_back(wait_until="commit", timeout=8000)
    except Exception as e:
        print("  go_back 异常:", str(e)[:60])
    pg.wait_for_timeout(1200)


with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    ctx = b.new_context(**DESKTOP_MODE)
    ctx.add_init_script(path=V4)
    pg = ctx.new_page()
    errs, logs = [], []
    pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
    pg.on("console", lambda m: logs.append(m.text))
    pg.goto(BASE, wait_until="load", timeout=30000)
    pg.wait_for_timeout(1200)

    # 进文章
    pg.evaluate("document.getElementById('enter').click()")
    pg.wait_for_timeout(600)
    print("进入文章:", hstate(pg)["url"].split("/")[-1])

    # ── 场景一：点评论入口（内联展开，不弹窗）──
    print()
    print("=== 场景一：点评论入口（内联展开）→ 按返回应正常后退 ===")
    pg.evaluate("document.getElementById('commentEntry').click()")
    pg.wait_for_timeout(2000)          # 等过 800ms 的试探撤销窗口
    s0 = hstate(pg)
    print("  点击后(等2s):", s0["url"].split("/")[-1], "| state:", s0["state"])
    back(pg)
    s1 = hstate(pg)
    back_ok_1 = s1["url"] != s0["url"]
    print("  按返回后:", s1["url"].split("/")[-1], "| 正常后退:", back_ok_1)

    # ── 场景二：纯滚动到评论区（无点击）──
    print()
    print("=== 场景二：纯滚动到评论区 → 按返回应正常后退 ===")
    pg.goto(BASE, wait_until="load", timeout=30000)
    pg.wait_for_timeout(1000)
    pg.evaluate("document.getElementById('enter').click()")
    pg.wait_for_timeout(600)
    pg.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
    pg.wait_for_timeout(1500)
    s2 = hstate(pg)
    print("  深滚后: state:", s2["state"], "(应为 None/无 zfModal —— 内联不压缓冲)")
    no_buffer = not (s2["state"] and (s2["state"].get("zfModal") or s2["state"].get("zfStay")))
    back(pg)
    s3 = hstate(pg)
    back_ok_2 = s3["url"] != s2["url"]
    print("  按返回后:", s3["url"].split("/")[-1], "| 正常后退:", back_ok_2)

    print()
    print("== 脚本日志 ==")
    for l in logs:
        if "弹层" in l:
            print("  ", l[:120])

    print()
    print("内联场景未压缓冲:", no_buffer)
    print("点入口后按返回正常后退:", back_ok_1)
    print("滚动后按返回正常后退:", back_ok_2)
    ok = no_buffer and back_ok_1 and back_ok_2 and not errs
    print("结论:", "✅ 通过（内联评论区不干预返回键）" if ok else "❌ 未通过（仍在劫持）")
    b.close()
    sys.exit(0 if ok else 1)
