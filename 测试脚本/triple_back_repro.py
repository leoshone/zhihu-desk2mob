"""复现真机『点开评论弹层 → 连续 3 次返回：前两次无反应，第三次整页退回』。

登录态专栏页点「N 条评论」→ fixed 评论 Modal。
本脚本在未登录桌面 Chromium 上复现同一形态（点评论按钮也弹 Modal），
逐步 go_back 观察弹层关闭 / URL / history.state 的时序。
"""
from lib import *
from playwright.sync_api import sync_playwright
import json, sys

V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
TARGET = "https://zhuanlan.zhihu.com/p/2074785936261505339"

DESKTOP = dict(DESKTOP_MODE)
DESKTOP["user_agent"] = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

MODAL_STILL = """() => {
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const all = document.body.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (el.id === 'zhihu-mobile-badge' || el.id === 'zf-modal-close') continue;
        let cs; try { cs = getComputedStyle(el); } catch(e) { continue; }
        if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (parseFloat(cs.opacity) < 0.15) continue;
        const r = el.getBoundingClientRect();
        if (r.width >= vw*0.55 && r.height >= vh*0.35 && (el.innerText||'').trim().length > 40) return true;
    }
    return false;
}"""

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

    # 关登录弹层（模拟登录态干净环境）
    pg.evaluate("""() => {
        const xs = document.querySelectorAll('.Modal-closeButton, button[aria-label="关闭"]');
        for (const x of xs) { try { x.click(); } catch(e){} }
    }""")
    pg.wait_for_timeout(2500)

    # 点评论按钮开弹层（不先滚动，隔离变量）
    pg.evaluate("""() => {
        const btns = document.querySelectorAll('button.Button.ContentItem-action');
        for (const btn of btns) {
            if ((btn.textContent||'').indexOf('评论') >= 0) { btn.click(); return; }
        }
    }""")
    pg.wait_for_timeout(2500)
    st = pg.evaluate("() => ({st: history.state, len: history.length})")
    print("开弹层后(未滚动):", json.dumps(st))
    print("弹层开着:", pg.evaluate(MODAL_STILL))

    for n in (1, 2, 3):
        print(">> 第%d次 go_back" % n)
        try:
            pg.go_back(wait_until="commit", timeout=8000)
        except Exception as e:
            print("  异常:", str(e)[:50])
        pg.wait_for_timeout(2500)
        s = pg.evaluate("""() => ({url: location.href.slice(0,70), st: history.state, len: history.length})""")
        s["modalStill"] = pg.evaluate(MODAL_STILL)
        print("第%d次返回后:" % n, json.dumps(s, ensure_ascii=False))

    print()
    print("== 脚本日志（完整时序） ==")
    for l in logs:
        if "弹层" in l:
            print("  ", l[:130])
    b.close()
