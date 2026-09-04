"""真实专栏页 · 用 __zfDiag 取证弹层形态与返回键拦截状态

目的：把「未登录桌面环境」能取到的弹层数据完整打出来，
与真机（登录态）用户跑 __zfDiag() 的输出对照，找出形态差异。
"""
from lib import *
from playwright.sync_api import sync_playwright
import json

V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
TARGET = "https://zhuanlan.zhihu.com/p/2074785936261505339"
DESKTOP = dict(DESKTOP_MODE)
DESKTOP["user_agent"] = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
    ctx = b.new_context(**DESKTOP)
    ctx.set_extra_http_headers({
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
    })
    ctx.add_init_script(path=V4)
    pg = ctx.new_page()
    logs = []
    pg.on("console", lambda m: logs.append(m.text))
    pg.goto("https://www.zhihu.com/explore", wait_until="domcontentloaded", timeout=30000)
    pg.wait_for_timeout(2000)
    pg.evaluate("(u) => { location.href = u; }", TARGET)
    pg.wait_for_load_state("domcontentloaded", timeout=30000)
    pg.wait_for_timeout(5000)

    # 等登录弹层出现再关掉（延迟渲染，实测 8 秒）
    for _ in range(50):
        if pg.evaluate("() => !!document.querySelector('.Modal-wrapper, [class*=Modal-wrapper]')"):
            break
        pg.wait_for_timeout(500)
    pg.evaluate("""() => {
        const xs = document.querySelectorAll('.Modal-closeButton, button[aria-label="关闭"]');
        for (const x of xs) { try { x.click(); } catch(e){} }
    }""")
    for _ in range(30):
        pg.wait_for_timeout(500)
        st = pg.evaluate("() => history.state")
        if not (st and (st.get("zfModal") or st.get("zfStay"))):
            break
    print("环境已清理")

    print()
    print("########## 场景一：无弹层（页面顶部）##########")
    d0 = pg.evaluate("() => window.__zfDiag()")
    print(json.dumps(d0, ensure_ascii=False, indent=1))

    print()
    print("########## 场景二：点开评论弹层 ##########")
    pg.evaluate("""() => {
        const btns = document.querySelectorAll('button.Button.ContentItem-action');
        for (const btn of btns) {
            if ((btn.textContent||'').indexOf('评论') >= 0) { btn.click(); return; }
        }
    }""")
    pg.wait_for_timeout(2500)
    d1 = pg.evaluate("() => window.__zfDiag()")
    print(json.dumps(d1, ensure_ascii=False, indent=1))

    print()
    print("########## 场景三：滚到评论区（内联）##########")
    pg.goto(TARGET, wait_until="domcontentloaded", timeout=30000)
    pg.wait_for_timeout(5000)
    for _ in range(50):
        if pg.evaluate("() => !!document.querySelector('.Modal-wrapper, [class*=Modal-wrapper]')"):
            break
        pg.wait_for_timeout(500)
    pg.evaluate("""() => {
        const xs = document.querySelectorAll('.Modal-closeButton, button[aria-label="关闭"]');
        for (const x of xs) { try { x.click(); } catch(e){} }
    }""")
    for _ in range(30):
        pg.wait_for_timeout(500)
        st = pg.evaluate("() => history.state")
        if not (st and (st.get("zfModal") or st.get("zfStay"))):
            break
    for i in range(8):
        pg.evaluate("window.scrollBy(0, 1800)")
        pg.wait_for_timeout(280)
        if pg.evaluate("() => {const s=history.state; return !!(s && s.zfModal);}"):
            break
    pg.wait_for_timeout(600)
    d2 = pg.evaluate("() => window.__zfDiag()")
    print(json.dumps(d2, ensure_ascii=False, indent=1))

    print()
    print("== 脚本日志 ==")
    for l in logs:
        if "弹层" in l:
            print("  ", l[:120])
    b.close()
