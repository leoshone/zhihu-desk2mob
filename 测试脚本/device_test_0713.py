"""真机 v0.7.13 验证：点开评论弹窗 → 返回键应关掉弹窗、留在文章页

用户反馈：v0.7.13 下「直接把整个页面退出了，而不是关闭评论弹层」
→ 说明弹窗打开时缓冲没压上（或被撤销了）。

本脚本逐步取证：
  0. 确认脚本版本
  1. 打开专栏页
  2. 点开评论弹窗（记录弹窗形态 + 缓冲状态）
  3. 第 1 次返回（adb keyevent 4）
  4. 第 2 次返回
  全程打印脚本日志，看 ensureBuffer / cancelProbe / 撤销 各自有没有触发
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


def adb_back():
    subprocess.run([ADB, "shell", "input", "keyevent", "4"],
                   capture_output=True, text=True, timeout=20)


def human_wait(lo=700, hi=1500):
    time.sleep(random.uniform(lo, hi) / 1000.0)


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
                     pct: Math.round(r.width/vw*100)+'%x'+Math.round(r.height/vh*100)+'%'};
            break;
        }
    }
    return {url: location.href, st: history.state, len: history.length,
            y: Math.round(window.scrollY||0),
            badge: (document.getElementById('zhihu-mobile-badge')||{}).textContent||null,
            modal: modal};
}"""

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
    ctx = b.contexts[0]
    pg = ctx.pages[0]
    logs = []
    pg.on("console", lambda m: logs.append(m.text))

    print("=" * 68)
    print("  0. 确认版本")
    print("     当前页:", pg.url[:64])
    s = pg.evaluate(SNAP)
    print("     角标:", s["badge"])
    if "zhuanlan.zhihu.com" not in (pg.url or ""):
        print("     不在专栏页，前往…")
        try:
            pg.goto(TARGET, wait_until="domcontentloaded", timeout=60000)
            pg.wait_for_timeout(6000)
        except Exception as e:
            print("     goto 失败:", str(e)[:70])
    s = pg.evaluate(SNAP)
    print("     url:", s["url"][:64])
    print("     栈顶:", json.dumps(s["st"]), "| 弹层:", json.dumps(s["modal"], ensure_ascii=False))

    # 回到干净状态
    for _ in range(12):
        st = pg.evaluate("() => history.state")
        if not (st and (st.get("zfModal") or st.get("zfStay"))):
            break
        human_wait()
    print("     清理后栈顶:", json.dumps(pg.evaluate("() => history.state")))

    # 1. 点开评论弹窗
    print()
    print("=" * 68)
    print("  1. 点开评论弹窗")
    clicked = pg.evaluate("""() => {
        const btns = document.querySelectorAll('button, [role="button"]');
        for (const b of btns) {
            const t = (b.textContent || '').trim();
            if (t.indexOf('评论') >= 0 && t.length <= 20) { b.click(); return t; }
        }
        return null;
    }""")
    print("     点了:", clicked)

    # 关键：分时段采样，看缓冲何时压上、何时被撤销
    for ms in (300, 600, 900, 1500, 2500, 3500):
        pg.wait_for_timeout(ms if ms == 300 else 300)
        cur = pg.evaluate(SNAP)
        print("     +%4dms  栈顶=%-22s 弹层=%s" % (
            ms, json.dumps(cur["st"]), "在" if cur["modal"] else "无"))

    s1 = pg.evaluate(SNAP)
    print()
    print("     点后稳态: 栈顶=" + json.dumps(s1["st"]) + " 弹层=" + json.dumps(s1["modal"], ensure_ascii=False))
    diag = pg.evaluate("() => window.__zfDiag ? window.__zfDiag() : null")
    if diag:
        print("     __zfDiag 版本:", diag.get("脚本版本"))
        print("     拦截状态:", json.dumps(diag.get("返回键拦截状态"), ensure_ascii=False))
        hits = diag.get("判据命中") or {}
        for k in ("findOpenModal", "findOpenModalLoose", "findAnyOverlay"):
            v = hits.get(k)
            print("     %-20s %s" % (k, ("命中 " + str(v.get("尺寸")) + " 占屏" + str(v.get("占屏"))) if v else "❌ 未命中"))
        with open(os.path.join(OUT, "R13-diag-弹窗打开.json"), "w", encoding="utf-8") as f:
            json.dump(diag, f, ensure_ascii=False, indent=1)

    # 2. 返回键
    print()
    print("=" * 68)
    print("  2. 按返回键（adb keyevent 4）")
    prev = pg.evaluate(SNAP)
    for n in (1, 2, 3):
        adb_back()
        pg.wait_for_timeout(2500)
        try:
            s = pg.evaluate(SNAP)
        except Exception as e:
            print("     第%d次: 页面失联 → 已退出" % n)
            break
        changed = s["url"] != prev["url"]
        print("     第%d次返回: URL变化=%-5s 栈顶=%-20s 弹层=%s" % (
            n, changed, json.dumps(s["st"]), "在" if s["modal"] else "无"))
        print("                %s" % s["url"][:62])
        if changed:
            print("     ⇒ 第 %d 次返回就退出了页面" % n)
            break
        prev = s
        human_wait(600, 1200)

    print()
    print("=" * 68)
    print("  == 真机脚本日志（完整） == ")
    for l in logs:
        if "弹层" in l or "知乎适配" in l:
            print("   ", l[:125])
    b.close()
