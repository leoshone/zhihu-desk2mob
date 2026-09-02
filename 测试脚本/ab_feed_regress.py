# -*- coding: utf-8 -*-
"""
A/B 回归测试：v0.3.3 vs v0.4.0 在真实知乎首页（桌面模式模拟）下的表现
重点断言：信息流帖子列表是否被误杀（可见条目数、正文文本量、被隐藏元素）
"""
import json, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright

V033 = r"D:\AiSpaces\Code\zhihu-desk2mob\测试脚本\_v033.user.js"
V040 = r"D:\AiSpaces\Code\zhihu-desk2mob\zhihu-desk2mob.user.js"
OUT  = r"D:\AiSpaces\Code\zhihu-desk2mob\测试脚本\ab_result.json"

UA_DESKTOP = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
# Kiwi「桌面版网站」：屏幕 393，layout viewport 被撑到 980，整页缩 0.4
DESKTOP_MODE = dict(viewport={"width": 980, "height": 2130},
                    screen={"width": 393, "height": 852},
                    device_scale_factor=2.625, has_touch=True,
                    user_agent=UA_DESKTOP)

URLS = [
    ("首页",   "https://www.zhihu.com/"),
    ("热榜",   "https://www.zhihu.com/hot"),
]

MEASURE = r"""
() => {
  const de = document.documentElement;
  const se = document.scrollingElement || de;
  const zoom = parseFloat(getComputedStyle(de).zoom) || 1;
  const vis = el => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 5 && r.height > 5;
  };
  // 信息流条目：知乎首页 feed item 的稳定特征是 ContentItem 类
  const items = [...document.querySelectorAll('.ContentItem, .List-item')];
  const visibleItems = items.filter(vis);
  // Topstory-recommend 是首页信息流主容器
  const feed = document.querySelector('.Topstory-recommend, [class*="Topstory"]');
  const feedHiddenByCSS = feed ? getComputedStyle(feed).display === 'none' : null;
  // 找出所有被 display:none 的"大块"元素（可能被误杀的）
  const killed = [];
  document.querySelectorAll('body *').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.display !== 'none') return;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w > 300 && h > 200) {
      killed.push({tag: el.tagName.toLowerCase(),
                   cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
                   w, h,
                   zrail: el.hasAttribute('data-zrail')});
    }
  });
  return {
    zoom: +zoom.toFixed(3),
    overflowX: Math.max(0, se.scrollWidth - se.clientWidth),
    bodyTextLen: document.body ? document.body.innerText.length : 0,
    feedTotal: items.length,
    feedVisible: visibleItems.length,
    feedHiddenByCSS,
    feedClassAndDisplay: feed ? (typeof feed.className === 'string' ? feed.className.slice(0,60) : '') + ' => ' + getComputedStyle(feed).display : 'N/A',
    bigKilled: killed.slice(0, 10),
    consoleErrors: window.__errs || [],
  };
}
"""

def run_case(browser, label, url, script_path, shot_path):
    ctx = browser.new_context(**DESKTOP_MODE)
    errs = []
    page = ctx.new_page()
    page.on("console", lambda m: errs.append(m.text[:200]) if m.type == "error" else None)
    with open(script_path, encoding="utf-8") as f:
        page.add_init_script(f.read())
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(6000)   # 等信息流懒加载 + 脚本 400/1000/2500ms 三轮 refresh
        r = page.evaluate(MEASURE)
        r["consoleErrors"] = errs[:8]
        page.screenshot(path=shot_path, full_page=False)
        r["shot"] = shot_path
    except Exception as e:
        r = {"error": str(e)[:300], "consoleErrors": errs[:8]}
    ctx.close()
    return r

def main():
    results = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        for name, url in URLS:
            for ver, path in [("v0.3.3", V033), ("v0.4.0", V040)]:
                key = f"{name}-{ver}"
                print(f"--- running {key} ---")
                shot = rf"D:\AiSpaces\Code\zhihu-desk2mob\测试截图\ab_{name}_{ver.replace('.','')}.png"
                results[key] = run_case(browser, key, url, path, shot)
                r = results[key]
                if "error" in r:
                    print(f"  ERROR: {r['error']}")
                else:
                    print(f"  feed items: visible {r['feedVisible']}/{r['feedTotal']}"
                          f" | bodyText {r['bodyTextLen']}"
                          f" | overflowX {r['overflowX']}"
                          f" | feed: {r['feedClassAndDisplay']}")
                    if r["bigKilled"]:
                        print(f"  big hidden blocks: {len(r['bigKilled'])}")
                        for k in r["bigKilled"][:4]:
                            print(f"    - <{k['tag']}> .{k['cls']} {k['w']}x{k['h']} zrail={k['zrail']}")
        browser.close()
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("saved:", OUT)

if __name__ == "__main__":
    main()
