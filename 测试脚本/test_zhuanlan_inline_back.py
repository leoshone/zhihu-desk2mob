"""复刻「专栏页内联评论区」真实路径，验证 v0.7.6 的点击拦截 + 内联 popstate 兜底：

  • 评论区是内联 div（display 切换，非 fixed/absolute 浮层）—— 复刻专栏页真实形态
  • 评论入口按钮 = svg 图标 + 「写评论」文字（复刻专栏页底栏，测 isCommentTrigger 的 svg 爬升）
  • 点击评论入口 → 我的脚本应主动压缓冲历史
  • 第 1 次系统返回 → 仍停本页（URL 不变、文章视图在），不退回首页
  • 第 2 次系统返回 → 回首页

必须在 http:// 下跑（file:// 的 pushState 会因 opaque origin 抛错）。
"""
from lib import *
from playwright.sync_api import sync_playwright
import os

HERE = os.path.dirname(os.path.abspath(__file__))
V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
URL = "http://127.0.0.1:8753/testpage_zhuanlan_inline.html"

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
    errs = []
    logs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
    pg.on("console", lambda m: logs.append(m.text))
    pg.goto(URL, wait_until="load", timeout=30000)
    pg.wait_for_timeout(1200)

    print("初始:", hstate(pg))

    # 进文章（不直接点 enter 链接，用 pushState 模拟 SPA）
    pg.evaluate("document.getElementById('enter').click()")
    pg.wait_for_timeout(600)
    print("进入文章后:", hstate(pg))

    # 点评论入口（svg 图标 + 「写评论」文字）
    pg.evaluate("document.getElementById('commentEntry').click()")
    for t in (50, 300, 600, 1000, 1500):
        pg.wait_for_timeout(250 if t != 50 else 50)
        s = pg.evaluate("({len: history.length, zf: !!(history.state && history.state.zfModal), shown: document.getElementById('comments').classList.contains('show')})")
        print(f"  +{t}ms len={s['len']} zfModal={s['zf']} 评论区展开={s['shown']}")
    s_open = hstate(pg)
    print("打开评论后:", s_open)
    buf_pushed = bool(s_open["state"] and s_open["state"].get("zfModal") == 1)
    print("  ⇒ 脚本是否压入缓冲历史(zfModal):", buf_pushed)
    print("  --- 脚本 console 日志(含点击拦截) ---")
    for l in logs:
        if '弹层' in l or 'ZFDBG' in l:
            print("   ", l[:140])

    back(pg)  # 第 1 次系统返回
    s1 = hstate(pg)
    print("第1次返回后:", s1)
    still_article = s1["articleActive"] and s_open["url"] == s1["url"]
    print("  ⇒ 仍在本页(文章):", still_article, "| 退回首页?:", (not s1["articleActive"]))

    # ── 场景二：不点任何按钮，直接往下滚到评论区（专栏页真实用法）──
    print("\n=== 场景二：纯滚动（无点击）===")
    pg.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
    pg.wait_for_timeout(600)
    s_scroll = hstate(pg)
    print("深滚后:", {k: s_scroll[k] for k in ('len', 'state')})
    scroll_pushed = bool(s_scroll["state"] and s_scroll["state"].get("zfModal") == 1) or \
                    bool(s_scroll["state"] and s_scroll["state"].get("zfStay") == 1)
    print("  ⇒ 滚动是否触发压缓冲:", scroll_pushed)

    back(pg)  # 返回（消费滚动缓冲）
    s2r = hstate(pg)
    print("滚动后按返回:", {k: s2r[k] for k in ('url', 'state')})
    y = pg.evaluate("window.scrollY")
    still2 = s2r["url"] == s_open["url"]
    print("  ⇒ 仍在本页:", still2, "| scrollY =", y, "(0=滚回顶部)")

    print("\npageerror:", errs[:3])
    ok = buf_pushed and still_article and scroll_pushed and still2 and not errs
    print("结论:", "✅ 通过" if ok else "❌ 未通过")
    b.close()
    import sys; sys.exit(0 if ok else 1)
