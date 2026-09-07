"""真机：滚到评论区，再查评论区容器类名（懒加载后才出现）"""
from playwright.sync_api import sync_playwright
import subprocess, time, json, random

ADB = "D:/AiSpaces/Code/zhihu-desk2mob/.workbuddy/tools/platform-tools/adb.exe"
for a in (["start-server"], ["forward", "--remove-all"],
          ["forward", "tcp:9222", "localabstract:chrome_devtools_remote"]):
    subprocess.run([ADB] + a, capture_output=True)
time.sleep(1)

JS = """
() => {
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    // 找出所有「够大且文字量多」的块，看哪个像评论区
    const all = document.body.querySelectorAll('div,section');
    const big = [];
    for (let i = 0; i < all.length; i++) {
        const el = all[i];
        const rc = el.getBoundingClientRect();
        if (rc.height < 300) continue;
        const t = (el.innerText || '').trim();
        if (t.length < 200) continue;
        // 评论区特征：包含「条评论」或大量「回复」「赞」
        const isCmt = /条评论|写评论|条回复|刚刚|小时前|天前/.test(t);
        big.push({
            cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
            h: Math.round(rc.height), top: Math.round(rc.top),
            txt: t.length, isCmt: isCmt
        });
    }
    const sels = ['.Comments-container', '[class*="Comments-container"]',
                  '.CommentList', '[class*="CommentList"]', '[class*="Comments"]'];
    const selOut = {};
    for (const s of sels) {
        const els = document.querySelectorAll(s);
        const arr = [];
        for (let i = 0; i < els.length && arr.length < 3; i++) {
            const rc = els[i].getBoundingClientRect();
            arr.push({cls: (typeof els[i].className === 'string' ? els[i].className : '').slice(0, 34),
                      h: Math.round(rc.height), top: Math.round(rc.top),
                      txt: ((els[i].innerText || '').trim()).length});
        }
        selOut[s] = {count: els.length, sample: arr};
    }
    return {docH: document.documentElement.scrollHeight, vh: vh,
            scrollY: Math.round(window.scrollY || 0),
            bigBlocks: big.slice(-8), selOut: selOut};
}
"""

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
    pg = b.contexts[0].pages[0]
    print("url:", pg.url[:70])

    # 真人节奏滚到评论区
    for i in range(14):
        pg.mouse.move(200 + random.randint(-40, 40), 700 + random.randint(-60, 60))
        pg.mouse.wheel(0, random.randint(800, 1400))
        time.sleep(random.uniform(0.4, 0.9))
    pg.wait_for_timeout(2500)

    r = pg.evaluate(JS)
    print("文档高:", r["docH"], "视口:", r["vh"], "scrollY:", r["scrollY"])
    print()
    print("== 评论区选择器（滚动后）==")
    for k, v in r["selOut"].items():
        print("  %-32s 命中 %d" % (k, v["count"]))
        for x in v["sample"]:
            print("       · %-32s h=%s top=%s 文字%s" % (x["cls"], x["h"], x["top"], x["txt"]))
    print()
    print("== 像评论区的大块（末尾 8 个）==")
    for x in r["bigBlocks"]:
        print("   %-40s h=%-6s top=%-8s 文字%-6s 像评论=%s" % (
            x["cls"], x["h"], x["top"], x["txt"], x["isCmt"]))
    b.close()
