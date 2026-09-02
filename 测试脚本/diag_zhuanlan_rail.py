# -*- coding: utf-8 -*-
"""归因：新专栏页（右栏为普通 div 哈希类名）为什么右栏跑到正文底部"""
import io, sys, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright

UA_DESKTOP = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
MODE = dict(viewport={"width": 980, "height": 2130}, screen={"width": 393, "height": 852},
            device_scale_factor=2.625, has_touch=True, user_agent=UA_DESKTOP)

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True)
    ctx = b.new_context(**MODE)
    page = ctx.new_page()
    with open(r"D:\AiSpaces\Code\zhihu-desk2mob\zhihu-desk2mob.user.js", encoding="utf-8") as f:
        page.add_init_script(f.read())
    page.goto("file:///D:/AiSpaces/Code/zhihu-desk2mob/%E6%B5%8B%E8%AF%95%E8%84%9A%E6%9C%AC/testpage_zhuanlan_new.html",
              wait_until="load")
    page.wait_for_timeout(4000)
    r = page.evaluate(r"""
    () => {
      const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const main = document.querySelector('.main');
      const rail = document.querySelector('.rail');
      const wrap = main.parentElement;
      const mr = main.getBoundingClientRect();
      const rr = rail.getBoundingClientRect();
      return {
        wrapDisplay: getComputedStyle(wrap).display,
        wrapFlexWrap: getComputedStyle(wrap).flexWrap,
        railInlineStyle: (rail.getAttribute('style') || '').slice(0, 140),
        railDisplay: getComputedStyle(rail).display,
        railLeft: Math.round(rr.left / z),
        railTop: Math.round(rr.top / z),
        mainRight: Math.round((mr.left + mr.width) / z),
        mainTxt: (main.innerText || '').trim().length,
        railTxt: (rail.innerText || '').trim().length,
        railW: Math.round(rr.width / z)
      };
    }
    """)
    print(json.dumps(r, ensure_ascii=False, indent=1))
    b.close()
