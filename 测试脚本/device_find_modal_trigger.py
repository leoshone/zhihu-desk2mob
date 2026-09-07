"""真机探索：哪种操作才会真正弹出「评论弹层」？

教训：ctx.pages[0] 可能是首页而不是专栏页，必须先确认再操作。
本脚本逐个尝试候选操作，记录每次是否出现 >=55%x35% 的浮层。
"""
from playwright.sync_api import sync_playwright
import subprocess, json, os, time, random

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ADB = os.path.join(ROOT, ".workbuddy", "tools", "platform-tools", "adb.exe")
TARGET = "https://zhuanlan.zhihu.com/p/2044268985798104354"


def adb(*args):
    return subprocess.run([ADB] + list(args), capture_output=True, text=True, timeout=30)


adb("start-server")
adb("forward", "--remove-all")
adb("forward", "tcp:9222", "localabstract:chrome_devtools_remote")
time.sleep(1)

ENV = """() => {
    const de = document.documentElement;
    const vw = de.clientWidth, vh = de.clientHeight;
    let modal = null;
    const all = document.body.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (el.id === 'zhihu-mobile-badge' || el.id === 'zf-modal-close') continue;
        let cs; try { cs = getComputedStyle(el); } catch(e) { continue; }
        if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (parseFloat(cs.opacity) < 0.15) continue;
        const r = el.getBoundingClientRect();
        if (r.width >= vw*0.55 && r.height >= vh*0.35) {
            modal = {cls:(typeof el.className==='string'?el.className:'').slice(0,36),
                     size: Math.round(r.width)+'x'+Math.round(r.height),
                     pct: Math.round(r.width/vw*100)+'%x'+Math.round(r.height/vh*100)+'%'};
            break;
        }
    }
    return {url: location.href.slice(0, 70), vw: vw, vh: vh,
            zoom: getComputedStyle(de).zoom,
            scrollY: Math.round(window.scrollY||0),
            st: history.state, modal: modal};
}"""

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
    pg = b.contexts[0].pages[0]

    # 确保在专栏页
    if "zhuanlan.zhihu.com" not in (pg.url or ""):
        print("当前在:", pg.url[:60], "→ 前往专栏页")
        pg.goto(TARGET, wait_until="domcontentloaded", timeout=60000)
        pg.wait_for_timeout(7000)
    e = pg.evaluate(ENV)
    print("== 起始环境 ==")
    print("   url:", e["url"])
    print("   视口:", e["vw"], "x", e["vh"], "| zoom:", e["zoom"], "| scrollY:", e["scrollY"])
    print()

    def attempt(name, fn):
        print("--- 尝试：%s ---" % name)
        try:
            fn()
        except Exception as ex:
            print("   执行异常:", str(ex)[:70])
        pg.wait_for_timeout(3000)
        s = pg.evaluate(ENV)
        print("   结果: 弹层=%s | scrollY=%s | 栈顶=%s" % (
            json.dumps(s["modal"], ensure_ascii=False) if s["modal"] else "无",
            s["scrollY"], json.dumps(s["st"])))
        print()
        return s["modal"]

    # 1. 页面顶部点「N 条评论」
    attempt("顶部点「N 条评论」", lambda: pg.evaluate("""() => {
        const btns = document.querySelectorAll('button.Button.ContentItem-action, button');
        for (const b of btns) {
            const t = (b.textContent||'').trim();
            if (t.indexOf('条评论') >= 0) { b.click(); return; }
        }
    }"""))

    # 关闭可能的残留
    pg.evaluate("""() => {
        const xs = document.querySelectorAll('[aria-label="关闭"], .Modal-closeButton');
        for (const x of xs) { try { x.click(); } catch(e){} }
    }""")
    pg.wait_for_timeout(1500)

    # 2. 滚到评论区后再点
    print("滚到评论区…")
    for i in range(12):
        pg.mouse.move(250, 800)
        pg.mouse.wheel(0, random.randint(900, 1400))
        time.sleep(random.uniform(0.35, 0.7))
    pg.wait_for_timeout(2500)
    e2 = pg.evaluate(ENV)
    print("   滚动后 scrollY=%s 弹层=%s" % (e2["scrollY"], "在" if e2["modal"] else "无"))
    print()

    attempt("评论区位置点「N 条评论」", lambda: pg.evaluate("""() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
            const t = (b.textContent||'').trim();
            if (t.indexOf('条评论') >= 0) {
                const r = b.getBoundingClientRect();
                if (r.top > -200 && r.top < 2000) { b.click(); return; }
            }
        }
    }"""))

    # 3. 列出当前所有「评论」相关可点元素，供后续分析
    cands = pg.evaluate("""() => {
        const out = [];
        const els = document.querySelectorAll('button, a, [role="button"], div[class*="Comment"]');
        for (const el of els) {
            const t = (el.textContent||'').trim();
            if (t.length > 30) continue;
            if (!/评论|回复/.test(t)) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 20 || r.height < 12) continue;
            out.push({tag: el.tagName, text: t.slice(0,18),
                      cls: (typeof el.className==='string'?el.className:'').slice(0,34),
                      rect: Math.round(r.width)+'x'+Math.round(r.height)+'@'+Math.round(r.top)});
        }
        return out.slice(0, 12);
    }""")
    print("== 当前「评论/回复」可点元素 ==")
    for c in cands:
        print("   ", json.dumps(c, ensure_ascii=False))

    b.close()
