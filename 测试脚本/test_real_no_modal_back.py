"""★ 负向测试（比正向更重要）：真实专栏页【没有弹层】时按返回，
v0.7.9 新增的 findAnyOverlay 宽松几何判据（fixed/absolute ≥60%×60%）
会不会把常驻大层误判成弹层，从而劫持返回键？

断言：
  1) 页面正常浏览（无弹层）时 findAnyOverlay / findOpenModalLoose 都不该命中
  2) 此时按返回 → URL 必须正常后退（脚本不许干预）
"""
from lib import *
from playwright.sync_api import sync_playwright
import json, sys

V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
TARGET = "https://zhuanlan.zhihu.com/p/2074785936261505339"
DESKTOP = dict(DESKTOP_MODE)
DESKTOP["user_agent"] = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

# 复刻脚本内部的三级判据，逐层看命中情况
PROBE = """() => {
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const out = {vw: vw, vh: vh, strict: [], loose: [], any: []};
    const all = document.body.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (el.id === 'zhihu-mobile-badge' || el.id === 'zf-modal-close') continue;
        if (el.hasAttribute('data-zhidden')) continue;
        let cs; try { cs = getComputedStyle(el); } catch(e) { continue; }
        if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (parseFloat(cs.opacity) < 0.15) continue;
        const r = el.getBoundingClientRect();
        const t = (el.innerText || '').trim();
        const rec = {tag: el.tagName.toLowerCase(),
                     cls: (typeof el.className === 'string' ? el.className : '').slice(0,40),
                     w: Math.round(r.width), h: Math.round(r.height), z: cs.zIndex, txt: t.length};
        if (r.width >= vw*0.55 && r.height >= vh*0.35) out.strict.push(rec);              // findOpenModal
        if (r.width >= vw*0.85 && r.height >= vh*0.5 && t.length >= 15) out.loose.push(rec); // findOpenModalLoose
        if (r.width >= vw*0.6  && r.height >= vh*0.6) out.any.push(rec);                  // findAnyOverlay(v0.7.9 新增)
    }
    return out;
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
    pg.evaluate("""() => {
        const xs = document.querySelectorAll('.Modal-closeButton, button[aria-label="关闭"]');
        for (const x of xs) { try { x.click(); } catch(e){} }
    }""")
    pg.wait_for_timeout(3000)

    for phase, label in ((0, "页面顶部"), (1, "滚动到评论区")):
        if phase == 1:
            for i in range(6):
                pg.evaluate("window.scrollBy(0, 1800)")
                pg.wait_for_timeout(250)
            pg.wait_for_timeout(800)
        r = pg.evaluate(PROBE)
        print("=== %s ===" % label)
        print("  视口:", r["vw"], "x", r["vh"])
        print("  findOpenModal (55%x35%)      命中:", len(r["strict"]))
        print("  findOpenModalLoose(85%x50%+文) 命中:", len(r["loose"]))
        print("  findAnyOverlay (60%x60%)     命中:", len(r["any"]), "  ← v0.7.9 新增，误报=劫持返回键")
        for x in r["any"]:
            print("     误报候选:", json.dumps(x, ensure_ascii=False))

    # ── 负向测试 A：未滚动（无弹层、无滚动缓冲）按返回 → 必须正常后退 ──
    # 先回到页顶，确保没有滚动缓冲干扰
    pg.evaluate("window.scrollTo(0, 0)")
    pg.wait_for_timeout(1500)
    before = pg.evaluate("() => ({url: location.href, st: history.state, y: Math.round(scrollY||0)})")
    print()
    print("A. 页顶无弹层无缓冲，状态:", json.dumps({k: before[k] for k in ("url", "st")})[:100])
    try:
        pg.go_back(wait_until="commit", timeout=8000)
    except Exception as e:
        print("  go_back 异常:", str(e)[:60])
    pg.wait_for_timeout(2500)
    after = pg.evaluate("() => location.href")
    back_ok = after != before["url"]
    print("  按返回后:", after[:55])
    print("  ⇒ A. 返回键未被劫持(正常后退):", back_ok)

    # ── 负向测试 B：滚到评论区（有滚动缓冲）按返回 → 留在页面（v0.7.8 预期行为）──
    # 再按一次 → 必须能正常退出，不能被缓冲困住
    print()
    print("B. 滚到评论区按两次返回（第一次应留在本页，第二次应退出）")
    pg.evaluate("window.scrollTo(0, 0)")
    pg.wait_for_timeout(1000)
    pg.goto(TARGET, wait_until="domcontentloaded", timeout=30000)
    pg.wait_for_timeout(5000)
    pg.evaluate("""() => {
        const xs = document.querySelectorAll('.Modal-closeButton, button[aria-label="关闭"]');
        for (const x of xs) { try { x.click(); } catch(e){} }
    }""")
    pg.wait_for_timeout(3000)
    for i in range(6):
        pg.evaluate("window.scrollBy(0, 1800)")
        pg.wait_for_timeout(250)
    pg.wait_for_timeout(800)
    u0 = pg.evaluate("() => location.href")
    try:
        pg.go_back(wait_until="commit", timeout=8000)
    except Exception as e:
        print("  异常:", str(e)[:50])
    pg.wait_for_timeout(2000)
    u1 = pg.evaluate("() => location.href")
    stay = u1 == u0
    try:
        pg.go_back(wait_until="commit", timeout=8000)
    except Exception as e:
        print("  异常:", str(e)[:50])
    pg.wait_for_timeout(2000)
    u2 = pg.evaluate("() => location.href")
    escaped = u2 != u1
    print("  第1次返回留在页面(内联评论预期):", stay)
    print("  第2次返回正常退出:", escaped)
    print("  ⇒ B. 未被缓冲困死:", escaped)
    print()
    print("== 脚本日志 ==")
    for l in logs:
        if "弹层" in l:
            print("  ", l[:120])

    ok = back_ok and escaped and len(r["any"]) == 0
    print()
    print("A 页顶按返回正常后退:", back_ok)
    print("B 评论区按两次能退出:", escaped)
    print("findAnyOverlay 误报数:", len(r["any"]))
    print("结论:", "✅ 通过" if ok else "❌ 未通过")
    b.close()
    sys.exit(0 if ok else 1)
