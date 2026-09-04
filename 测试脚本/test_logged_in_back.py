"""★ 登录态 · 真实专栏页 · 返回键逐步测试（带截图 + 录屏）

依赖：先跑 `python 测试脚本/login_setup.py` 完成登录（cookie 存 .zhihu-profile/）

与未登录测试的区别（正是此前的盲区）：
  • 用你的真实账号 → 登录态专栏页的真实 DOM，不用再猜弹层形态
  • 每步截图 + 全程录屏 → 可以一步步看
  • 点开评论弹层后用 __zfDiag() 取证弹层真实尺寸/占屏比/z-index

输出目录：测试截图/登录态/<用例>__<步骤>.png  +  测试截图/登录态/video/
"""
from playwright.sync_api import sync_playwright
import os, sys, json, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROFILE = os.path.join(ROOT, ".zhihu-profile")
OUT = os.path.join(ROOT, "测试截图", "登录态")
VIDEO = os.path.join(OUT, "video")
V4 = os.path.join(ROOT, "zhihu-desk2mob.user.js")

TARGET = "https://zhuanlan.zhihu.com/p/2074785936261505339"

# Kiwi「桌面版网站」：layout viewport 980，屏幕 393，缩放 0.4
UA_DESKTOP = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

STATE = "() => ({url: location.href, st: history.state, len: history.length, y: Math.round(scrollY||0)})"


def shot(pg, name):
    try:
        pg.screenshot(path=os.path.join(OUT, name + ".png"))
        print("      📷 " + name + ".png")
    except Exception as e:
        print("      截图失败:", str(e)[:60])


def step(pg, title):
    print()
    print("   ── " + title)


