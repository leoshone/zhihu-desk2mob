# -*- coding: utf-8 -*-
"""诊断：灰色区域到底是谁的背景 —— 在复刻首页上逐层查背景色"""
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
    page.goto("file:///D:/AiSpaces/Code/zhihu-desk2mob/%E6%B5%8B%E8%AF%95%E8%84%9A%E6%9C%AC/testpage_home.html",
              wait_until="load")
    page.wait_for_timeout(3000)
    r = page.evaluate(r"""
    () => {
      const info = (el, name) => {
        if (!el) return {name, missing: true};
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        return {name, bg: cs.backgroundColor, x: Math.round(r.left/z), w: Math.round(r.width/z),
                padL: cs.paddingLeft, padR: cs.paddingRight};
      };
      const chain = [];
      let el = document.querySelector('.TopstoryItem');
      // 从帖子卡片向上爬到 body，看每一层的底色与左右边界
      while (el && el !== document.documentElement) {
        chain.push(info(el, el.className.toString().slice(0, 40) || el.tagName));
        el = el.parentElement;
      }
      return {chain,
              htmlBg: getComputedStyle(document.documentElement).backgroundColor,
              bodyBg: getComputedStyle(document.body).backgroundColor};
    }
    """)
    print(json.dumps(r, ensure_ascii=False, indent=1))
    b.close()
