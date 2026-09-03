"""复刻「首页→文章(SPA)→评论(overlay)→系统返回」真实路径，验证返回键是否关弹层而非退出页面。

必须在 http:// 下跑（file:// 的 pushState 会因 opaque origin 抛错，无法复现真实站点的历史行为）。
断言：
  1. 进入文章后历史 +1（SPA pushState）
  2. 打开评论后脚本应压入缓冲历史（history.length 再 +1，或 history.state.zfModal 存在）
  3. 第 1 次系统返回 → 弹层消失 且 仍在文章页（URL 仍含 #article，home 不显示）
  4. 第 2 次系统返回 → 回到首页（home 显示）
"""
from lib import *
from playwright.sync_api import sync_playwright
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
URL = "http://127.0.0.1:8753/testpage_spa_comment.html"

def hstate(pg):
    return pg.evaluate("""() => {
        var cm = document.getElementById('cm');
        var home = document.getElementById('home');
        var art = document.getElementById('article');
        return {
            url: location.href,
            len: history.length,
            state: history.state,
            cmShown: cm ? cm.classList.contains('show') : null,
            homeActive: home ? home.classList.contains('active') : null,
            articleActive: art ? art.classList.contains('active') : null
        };
    }""")

def back(pg, n):
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
    pg.wait_for_timeout(1500)

    print("初始:", hstate(pg))

    pg.click("#btnEnter")          # 首页 → 文章（SPA pushState）
    pg.wait_for_timeout(800)
    print("进入文章后:", hstate(pg))

    pg.click("#btnComment")        # 打开评论 overlay（不压历史）
    # 轮询 history.length，看缓冲历史有没有被压入
    for t in (50, 300, 600, 1000, 1500):
        pg.wait_for_timeout(250 if t != 50 else 50)
        s = pg.evaluate("({len: history.length, zf: !!(history.state && history.state.zfModal), cm: document.getElementById('cm').classList.contains('show')})")
        print(f"  +{t}ms history.len={s['len']} zfModal={s['zf']} cmShown={s['cm']}")
    s_open = hstate(pg)
    print("打开评论后:", s_open)
    buf_pushed = bool(s_open["state"] and s_open["state"].get("zfModal") == 1)
    print("  ⇒ 脚本是否压入缓冲历史(zfModal):", buf_pushed)
    print("  --- 全部脚本 console 日志 ---")
    for l in logs:
        if 'ZFDBG' in l:
            print("   ", l)

    back(pg, 1)                    # 第 1 次系统返回
    s_back1 = hstate(pg)
    print("第1次返回后:", s_back1)
    modal_closed = not s_back1["cmShown"]
    still_article = s_back1["articleActive"] and not s_back1["homeActive"]
    print("  ⇒ 弹层关掉:", modal_closed, "| 仍在本页(文章):", still_article)

    back(pg, 2)                    # 第 2 次系统返回
    s_back2 = hstate(pg)
    print("第2次返回后:", s_back2)
    back_home = s_back2["homeActive"] and not s_back2["articleActive"]

    print("\npageerror:", errs[:3])
    ok = buf_pushed and modal_closed and still_article and back_home and not errs
    print("结论:", "✅ 通过" if ok else "❌ 未通过")
    b.close()
    sys.exit(0 if ok else 1)
