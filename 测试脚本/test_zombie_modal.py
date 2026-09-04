"""验证 v0.7.9「弹层关不掉」场景：补缓冲 + 防困死降级。

复刻页 testpage_zombie_modal.html 里的弹层：
  • 有 aria-label=关闭 按钮，但点了不关（模拟 React 不响应 click）
  • display:none 会被 MutationObserver 立刻改回（模拟 React 重渲染）
  → closeTopModal 三级降级全部失败

断言：
  1) 第 1~2 次返回：弹层关不掉 → 脚本补回缓冲 → URL 不变（弹层还开着）
  2) 第 3 次返回：脚本放弃拦截 → URL 正常后退（用户能退出，不被困死）
  3) 全程 URL 不出现「前两次无反应、第三次整页退回」之外的情况
"""
from lib import *
from playwright.sync_api import sync_playwright
import json, sys

V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
URL = "http://127.0.0.1:8753/testpage_zombie_modal.html"

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    ctx = b.new_context(**DESKTOP_MODE)
    ctx.add_init_script(path=V4)
    pg = ctx.new_page()
    errs, logs = [], []
    pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
    pg.on("console", lambda m: logs.append(m.text))
    pg.goto(URL, wait_until="load", timeout=30000)
    pg.wait_for_timeout(1000)

    snap = lambda: pg.evaluate("""() => {
        var m = document.getElementById('modal');
        return {
            url: location.href.split('#')[0],
            st: history.state,
            len: history.length,
            modalExists: !!m,
            display: m ? getComputedStyle(m).display : '(页面已导航，弹层不存在)',
            revives: window.__zombieRevives || 0
        };
    }""")

    # 开弹层
    pg.evaluate("document.getElementById('entry').click()")
    pg.wait_for_timeout(800)
    print("开弹层后:", json.dumps(snap()))

    # 每次返回后等 4.5 秒：超过僵尸守卫 3 秒有效期，
    # 让弹层被 React「复活」，观察 ensureBuffer 是否补回缓冲并累进到上限。
    results = []
    for n in (1, 2, 3, 4, 5, 6, 7):
        try:
            pg.go_back(wait_until="commit", timeout=8000)
        except Exception as e:
            print("  back%d 异常:" % n, str(e)[:60])
        pg.wait_for_timeout(4500)
        s = snap()
        results.append((n, s))
        print("第%d次返回后:" % n, json.dumps(s))
        if not s["modalExists"]:
            break

    print()
    print("== 脚本日志 ==")
    for l in logs:
        if "弹层" in l:
            print("  ", l[:130])

    # 断言 1：僵尸弹层复活后，脚本持续补缓冲 → 前几次返回 URL 不变
    kept = [s for _, s in results if s["modalExists"]]
    blocked = sum(1 for s in kept if s["url"].endswith("testpage_zombie_modal.html"))
    # 断言 2：补到 BUF_MAX 上限后放手 → 用户最终能退出页面（不被困死）
    escaped = any(not s["modalExists"] for s in kept) or results[-1][1]["url"] != URL
    print()
    print("僵尸层复活后仍拦住的返回次数:", blocked, "(BUF_MAX=4，期望 ≤5)")
    print("最终能退出页面(未被困死):", escaped)
    print("pageerror:", errs[:3])
    ok = not errs and 2 <= blocked <= 5 and escaped
    print("结论:", "✅ 通过" if ok else "❌ 未通过")
    b.close()
    sys.exit(0 if ok else 1)
