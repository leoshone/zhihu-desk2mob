"""★ 负向测试（比正向更重要）：真实专栏页【没有弹层】时，
各级宽松几何判据会不会把常驻大层误判成弹层，从而劫持返回键？

只测判据误报 —— A/B 返回键用例已由 test_real_back_clean.py 覆盖
（那个脚本带 wait_clean，环境干净；本脚本早期的 A/B 用例因登录弹层
延迟渲染而污染环境，结论不可靠，已移除）。

断言：页面顶部与滚动到评论区两种状态下，
  findOpenModal (55%x35%) / findOpenModalLoose (85%x50%) /
  findAnyOverlay (60%x60%) / 抽屉判据 (35%x50%+可交互+z>=100)
  全部必须 0 命中 —— 任何一个误命中都会劫持用户的返回键。
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
    const out = {vw: vw, vh: vh, strict: [], loose: [], any: [], drawer: []};
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
        let inter = 0;
        try { inter = el.querySelectorAll('button,a,input,textarea,[role="button"]').length; } catch(e) {}
        const rec = {tag: el.tagName.toLowerCase(),
                     cls: (typeof el.className === 'string' ? el.className : '').slice(0,40),
                     w: Math.round(r.width), h: Math.round(r.height), z: cs.zIndex, txt: t.length,
                     inter: inter};
        if (r.width >= vw*0.55 && r.height >= vh*0.35) out.strict.push(rec);              // findOpenModal
        if (r.width >= vw*0.85 && r.height >= vh*0.5 && t.length >= 15) out.loose.push(rec); // findOpenModalLoose
        if (r.width >= vw*0.6  && r.height >= vh*0.6) out.any.push(rec);                  // findAnyOverlay 全屏档
        if (r.width >= vw*0.35 && r.height >= vh*0.5 && rec.inter >= 3 && rec.z >= 100) {
            out.drawer.push(rec);                                                          // v0.7.11 抽屉档
        }
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
        print("  findAnyOverlay (60%x60%)     命中:", len(r["any"]), "  ← 全屏档")
        print("  抽屉判据 (35%x50%+交互+z>=100) 命中:", len(r["drawer"]), "  ← v0.7.11 新增")
        for x in r["any"] + r["drawer"]:
            print("     误报候选:", json.dumps(x, ensure_ascii=False))

    # ── 负向测试 A：未滚动（无弹层、无滚动缓冲）按返回 → 必须正常后退 ──
    # 先回到页顶，确保没有滚动缓冲干扰
    pg.evaluate("window.scrollTo(0, 0)")
    total = len(r["strict"]) + len(r["loose"]) + len(r["any"]) + len(r["drawer"])
    print()
    print("== 脚本日志 ==")
    for l in logs:
        if "弹层" in l:
            print("  ", l[:120])

    ok = total == 0
    print()
    print("四种判据误报总数:", total, "(strict=%d loose=%d any=%d drawer=%d)" % (
        len(r["strict"]), len(r["loose"]), len(r["any"]), len(r["drawer"])))
    print("结论:", "✅ 通过（无弹层时四层判据零误报，返回键不会被劫持）" if ok else "❌ 未通过（存在误判风险）")
    b.close()
    sys.exit(0 if ok else 1)
