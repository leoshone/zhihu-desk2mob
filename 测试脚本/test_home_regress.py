# -*- coding: utf-8 -*-
"""
首页复刻页 A/B：验证 [class*="Recommend"] 误杀 TopstoryItem-isRecommend
v0.3.3 应该正常显示 5 张卡片；v0.4.0 应该复现「列表消失」
"""
import io, sys, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright

PAGE = r"D:\AiSpaces\Code\zhihu-desk2mob\测试脚本\testpage_home.html"
V033 = r"D:\AiSpaces\Code\zhihu-desk2mob\测试脚本\_v033.user.js"
V040 = r"D:\AiSpaces\Code\zhihu-desk2mob\zhihu-desk2mob.user.js"

UA_DESKTOP = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
DESKTOP_MODE = dict(viewport={"width": 980, "height": 2130},
                    screen={"width": 393, "height": 852},
                    device_scale_factor=2.625, has_touch=True,
                    user_agent=UA_DESKTOP)

MEASURE = r"""
() => {
  const vis = el => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetHeight > 5;
  };
  const items = [...document.querySelectorAll('.TopstoryItem')];
  const visible = items.filter(vis);
  // 逐卡片列出被谁藏了
  const detail = items.slice(0,6).map(el => ({
    cls: el.className.replace(/\s+/g,' ').slice(0,60),
    display: getComputedStyle(el).display,
    h: el.offsetHeight
  }));
  const feed = document.querySelector('.Topstory-recommend');
  const main = document.querySelector('.Topstory-mainColumn');
  return {
    itemsTotal: items.length,
    itemsVisible: visible.length,
    detail,
    feedDisplay: feed ? getComputedStyle(feed).display : 'N/A',
    mainDisplay: main ? getComputedStyle(main).display : 'N/A',
    mainW: main ? main.offsetWidth : 0,
    bodyTxt: document.body.innerText.length,
    overflowX: Math.max(0,(document.scrollingElement||document.documentElement).scrollWidth -
                          (document.scrollingElement||document.documentElement).clientWidth)
  };
}
"""

def main():
    results = {}
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        for ver, path in [("v0.3.3", V033), ("v0.4.0", V040)]:
            ctx = b.new_context(**DESKTOP_MODE)
            page = ctx.new_page()
            with open(path, encoding="utf-8") as f:
                page.add_init_script(f.read())
            page.goto("file:///" + PAGE.replace("\\", "/"), wait_until="load")
            page.wait_for_timeout(3500)
            r = page.evaluate(MEASURE)
            shot = rf"D:\AiSpaces\Code\zhihu-desk2mob\测试截图\home_ab_{ver.replace('.','')}.png"
            page.screenshot(path=shot)
            r["shot"] = shot
            results[ver] = r
            ctx.close()
        b.close()

    print("=" * 60)
    for ver, r in results.items():
        print(f"{ver}: 卡片可见 {r['itemsVisible']}/{r['itemsTotal']} | "
              f"feed display={r['feedDisplay']} | 主列 {r['mainW']}px | "
              f"bodyText={r['bodyTxt']} | overflowX={r['overflowX']}")
        for d in r["detail"][:3]:
            print(f"   [{d['display']:>5}] h={d['h']:4d} {d['cls']}")
    print("=" * 60)
    ok = (results["v0.3.3"]["itemsVisible"] == results["v0.3.3"]["itemsTotal"]
          and results["v0.4.0"]["itemsVisible"] == results["v0.4.0"]["itemsTotal"])
    print("判定：", "✅ 通过——两版信息流全部可见（0.4.1 修复生效）" if ok
          else "❌ 回归——当前脚本仍会隐藏首页信息流，检查 [class*=Recommend] 类规则")
    with open(r"D:\AiSpaces\Code\zhihu-desk2mob\测试脚本\home_ab_result.json",
              "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
