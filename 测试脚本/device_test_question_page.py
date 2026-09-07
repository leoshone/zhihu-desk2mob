"""真机：在【问题页/回答页】测评论弹层（交接文档记录：问题页点评论弹 fixed 满屏弹层）

用户手机上的问题页：question/314351005/answer/2078905093672399624
"""
from playwright.sync_api import sync_playwright
import subprocess, json, os, time, random

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ADB = os.path.join(ROOT, ".workbuddy", "tools", "platform-tools", "adb.exe")
TARGET = "https://www.zhihu.com/question/314351005/answer/2078905093672399624"


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
            y: Math.round(window.scrollY||0), modal: modal};
}"""

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
    pg = b.contexts[0].pages[0]
    logs = []
    pg.on("console", lambda m: logs.append(m.text))

    print("前往问题页…")
    pg.goto(TARGET, wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(6000)
    s0 = pg.evaluate(SNAP)
    print("  加载后:", s0["url"])
    print("  视口:", pg.evaluate("() => document.documentElement.clientWidth"),
          "x", pg.evaluate("() => document.documentElement.clientHeight"),
          "| zoom:", pg.evaluate("() => getComputedStyle(document.documentElement).zoom"))

    # 找评论按钮
    cands = pg.evaluate("""() => {
        const out = [];
        const els = document.querySelectorAll('button, a, [role="button"]');
        for (const el of els) {
            const t = (el.textContent||'').trim();
            if (!/评论/.test(t) || t.length > 24) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 20 || r.height < 12) continue;
            out.push({tag: el.tagName, text: t.slice(0,18),
                      cls: (typeof el.className==='string'?el.className:'').slice(0,34),
                      top: Math.round(r.top)});
        }
        return out.slice(0, 6);
    }""")
    print()
    print("  评论入口:")
    for c in cands:
        print("     ", json.dumps(c, ensure_ascii=False))

    print()
    print("  点第一个「评论」入口…")
    clicked = pg.evaluate("""() => {
        const els = document.querySelectorAll('button, a, [role="button"]');
        for (const el of els) {
            const t = (el.textContent||'').trim();
            if (/评论/.test(t) && t.length <= 24) {
                const r = el.getBoundingClientRect();
                if (r.top > -100 && r.top < 1800) { el.click(); return t.slice(0,20); }
            }
        }
        return null;
    }""")
    print("  点了:", clicked)
    pg.wait_for_timeout(3500)
    s1 = pg.evaluate(SNAP)
    print("  点后: 弹层=%s | 栈顶=%s" % (
        json.dumps(s1["modal"], ensure_ascii=False) if s1["modal"] else "无", json.dumps(s1["st"])))

    if s1["modal"]:
        print()
        print("  ★ 弹层已出现！按返回键测试：")
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
        print("  问题页也未弹窗")

    print()
    print("== 脚本日志 ==")
    for l in logs:
        if "弹层" in l:
            print("   ", l[:120])
    b.close()
