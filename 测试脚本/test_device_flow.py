"""真机完整测试（Kiwi CDP）：新开标签 → 打开专栏页 → 真人节奏操作 → adb 返回键取证

要点：
  • connect_over_cdp 只能接管 browser 级，Android 上需自行 new_page
  • 返回键用 adb shell input keyevent 4（真实系统返回）
  • 全程慢节奏 + 随机抖动，模拟真人，避免风控
"""
from playwright.sync_api import sync_playwright
import subprocess, json, os, sys, time, random

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ADB = os.path.join(ROOT, ".workbuddy", "tools", "platform-tools", "adb.exe")
OUT = os.path.join(ROOT, "测试截图", "真机")
os.makedirs(OUT, exist_ok=True)

TARGET = "https://zhuanlan.zhihu.com/p/2044268985798104354"


def adb(*args):
    return subprocess.run([ADB] + list(args), capture_output=True, text=True, timeout=30)


def human_wait(lo=800, hi=1800):
    """真人节奏：随机等待"""
    time.sleep(random.uniform(lo, hi) / 1000.0)


def shot(pg, name):
    """真机截图可能超时，失败不阻塞取证"""
    try:
        pg.screenshot(path=os.path.join(OUT, name + '.png'), timeout=15000)
        print('      📷 ' + name + '.png')
    except Exception as e:
        print('      (截图跳过: ' + str(e)[:40] + ')')


def adb_back():
    subprocess.run([ADB, "shell", "input", "keyevent", "4"],
                   capture_output=True, text=True, timeout=20)


adb("start-server")
adb("forward", "--remove-all")
adb("forward", "tcp:9222", "localabstract:chrome_devtools_remote")
time.sleep(1)

