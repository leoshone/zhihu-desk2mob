# -*- coding: utf-8 -*-
"""法证取证：在 0.4.0 下找出到底是哪条 CSS 规则把首页卡片藏了"""
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
      const item = document.querySelector('.TopstoryItem');
      const hits = [];
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
        for (const rule of rules) {
          if (!rule.selectorText || !rule.selectorText.includes('Recommend')) continue;
          let m = false;
          try { m = item.matches(rule.selectorText); } catch (e) {}
          if (m) hits.push({sel: rule.selectorText.slice(0, 160),
                            css: rule.style.cssText.slice(0, 80),
                            owner: (sheet.ownerNode && sheet.ownerNode.id) || '?'});
        }
      }
      return {itemDisplay: getComputedStyle(item).display,
              inlineDisplay: item.style.display,
              itemClass: item.className,
              matchingRules: hits,
              zrailEls: [...document.querySelectorAll('[data-zrail]')].map(e => e.className.slice(0, 40))};
    }
    """)
    print(json.dumps(r, ensure_ascii=False, indent=1))
    b.close()
