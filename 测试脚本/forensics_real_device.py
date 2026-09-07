"""★ 真机取证（Kiwi via CDP + adb keyevent 4）

环境：adb forward tcp:9222 localabstract:chrome_devtools_remote
      Kiwi Chrome/137.0.7337.0, Android 10

与桌面模拟的本质区别：
  • 真实 Kiwi 内核（不是桌面 Chromium 149）
  • 真实边缘/系统返回键：adb shell input keyevent 4（不是 pg.go_back()）
  • 真实登录态、真实扩展环境（uBlock / SwitchyOmega 在跑）

每步：取证 → adb 返回键 → 取证，共 4 次返回，全程截图。
"""
from playwright.sync_api import sync_playwright
import subprocess, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ADB = os.path.join(ROOT, ".workbuddy", "tools", "platform-tools", "adb.exe")
OUT = os.path.join(ROOT, "测试截图", "真机")
os.makedirs(OUT, exist_ok=True)

SNAP = """() => {
    const de = document.documentElement;
    let modal = null;
    const vw = de.clientWidth, vh = de.clientHeight;
    const all = document.body.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (el.id === 'zhihu-mobile-badge' || el.id === 'zf-modal-close') continue;
        let cs; try { cs = getComputedStyle(el); } catch(e) { continue; }
        if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width >= vw*0.55 && r.height >= vh*0.35) {
            modal = {cls: (typeof el.className==='string'?el.className:'').slice(0,40),
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
        badge: (document.getElementById('zhihu-mobile-badge')||{}).textContent || null,
        modal: modal
    };
}"""


def adb(*args):
    return subprocess.run([ADB] + list(args), capture_output=True, text=True, timeout=30)


def adb_back():
    """真机系统返回键"""
    r = subprocess.run([ADB, "shell", "input", "keyevent", "4"],
                       capture_output=True, text=True, timeout=20)
    return r.returncode


def ensure_forward():
    """adb forward 会在 shell 调用结束后丢失，每次开跑前重建"""
    adb("start-server")
    adb("forward", "--remove-all")
    r = adb("forward", "tcp:9222", "localabstract:chrome_devtools_remote")
    lst = adb("forward", "--list")
    print("   adb forward:", (lst.stdout or "").strip().replace("\n", " | "))
    time.sleep(1)


def shot(pg, name):
    try:
        pg.screenshot(path=os.path.join(OUT, name + ".png"))
        print("      📷 " + name + ".png")
    except Exception as e:
        print("      截图失败:", str(e)[:70])


ensure_forward()

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
    print("✅ 已连接真机 Kiwi")
    print("   浏览器:", b.version)

    ctx = b.contexts[0]
    target = None
    for pg in ctx.pages:
        if "zhuanlan.zhihu.com" in (pg.url or ""):
            target = pg
            break
    if not target:
        print("❌ 没找到专栏页标签，当前标签：")
        for pg in ctx.pages:
            print("   -", (pg.url or "")[:80])
        b.close()
        sys.exit(1)

    logs = []
    target.on("console", lambda m: logs.append(m.text))
    print("   目标页:", target.url)
    print()

    # 0. 当前状态
    s = target.evaluate(SNAP)
    print("=" * 66)
    print("  T0 当前状态")
    print("     角标:", s["badge"], " ← 确认脚本版本")
    print("     url :", s["url"][:70])
    print("     栈顶:", json.dumps(s["st"]), "| 历史长度:", s["len"], "| y:", s["y"])
    print("     弹层:", json.dumps(s["modal"], ensure_ascii=False))
    shot(target, "T0-初始")

    # 1. 取证 __zfDiag（如果脚本版本支持）
    print()
    print("=" * 66)
    print("  T1 __zfDiag 取证")
    diag = target.evaluate("() => window.__zfDiag ? window.__zfDiag() : null")
    if diag:
        print("     脚本版本:", diag.get("脚本版本"), "| 视口:", diag.get("视口"))
        print("     栈顶:", json.dumps(diag.get("栈顶状态")))
        print("     拦截状态:", json.dumps(diag.get("返回键拦截状态"), ensure_ascii=False))
        hits = diag.get("判据命中") or {}
        for k in ("findOpenModal", "findOpenModalLoose", "findAnyOverlay"):
            v = hits.get(k)
            print("     %-20s %s" % (k, ("命中 " + str(v.get("尺寸")) + " 占屏" + str(v.get("占屏")) +
                                        " z=" + str(v.get("层级"))) if v else "未命中"))
        with open(os.path.join(OUT, "zfDiag-T1.json"), "w", encoding="utf-8") as f:
            json.dump(diag, f, ensure_ascii=False, indent=1)
        print("     💾 测试截图/真机/zfDiag-T1.json")
    else:
        print("     ⚠ __zfDiag 不存在 —— 手机上装的脚本版本过旧，请先更新到 v0.7.11")

    # 2. 点开评论弹层
    print()
    print("=" * 66)
    print("  T2 点开评论弹层")
    clicked = target.evaluate("""() => {
        const btns = document.querySelectorAll('button, [role="button"]');
        for (const b of btns) {
            const t = (b.textContent || '').trim();
            if (t.indexOf('评论') >= 0 && t.length <= 20) { b.click(); return t; }
        }
        return null;
    }""")
    print("     点了:", clicked)
    target.wait_for_timeout(3000)
    s = target.evaluate(SNAP)
    print("     弹层:", json.dumps(s["modal"], ensure_ascii=False))
    print("     栈顶:", json.dumps(s["st"]))
    shot(target, "T2-评论弹层已开")

    diag2 = target.evaluate("() => window.__zfDiag ? window.__zfDiag() : null")
    if diag2:
        with open(os.path.join(OUT, "zfDiag-T2弹层打开.json"), "w", encoding="utf-8") as f:
            json.dump(diag2, f, ensure_ascii=False, indent=1)
        hits = (diag2.get("判据命中") or {})
        for k in ("findOpenModal", "findOpenModalLoose", "findAnyOverlay"):
            v = hits.get(k)
            print("     %-20s %s" % (k, ("命中 " + str(v.get("尺寸")) + " 占屏" + str(v.get("占屏"))) if v else "未命中"))

    # 3. 连续 4 次真机返回键
    print()
    print("=" * 66)
    print("  T3 连续按真机返回键（adb shell input keyevent 4）")
    prev = target.evaluate(SNAP)
    for n in (1, 2, 3, 4):
        rc = adb_back()
        target.wait_for_timeout(2200)
        try:
            s = target.evaluate(SNAP)
        except Exception as e:
            print("  第%d次返回: 页面已失联 (%s)" % (n, str(e)[:50]))
            break
        changed = s["url"] != prev["url"]
        print("  第%d次返回: URL变化=%-5s 栈顶=%-22s y=%-6s 弹层=%s" % (
            n, changed, json.dumps(s["st"]), s["y"],
            "在" if s["modal"] else "无"))
        print("            url=%s" % s["url"][:66])
        shot(target, "T3-%d-第%d次返回后" % (n, n))
        if changed:
            print("     ⇒ 第 %d 次返回时退出页面" % n)
            break
        prev = s

    print()
    print("=" * 66)
    print("  == 真机脚本日志 ==")
    for l in logs:
        if "弹层" in l or "知乎适配" in l:
            print("   ", l[:130])
    print()
    print("  📁 截图:", OUT)
    b.close()
