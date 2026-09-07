"""真机：点「N 条评论」到底发生了什么？弹窗还是滚动？有无新标签？

上一轮发现：点评论后弹层=无，且脚本重新初始化（屏幕 280px / 视口 357px，
与正常的 393px / 891px 不同）→ 怀疑打开了新标签或页面跳转。
"""
from playwright.sync_api import sync_playwright
import subprocess, json, os, time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ADB = os.path.join(ROOT, ".workbuddy", "tools", "platform-tools", "adb.exe")


def adb(*args):
    return subprocess.run([ADB] + list(args), capture_output=True, text=True, timeout=30)


def tabs():
    adb("forward", "--remove-all")
    adb("forward", "tcp:9222", "localabstract:chrome_devtools_remote")
    time.sleep(0.5)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        data = json.load(opener.open("http://127.0.0.1:9222/json/list", timeout=10))
    except Exception as e:
        return []
    return [(t.get("type"), t.get("title", "")[:40], t.get("url", "")[:70], t.get("id"))
            for t in data if t.get("type") == "page"]


adb("start-server")
before = tabs()
print("=== 点前标签 (%d) ===" % len(before))
for t in before:
    print("  [%s] %s | %s" % (t[0], t[1], t[2]))

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
    pg = b.contexts[0].pages[0]
    print()
    print("当前页:", pg.url[:70])
    env0 = pg.evaluate("""() => ({
        sw: window.screen.width, sh: window.screen.height,
        iw: window.innerWidth, ih: window.innerHeight,
        vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight,
        zoom: getComputedStyle(document.documentElement).zoom,
        scrollY: Math.round(window.scrollY||0),
        docH: document.documentElement.scrollHeight
    })""")
    print("环境(点前):", json.dumps(env0, ensure_ascii=False))

    # 找评论按钮，记录它的位置和父级信息
    info = pg.evaluate("""() => {
        const btns = document.querySelectorAll('button, [role="button"]');
        const out = [];
        for (const b of btns) {
            const t = (b.textContent || '').trim();
            if (t.indexOf('评论') >= 0 && t.length <= 24) {
                const r = b.getBoundingClientRect();
                out.push({tag: b.tagName, text: t,
                          cls: (typeof b.className==='string'?b.className:'').slice(0,40),
                          rect: Math.round(r.width)+'x'+Math.round(r.height)+'@'+Math.round(r.top),
                          href: b.getAttribute('href')||'',
                          parentTag: b.parentElement ? b.parentElement.tagName : '',
                          parentCls: b.parentElement ? (typeof b.parentElement.className==='string'?b.parentElement.className:'').slice(0,30) : ''});
            }
        }
        return out.slice(0, 5);
    }""")
    print()
    print("评论按钮候选:")
    for x in info:
        print("   ", json.dumps(x, ensure_ascii=False))

    # 点第一个
    pg.evaluate("""() => {
        const btns = document.querySelectorAll('button, [role="button"]');
        for (const b of btns) {
            const t = (b.textContent || '').trim();
            if (t.indexOf('评论') >= 0 && t.length <= 24) { b.click(); return; }
        }
    }""")
    pg.wait_for_timeout(4000)

    env1 = pg.evaluate("""() => ({
        sw: window.screen.width, sh: window.screen.height,
        iw: window.innerWidth, ih: window.innerHeight,
        vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight,
        zoom: getComputedStyle(document.documentElement).zoom,
        scrollY: Math.round(window.scrollY||0),
        docH: document.documentElement.scrollHeight,
        url: location.href
    })""")
    print()
    print("环境(点后):", json.dumps(env1, ensure_ascii=False))
    print("  → scrollY: %s → %s  (变化说明是滚动定位，不是弹窗)" % (env0["scrollY"], env1["scrollY"]))
    print("  → 视口: %sx%s → %sx%s" % (env0["vw"], env0["vh"], env1["vw"], env1["vh"]))
    b.close()

after = tabs()
print()
print("=== 点后标签 (%d) ===" % len(after))
for t in after:
    print("  [%s] %s | %s" % (t[0], t[1], t[2]))
if len(after) != len(before):
    print("  ⚠ 标签数变化: %d → %d" % (len(before), len(after)))