SNAP = """() => {
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
                     pct: Math.round(r.width/vw*100)+'%x'+Math.round(r.height/vh*100)+'%',
                     z: cs.zIndex};
            break;
        }
    }
    return {
        url: location.href,
        st: history.state,
        len: history.length,
        y: Math.round(window.scrollY || 0),
        docH: de.scrollHeight,
        vw: vw, vh: vh,
        badge: (document.getElementById('zhihu-mobile-badge')||{}).textContent || null,
        modal: modal
    };
}"""

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
    ctx = b.contexts[0]
    # ⚠ 必须用「已存在的标签」：Kiwi 的「桌面版网站」模式是按标签/按浏览器设置生效的，
    #   ctx.new_page() 开出来的新标签是移动模式（视口 393、zoom=1），
    #   测出来的根本不是用户真实环境。现有标签才是：891x1753 / zoom 2.267 / 桌面 UA。
    pg = ctx.pages[0]
    logs = []
    pg.on("console", lambda m: logs.append(m.text))

    print("=" * 70)
    print("  1. 打开专栏页（真人节奏）")
    print("     复用现有标签(桌面版模式):", pg.url[:60])
    if "zhuanlan.zhihu.com" not in (pg.url or ""):
        try:
            pg.goto(TARGET, wait_until="domcontentloaded", timeout=60000)
        except Exception as e:
            print("     goto 失败:", str(e)[:70])
    pg.wait_for_timeout(6000)
    human_wait(1500, 2500)
    s = pg.evaluate(SNAP)
    print("     角标:", s["badge"])
    print("     视口:", s["vw"], "x", s["vh"], "| 文档高:", s["docH"])
    print("     栈顶:", json.dumps(s["st"]), "| 历史长度:", s["len"])
    print("     弹层:", json.dumps(s["modal"], ensure_ascii=False))
    shot(pg, 'R0-专栏页')

    # 等环境干净（登录态通常无登录弹层，但保险）
    for _ in range(10):
        st = pg.evaluate("() => history.state")
        if not (st and (st.get("zfModal") or st.get("zfStay"))):
            break
        human_wait()
    print("     环境清理后栈顶:", json.dumps(pg.evaluate("() => history.state")))

    # 2. __zfDiag 取证：滚动阈值
    print()
    print("=" * 70)
    print("  2. __zfDiag：滚动阈值与判据")
    d = pg.evaluate("() => window.__zfDiag ? window.__zfDiag() : null")
    if d:
        print("     版本:", d.get("脚本版本"), "| 视口:", d.get("视口"))
        print("     拦截状态:", json.dumps(d.get("返回键拦截状态"), ensure_ascii=False))
        print("     ⚠ 滚动阈值 =", (d.get("返回键拦截状态") or {}).get("滚动阈值"))
        print("     文档高 =", s["docH"], " → 阈值是否可达:",
              "否" if (d.get("返回键拦截状态") or {}).get("滚动阈值", 0) > s["docH"] else "是")
        with open(os.path.join(OUT, "R-diag-初始.json"), "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
    else:
        print("     ⚠ __zfDiag 不存在")

    # 3. 真人节奏往下滚（每次滑一点，随机间隔）
    print()
    print("=" * 70)
    print("  3. 模拟真人下滑到评论区")
    for i in range(12):
        pg.mouse.move(200 + random.randint(-40, 40), 700 + random.randint(-60, 60))
        pg.mouse.wheel(0, random.randint(700, 1300))
        human_wait(400, 900)
        cur = pg.evaluate(SNAP)
        if i % 3 == 0:
            print("     滑%d: y=%s 文档高=%s 栈顶=%s" % (i, cur["y"], cur["docH"], json.dumps(cur["st"])))
        if cur["st"] and cur["st"].get("zfModal"):
            print("     ⇒ 滚动压缓冲已触发 (y=%s)" % cur["y"])
            break
    s_scroll = pg.evaluate(SNAP)
    print("     滚动后: y=%s 栈顶=%s" % (s_scroll["y"], json.dumps(s_scroll["st"])))
    shot(pg, 'R1-滚到评论区')

    # 4. 点开评论
    print()
    print("=" * 70)
    print("  4. 点开评论")
    clicked = pg.evaluate("""() => {
        const btns = document.querySelectorAll('button, [role="button"]');
        for (const b of btns) {
            const t = (b.textContent || '').trim();
            if (t.indexOf('评论') >= 0 && t.length <= 20) { b.click(); return t; }
        }
        return null;
    }""")
    print("     点了:", clicked)
    pg.wait_for_timeout(3000)
    human_wait()
    s_cmt = pg.evaluate(SNAP)
    print("     弹层:", json.dumps(s_cmt["modal"], ensure_ascii=False))
    print("     栈顶:", json.dumps(s_cmt["st"]))
    shot(pg, 'R2-点评论后')

    d2 = pg.evaluate("() => window.__zfDiag ? window.__zfDiag() : null")
    if d2:
        hits = d2.get("判据命中") or {}
        for k in ("findOpenModal", "findOpenModalLoose", "findAnyOverlay"):
            v = hits.get(k)
            print("     %-20s %s" % (k, ("命中 " + str(v.get("尺寸")) + " 占屏" + str(v.get("占屏")) +
                                        " z=" + str(v.get("层级")) + " 交互" + str(v.get("可交互元素")))
                                     if v else "❌ 未命中"))
        print("     大浮层清单:")
        for x in (d2.get("大浮层清单") or [])[:6]:
            print("        · %s %s 占屏%s z=%s 文字%s 交互%s" % (
                x.get("类名", "")[:30], x.get("尺寸"), x.get("占屏"),
                x.get("层级"), x.get("文字数"), x.get("可交互元素")))
        with open(os.path.join(OUT, "R-diag-点评论后.json"), "w", encoding="utf-8") as f:
            json.dump(d2, f, ensure_ascii=False, indent=1)

    # 5. 连续 4 次真机返回键
    print()
    print("=" * 70)
    print("  5. 连续按真机返回键（adb keyevent 4）")
    prev = pg.evaluate(SNAP)
    for n in (1, 2, 3, 4):
        adb_back()
        pg.wait_for_timeout(2500)
        try:
            s = pg.evaluate(SNAP)
        except Exception as e:
            print("     第%d次返回: 页面失联(%s) —— 已退出" % (n, str(e)[:40]))
            break
        changed = s["url"] != prev["url"]
        print("     第%d次返回: URL变化=%-5s 栈顶=%-20s y=%-6s 弹层=%s" % (
            n, changed, json.dumps(s["st"]), s["y"], "在" if s["modal"] else "无"))
        print("                %s" % s["url"][:64])
        pg.screenshot(path=os.path.join(OUT, "R3-%d-第%d次返回.png" % (n, n)))
        if changed:
            print("     ⇒ 第 %d 次返回退出页面" % n)
            break
        prev = s
        human_wait(600, 1200)

    print()
    print("== 真机脚本日志 ==")
    for l in logs:
        if "弹层" in l or "知乎适配" in l:
            print("   ", l[:130])
    print()
    print("📁", OUT)
    b.close()
