"""真机：换一篇【从未访问过】的专栏文章，首次点「N 条评论」→ 是否弹层？

猜测：知乎专栏页
  • 评论区未加载（首次）→ 点评论 → 弹出评论弹层
  • 评论区已加载（滚过/再点）→ toggle 内联评论区
之前反复用同一篇 p/2044268985798104354，评论区早已加载，所以只能测到 toggle。
"""
from playwright.sync_api import sync_playwright
import subprocess, json, os, time, random

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ADB = os.path.join(ROOT, ".workbuddy", "tools", "platform-tools", "adb.exe")


def adb(*a):
    return subprocess.run([ADB] + list(a), capture_output=True, text=True, timeout=30)


def adb_back():
    subprocess.run([ADB, "shell", "input", "keyevent", "4"],
                   capture_output=True, text=True, timeout=20)


# 稳健转发：adb daemon 可能刚重启，重试直到 HTTP 可达
adb("start-server")
time.sleep(1)
import urllib.request
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for attempt in range(6):
    adb("forward", "tcp:9222", "localabstract:chrome_devtools_remote")
    time.sleep(1.2)
    try:
        opener.open("http://127.0.0.1:9222/json/version", timeout=5).read()
        print("CDP 就绪（第 %d 次尝试）" % (attempt + 1))
        break
    except Exception as e:
        print("  转发未就绪(%d): %s" % (attempt + 1, str(e)[:50]))
        time.sleep(1.5)
else:
    print("❌ CDP 无法连接"); raise SystemExit(1)

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
    return {url: location.href.slice(0,64), st: history.state,
            y: Math.round(window.scrollY||0), modal: modal};
}"""

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
    pg = b.contexts[0].pages[0]
    logs = []
    pg.on("console", lambda m: logs.append(m.text))

    # 去首页找一篇新的专栏文章
    print("前往首页找新专栏文章…")
    pg.goto("https://www.zhihu.com/", wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(5000)

    # 滚一屏找专栏链接
    for i in range(4):
        pg.mouse.move(250, 700)
        pg.mouse.wheel(0, 900)
        time.sleep(0.6)
    pg.wait_for_timeout(1500)

    links = pg.evaluate("""() => {
        const out = [];
        const as = document.querySelectorAll('a[href*="/p/"]');
        for (const a of as) {
            const h = a.getAttribute('href') || '';
            if (/^\\/p\\/\\d+|^https:\\/\\/zhuanlan\\.zhihu\\.com\\/p\\/\\d+/.test(h)) {
                out.push(h.startsWith('http') ? h : 'https://zhuanlan.zhihu.com' + h);
            }
        }
        return Array.from(new Set(out)).slice(0, 8);
    }""")
    print("  找到专栏链接 %d 条" % len(links))
    for l in links[:5]:
        print("     ", l[:70])

    target = None
    for l in links:
        if "2044268985798104354" not in l:
            target = l
            break
    if not target:
        print("  ❌ 没找到新的专栏文章"); b.close(); raise SystemExit(1)

    print()
    print("打开新文章:", target[:70])
    pg.goto(target, wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(6000)
    s0 = pg.evaluate(SNAP)
    print("  加载后: scrollY=%s 弹层=%s" % (s0["y"], "在" if s0["modal"] else "无"))

    # 点评论（不滚动，模拟首次）
    clicked = pg.evaluate("""() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
            const t = (b.textContent||'').trim();
            if (t.indexOf('条评论') >= 0) { b.click(); return t.slice(0,18); }
        }
        return null;
    }""")
    print("  点了:", clicked)
    pg.wait_for_timeout(3500)
    s1 = pg.evaluate(SNAP)
    print("  点后: 弹层=%s 栈顶=%s scrollY=%s" % (
        json.dumps(s1["modal"], ensure_ascii=False) if s1["modal"] else "无",
        json.dumps(s1["st"]), s1["y"]))

    if s1["modal"]:
        print()
        print("  ★ 新文章首次点评论 = 弹层！按返回键测试：")
        prev = s1
        for n in (1, 2, 3):
            adb_back()
            pg.wait_for_timeout(2500)
            try:
                s = pg.evaluate(SNAP)
            except Exception:
                print("     第%d次: 已退出" % n); break
            changed = s["url"] != prev["url"]
            print("     第%d次返回: URL变化=%-5s 弹层=%-3s 栈顶=%s" % (
                n, changed, "在" if s["modal"] else "无", json.dumps(s["st"])))
            if changed:
                print("     ⇒ 第%d次退出" % n); break
            prev = s

        # 再点一次（评论区已加载）看是否变成 toggle
        print()
        print("  再点一次（评论区已加载）：")
        pg.evaluate("""() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                const t = (b.textContent||'').trim();
                if (t.indexOf('条评论') >= 0) { b.click(); return; }
            }
        }""")
        pg.wait_for_timeout(3000)
        s2 = pg.evaluate(SNAP)
        print("     弹层=%s 栈顶=%s" % (
            json.dumps(s2["modal"], ensure_ascii=False) if s2["modal"] else "无", json.dumps(s2["st"])))

    print()
    print("== 脚本日志 ==")
    for l in logs:
        if "弹层" in l:
            print("   ", l[:120])
    b.close()
