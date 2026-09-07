"""真机：重新加载页面（评论区未加载状态）后立即点评论 → 是否弹窗？

假设：知乎专栏页
  • 评论区未加载时点「N 条评论」→ 弹出评论弹层（css-zbtg51）
  • 评论区已加载后点          → 滚动定位到内联评论区（不弹窗）
v0.7.11 取证时（滚动到 y=9699、评论区可能未渲染）弹出了 78%x78% 弹层，
之后几次测试滚过头/评论区已加载，所以点不出弹层。
"""
from playwright.sync_api import sync_playwright
import subprocess, json, os, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ADB = os.path.join(ROOT, ".workbuddy", "tools", "platform-tools", "adb.exe")
TARGET = "https://zhuanlan.zhihu.com/p/2044268985798104354"


def adb(*a):
    return subprocess.run([ADB] + list(a), capture_output=True, text=True, timeout=30)


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
                     pct: Math.round(r.width/vw*100)+'%x'+Math.round(r.height/vh*100)+'%'};
            break;
        }
    }
    return {url: location.href.slice(0,66), st: history.state,
            y: Math.round(window.scrollY||0),
            cmtLoaded: !!document.querySelector('.Comments-container,[class*="Comments-container"]'),
            modal: modal};
}"""

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
    pg = b.contexts[0].pages[0]
    logs = []
    pg.on("console", lambda m: logs.append(m.text))

    print("重新加载页面…")
    pg.goto(TARGET, wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(3500)      # 只等 3.5s：评论区大概率还没渲染
    s0 = pg.evaluate(SNAP)
    print("  加载后: 评论区已渲染=%s | scrollY=%s | 弹层=%s" % (
        s0["cmtLoaded"], s0["y"], "在" if s0["modal"] else "无"))

    print()
    print("点「N 条评论」…")
    clicked = pg.evaluate("""() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
            const t = (b.textContent||'').trim();
            if (t.indexOf('条评论') >= 0) { b.click(); return t.slice(0,20); }
        }
        return null;
    }""")
    print("  点了:", clicked)
    pg.wait_for_timeout(3000)
    s1 = pg.evaluate(SNAP)
    print("  点后: 弹层=%s | 栈顶=%s | scrollY=%s" % (
        json.dumps(s1["modal"], ensure_ascii=False) if s1["modal"] else "无",
        json.dumps(s1["st"]), s1["y"]))

    if s1["modal"]:
        print()
        print("  【弹层已出现】按返回键测试：")
        prev = s1
        for n in (1, 2, 3):
            adb_back()
            pg.wait_for_timeout(2500)
            try:
                s = pg.evaluate(SNAP)
            except Exception as e:
                print("     第%d次: 页面失联 → 已退出" % n)
                break
            changed = s["url"] != prev["url"]
            print("     第%d次返回: URL变化=%-5s 弹层=%-3s 栈顶=%s" % (
                n, changed, "在" if s["modal"] else "无", json.dumps(s["st"])))
            if changed:
                print("     ⇒ 第 %d 次退出页面" % n)
                break
            prev = s
    else:
        print()
        print("  仍未弹窗。再试：等更久（10s）后点，以及点底部浮动评论按钮")
        pg.wait_for_timeout(8000)
        s2 = pg.evaluate(SNAP)
        print("    10s 后评论区已渲染=%s scrollY=%s" % (s2["cmtLoaded"], s2["y"]))
        c2 = pg.evaluate("""() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                const t = (b.textContent||'').trim();
                if (t.indexOf('条评论') >= 0) { b.click(); return t.slice(0,20); }
            }
            return null;
        }""")
        pg.wait_for_timeout(3000)
        s3 = pg.evaluate(SNAP)
        print("    点了 %s → 弹层=%s 栈顶=%s" % (
            c2, json.dumps(s3["modal"], ensure_ascii=False) if s3["modal"] else "无",
            json.dumps(s3["st"])))

    print()
    print("== 脚本日志 ==")
    for l in logs:
        if "弹层" in l:
            print("   ", l[:120])
    b.close()
