# -*- coding: utf-8 -*-
"""逐个选择器测命中：复刻首页 DOM + 匿名发现页真实 DOM"""
import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright

UA_DESKTOP = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
MODE = dict(viewport={"width": 980, "height": 2130}, screen={"width": 393, "height": 852},
            device_scale_factor=2.625, has_touch=True, user_agent=UA_DESKTOP)

SELS = ['[class*="Recommend"]', '[class*="Related"]', '[class*="SideBar"]',
        '[class*="Sidebar"]', '[class*="SideColumn"]', '[class*="HotList"]',
        '[class*="AuthorCard"]']

PROBE = """
(sels) => {
  const out = [];
  for (const s of sels) {
    let n = 0; const samples = [];
    try {
      const els = document.querySelectorAll(s);
      n = els.length;
      for (const e of [...els].slice(0, 4)) {
        let c = e.className;
        if (typeof c !== 'string') c = (e instanceof SVGElement) ? 'svg:' + (e.getAttribute('class')||'') : String(c);
        samples.push(c.slice(0, 55));
      }
    } catch (e) { n = -1; }
    out.push({sel: s, n, samples});
  }
  return out;
}
"""

def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        for name, url, wait in [
            ("复刻首页", "file:///D:/AiSpaces/Code/zhihu-desk2mob/%E6%B5%8B%E8%AF%95%E8%84%9A%E6%9C%AC/testpage_home.html", "load"),
            ("匿名发现页", "https://www.zhihu.com/explore", "domcontentloaded"),
        ]:
            ctx = b.new_context(**MODE)
            page = ctx.new_page()
            page.goto(url, wait_until=wait)
            page.wait_for_timeout(4500)
            print(f"--- {name} ---")
            for r in page.evaluate(PROBE, SELS):
                if r["n"]:
                    print(f'  {r["sel"]}: {r["n"]} hits -> {r["samples"]}')
                else:
                    print(f'  {r["sel"]}: 0')
            ctx.close()
        b.close()

if __name__ == "__main__":
    main()