with sync_playwright() as p:
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(VIDEO, exist_ok=True)

    ctx = p.chromium.launch_persistent_context(
        PROFILE,
        headless=False,
        args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
        viewport={"width": 980, "height": 2130},
        screen={"width": 393, "height": 852},
        device_scale_factor=2.625,
        has_touch=True,
        user_agent=UA_DESKTOP,
        locale="zh-CN",
        record_video_dir=VIDEO,
        record_video_size={"width": 393, "height": 852},
    )
    ctx.add_init_script(path=V4)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()

    logs = []
    pg.on("console", lambda m: logs.append(m.text))

    # ── 0. 确认登录态 ──
    print("=" * 64)
    print("  0. 确认登录态")
    pg.goto("https://www.zhihu.com/", wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(4000)
    logged = pg.evaluate("""() => {
        // /people/undefined 是未登录占位，排除
        const as = document.querySelectorAll('a[href*="/people/"]');
        for (const a of as) {
            const h = a.getAttribute('href') || '';
            if (h.indexOf('/people/undefined') < 0 && /\\/people\\/[a-zA-Z0-9_-]+/.test(h)) return h;
        }
        return null;
    }""")
    if not logged:
        print("  ❌ 未检测到登录态，请先跑 login_setup.py")
        ctx.close()
        sys.exit(1)
    print("  ✅ 已登录，个人主页:", logged)
    shot(pg, "00-已登录首页")

    # ── 1. 打开专栏页 ──
    print("=" * 64)
    print("  1. 打开专栏页")
    pg.goto(TARGET, wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(6000)
    badge = pg.evaluate("() => (document.getElementById('zhihu-mobile-badge')||{}).textContent || null")
    print("     角标:", badge, "(确认脚本已生效)")
    shot(pg, "01-专栏页")

    # ── 2. 清理环境（登录态通常没有登录弹层，但保险起见）──
    st = pg.evaluate("() => history.state")
    if st and (st.get("zfModal") or st.get("zfStay")):
        print("     ⚠ 栈顶已有缓冲", json.dumps(st), "→ 先等脚本自行清理")
        for _ in range(20):
            pg.wait_for_timeout(500)
            st = pg.evaluate("() => history.state")
            if not (st and (st.get("zfModal") or st.get("zfStay"))):
                break
    print("     栈顶状态:", json.dumps(pg.evaluate("() => history.state")))

    # ── 3. 取证：点开评论弹层，看真实形态 ──
    print("=" * 64)
    print("  2. 点开评论弹层（关键取证：登录态弹层到底长什么样）")
    clicked = pg.evaluate("""() => {
        const btns = document.querySelectorAll('button, [role="button"]');
        for (const b of btns) {
            const t = (b.textContent || '').trim();
            if (t.indexOf('评论') >= 0 && t.length <= 20) { b.click(); return t; }
        }
        return null;
    }""")
    print("     点了评论按钮:", clicked)
    pg.wait_for_timeout(3000)
    shot(pg, "02-评论弹层已开")

    diag = pg.evaluate("() => window.__zfDiag ? window.__zfDiag() : null")
    if diag:
        print()
        print("     ── __zfDiag 输出 ──")
        d = dict(diag)
        print("     脚本版本:", d.get("脚本版本"), "| 视口:", d.get("视口"), "| 滚动位置:", d.get("滚动位置"))
        print("     栈顶状态:", json.dumps(d.get("栈顶状态")))
        print("     拦截状态:", json.dumps(d.get("返回键拦截状态"), ensure_ascii=False))
        hits = d.get("判据命中") or {}
        for k in ("findOpenModal", "findOpenModalLoose", "findAnyOverlay"):
            v = hits.get(k)
            if v:
                print("     %-20s 命中: %s %s 占屏%s z=%s 可交互%s 有关闭按钮=%s" % (
                    k, v.get("类名", "")[:28], v.get("尺寸"), v.get("占屏"),
                    v.get("层级"), v.get("可交互元素"), v.get("有关闭按钮")))
            else:
                print("     %-20s ❌ 未命中" % k)
        big = d.get("大浮层清单") or []
        print("     大浮层清单(≥30%%视口) 共 %d 个:" % len(big))
        for x in big:
            print("        · %s %s %s 占屏%s z=%s 文字%s" % (
                x.get("标签"), x.get("类名", "")[:30], x.get("尺寸"),
                x.get("占屏"), x.get("层级"), x.get("文字数")))
    else:
        print("     ❌ __zfDiag 不可用")

    with open(os.path.join(OUT, "zfDiag-弹层打开.json"), "w", encoding="utf-8") as f:
        json.dump(diag, f, ensure_ascii=False, indent=1)
    print("     💾 完整 JSON 已存: 测试截图/登录态/zfDiag-弹层打开.json")

    # ── 4. 第一次返回 ──
    print("=" * 64)
    print("  3. 第 1 次返回（模拟系统返回键）")
    before = pg.evaluate(STATE)
    print("     返回前: y=%s 栈顶=%s" % (before["y"], json.dumps(before["st"])))
    try:
        pg.go_back(wait_until="commit", timeout=8000)
    except Exception as e:
        print("     go_back 异常:", str(e)[:60])
    pg.wait_for_timeout(2500)
    after1 = pg.evaluate(STATE)
    print("     返回后: url=%s" % after1["url"][:60])
    print("             y=%s 栈顶=%s" % (after1["y"], json.dumps(after1["st"])))
    shot(pg, "03-第1次返回后")

    # 弹层还在吗
    still = pg.evaluate("""() => {
        const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
        const all = document.body.querySelectorAll('*');
        for (let i = 0; i < all.length; i++) {
            const el = all[i];
            if (el.id === 'zhihu-mobile-badge' || el.id === 'zf-modal-close') continue;
            let cs; try { cs = getComputedStyle(el); } catch(e) { continue; }
            if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const r = el.getBoundingClientRect();
            if (r.width >= vw*0.55 && r.height >= vh*0.35) return true;
        }
        return false;
    }""")
    print("     弹层还开着:", still, "| URL 未变:", after1["url"] == before["url"])

    # ── 5. 第二次返回 ──
    print("=" * 64)
    print("  4. 第 2 次返回")
    try:
        pg.go_back(wait_until="commit", timeout=8000)
    except Exception as e:
        print("     go_back 异常:", str(e)[:60])
    pg.wait_for_timeout(2500)
    after2 = pg.evaluate(STATE)
    print("     返回后: url=%s" % after2["url"][:60])
    print("             y=%s 栈顶=%s" % (after2["y"], json.dumps(after2["st"])))
    shot(pg, "04-第2次返回后")

    print()
    print("=" * 64)
    print("  == 脚本日志 ==")
    for l in logs:
        if "弹层" in l or "知乎适配" in l:
            print("   ", l[:130])

    print()
    print("  == 判定 ==")
    print("     第1次返回: 弹层已关=%s, 留在页面=%s" % (not still, after1["url"] == before["url"]))
    print("     第2次返回: 正常退出=%s" % (after2["url"] != after1["url"]))
    ok = (not still) and (after1["url"] == before["url"]) and (after2["url"] != after1["url"])
    print("     结论:", "✅ 通过" if ok else "❌ 未通过（这正是要复现的 bug）")

    print()
    print("  📁 截图目录:", OUT)
    print("  🎬 录屏目录:", VIDEO)
    pg.wait_for_timeout(1500)
    ctx.close()
    sys.exit(0 if ok else 1)
