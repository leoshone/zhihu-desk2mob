"""真机：精确测试两种「评论弹层」触发方式

A. 评论按钮在视口内时点「N 条评论」（v0.7.11 取证时 y≈9699 能弹出 css-zbtg51 78%x78%）
B. 点「展开其他 N 条回复」（交接文档原始需求里提到的浮层）

每种：触发 → 记录弹层 → 按返回键 → 看是否关弹层留在本页
"""
from playwright.sync_api import sync_playwright
import subprocess, json, os, time, random

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
    return {url: location.href.slice(0,68), st: history.state,
            y: Math.round(window.scrollY||0), modal: modal};
}"""

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
    pg = b.contexts[0].pages[0]
    logs = []
    pg.on("console", lambda m: logs.append(m.text))

    if "zhuanlan.zhihu.com" not in (pg.url or ""):
        pg.goto(TARGET, wait_until="domcontentloaded", timeout=60000)
        pg.wait_for_timeout(7000)
    print("页面:", pg.evaluate(SNAP)["url"])
    print()

    # ═══ A. 滚动到「评论按钮在视口内」再点 ═══
    print("=" * 66)
    print("A. 滚到评论按钮可见处，点「N 条评论」")
    # 逐步滚，直到评论按钮进入视口中部
    for i in range(20):
        pos = pg.evaluate("""() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                const t = (b.textContent||'').trim();
                if (t.indexOf('条评论') >= 0) {
                    const r = b.getBoundingClientRect();
                    return {top: Math.round(r.top), h: Math.round(r.height)};
                }
            }
            return null;
        }""")
        if pos and 200 < pos["top"] < 1200:
            print("   评论按钮已进视口 (top=%s)，停止滚动 (scrollY=%s)" % (
                pos["top"], pg.evaluate("() => Math.round(window.scrollY||0)")))
            break
        pg.mouse.move(250, 800)
        pg.mouse.wheel(0, 800)
        time.sleep(0.5)

    pg.wait_for_timeout(1500)
    pg.evaluate("""() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
            const t = (b.textContent||'').trim();
            if (t.indexOf('条评论') >= 0) { b.click(); return; }
        }
    }""")
    pg.wait_for_timeout(3000)
    a1 = pg.evaluate(SNAP)
    print("   点后: 弹层=%s | 栈顶=%s" % (
        json.dumps(a1["modal"], ensure_ascii=False) if a1["modal"] else "无", json.dumps(a1["st"])))

    if a1["modal"]:
        print("   【A 触发了弹层】按返回键…")
        prev = a1
        for n in (1, 2):
            adb_back()
            pg.wait_for_timeout(2500)
            s = pg.evaluate(SNAP)
            print("     第%d次返回: URL变化=%s 弹层=%s 栈顶=%s" % (
                n, s["url"] != prev["url"], "在" if s["modal"] else "无", json.dumps(s["st"])))
            if s["url"] != prev["url"]:
                print("     ⇒ 第%d次退出页面" % n)
                break
            prev = s
    else:
        print("   【A 没触发弹层】→ 该入口是内联展开，按新需求不干预是对的")

    # 关闭残留
    pg.evaluate("""() => {
        const xs = document.querySelectorAll('[aria-label="关闭"], .Modal-closeButton');
        for (const x of xs) { try { x.click(); } catch(e){} }
    }""")
    pg.wait_for_timeout(2000)

    # ═══ B. 点「展开其他 N 条回复」 ═══
    print()
    print("=" * 66)
    print("B. 点「展开其他 N 条回复」")
    b0 = pg.evaluate("""() => {
        const btns = document.querySelectorAll('button');
        const out = [];
        for (const b of btns) {
            const t = (b.textContent||'').trim();
            if (/展开其他|查看全部/.test(t)) {
                const r = b.getBoundingClientRect();
                out.push({text: t.slice(0,20), top: Math.round(r.top), visible: r.top > 0 && r.top < 1700});
            }
        }
        return out.slice(0, 5);
    }""")
    print("   候选:", json.dumps(b0, ensure_ascii=False))
    clicked = pg.evaluate("""() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
            const t = (b.textContent||'').trim();
            if (/展开其他|查看全部/.test(t)) {
                const r = b.getBoundingClientRect();
                if (r.top > -100 && r.top < 1700) { b.click(); return t.slice(0,22); }
            }
        }
        return null;
    }""")
    print("   点了:", clicked)
    pg.wait_for_timeout(3000)
    b1 = pg.evaluate(SNAP)
    print("   点后: 弹层=%s | 栈顶=%s" % (
        json.dumps(b1["modal"], ensure_ascii=False) if b1["modal"] else "无", json.dumps(b1["st"])))

    if b1["modal"]:
        print("   【B 触发了弹层】按返回键…")
        prev = b1
        for n in (1, 2):
            adb_back()
            pg.wait_for_timeout(2500)
            s = pg.evaluate(SNAP)
            print("     第%d次返回: URL变化=%s 弹层=%s 栈顶=%s" % (
                n, s["url"] != prev["url"], "在" if s["modal"] else "无", json.dumps(s["st"])))
            if s["url"] != prev["url"]:
                print("     ⇒ 第%d次退出页面" % n)
                break
            prev = s

    print()
    print("== 脚本日志 ==")
    for l in logs:
        if "弹层" in l:
            print("   ", l[:120])
    b.close()
