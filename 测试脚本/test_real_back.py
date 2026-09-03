"""真机冒烟（匿名可达的发现页）：脚本无报错 + 没弹层时返回键照常后退"""
from lib import *
from playwright.sync_api import sync_playwright
import os, sys

URL = "https://www.zhihu.com/explore"
V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
SHOT = "D:/AiSpaces/Code/zhihu-desk2mob/测试截图/"

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    ctx = b.new_context(**DESKTOP_MODE)
    ctx.add_init_script(path=V4)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:140]))
    pg.goto(URL, wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(5000)

    info = pg.evaluate("""() => {
      const badge = document.getElementById('zhihu-mobile-badge');
      const de = document.documentElement, se = document.scrollingElement || de;
      return {badge: badge ? badge.innerText.replace(/\\n/g,' ').slice(0,40) : null,
              overflowX: se.scrollWidth - se.clientWidth,
              zoom: getComputedStyle(de).zoom,
              textLen: document.body.innerText.length};
    }""")
    print("角标:", info["badge"], "| 横向溢出:", info["overflowX"], "| zoom:", info["zoom"], "| 文本量:", info["textLen"])

    # 没弹层时按返回：必须真的退回去，不能被宽松判据吞掉
    pg.evaluate("history.pushState({t:1}, '', location.href + '#probe')")
    pg.wait_for_timeout(300)
    before = pg.url
    pg.go_back(wait_until="load", timeout=15000)
    pg.wait_for_timeout(1200)
    after = pg.url
    back_ok = after != before
    print("返回前:", before.split('/')[-1][:40], "→ 返回后:", after.split('/')[-1][:40])
    print("判定:", "✓ 无弹层时返回键正常后退" if back_ok else "✗ 返回键被脚本吞了")

    pg.screenshot(path=SHOT + "真机-发现页-v070.png")
    print("pageerror:", errs[:3])
    ok = (info["overflowX"] == 0) and back_ok and ("v0.7" in (info["badge"] or "")) and not errs
    print("\n结论:", "✅ 通过" if ok else "❌ 未通过")
    b.close()
    sys.exit(0 if ok else 1)
