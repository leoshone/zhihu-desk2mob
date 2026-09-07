"""真机：验证评论区选择器能否命中（IntersectionObserver 方案的前提）"""
from playwright.sync_api import sync_playwright
import subprocess, time, json

ADB = "D:/AiSpaces/Code/zhihu-desk2mob/.workbuddy/tools/platform-tools/adb.exe"
for a in (["start-server"], ["forward", "--remove-all"],
          ["forward", "tcp:9222", "localabstract:chrome_devtools_remote"]):
    subprocess.run([ADB] + a, capture_output=True)
time.sleep(1)

JS = """
() => {
    const sels = ['.Comments-container', '[class*="Comments-container"]',
                  '.CommentList', '#CommentList', '[class*="Comment"]'];
    const out = {};
    for (const s of sels) {
        const els = document.querySelectorAll(s);
        const arr = [];
        for (let i = 0; i < els.length && arr.length < 5; i++) {
            const el = els[i];
            const rc = el.getBoundingClientRect();
            arr.push({
                cls: (typeof el.className === 'string' ? el.className : '').slice(0, 34),
                w: Math.round(rc.width), h: Math.round(rc.height),
                top: Math.round(rc.top),
                txt: ((el.innerText || '').trim()).length
            });
        }
        out[s] = {count: els.length, sample: arr};
    }
    out['__docH'] = document.documentElement.scrollHeight;
    out['__vh'] = document.documentElement.clientHeight;
    out['__scrollY'] = Math.round(window.scrollY || 0);
    return out;
}
"""

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
    pg = b.contexts[0].pages[0]
    print("url:", pg.url[:70])
    r = pg.evaluate(JS)
    print("文档高:", r["__docH"], " 视口高:", r["__vh"], " scrollY:", r["__scrollY"])
    print()
    for k in ('.Comments-container', '[class*="Comments-container"]',
              '.CommentList', '#CommentList', '[class*="Comment"]'):
        v = r[k]
        print("%-32s 命中 %d 个" % (k, v["count"]))
        for x in v["sample"]:
            print("     · %-32s %dx%d top=%s 文字%s" % (
                x["cls"], x["w"], x["h"], x["top"], x["txt"]))
        print()
    b.close()
