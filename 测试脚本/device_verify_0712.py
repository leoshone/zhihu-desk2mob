"""真机验证：确认脚本版本 + 快速探测滚动阈值是否已修复"""
from playwright.sync_api import sync_playwright
import subprocess, time, json

ADB = "D:/AiSpaces/Code/zhihu-desk2mob/.workbuddy/tools/platform-tools/adb.exe"
for a in (["start-server"], ["forward", "--remove-all"],
          ["forward", "tcp:9222", "localabstract:chrome_devtools_remote"]):
    subprocess.run([ADB] + a, capture_output=True)
time.sleep(1)

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
    pg = b.contexts[0].pages[0]
    print("当前页:", pg.url[:70])
    d = pg.evaluate("""() => ({
        badge: (document.getElementById('zhihu-mobile-badge')||{}).textContent || null,
        hasDiag: typeof window.__zfDiag === 'function',
        vw: document.documentElement.clientWidth,
        vh: document.documentElement.clientHeight,
        docH: document.documentElement.scrollHeight
    })""")
    print("角标:", d["badge"])
    print("__zfDiag 可用:", d["hasDiag"], "| 视口:", d["vw"], "x", d["vh"], "| 文档高:", d["docH"])
    if d["hasDiag"]:
        r = pg.evaluate("() => window.__zfDiag()")
        st = r.get("返回键拦截状态") or {}
        print("滚动阈值:", st.get("滚动阈值"), " (可滚动高度 =", d["docH"] - d["vh"], ")")
        th = st.get("滚动阈值") or 0
        scrollable = d["docH"] - d["vh"]
        print("阈值是否可达:", "是 ✅" if th <= scrollable else "否 ❌ (仍超文档高)")
    b.close()
