"""诊断专栏页布局：正文被挤窄、右侧栏占屏"""
from lib import *

V4 = "/workspace/zhihu-mobile/zhihu-desk2mob.user.js"
URL = "https://zhuanlan.zhihu.com/p/2044268985798104354"

INFO_JS = r"""
() => {
  const base = 393;
  const out = {rows: [], containers: []};
  const de = document.documentElement;
  const zoom = parseFloat(getComputedStyle(de).zoom) || 1;
  out.zoom = +zoom.toFixed(4);
  out.layoutW = de.clientWidth;
  out.cssW = Math.round(de.clientWidth / zoom);
  const se = document.scrollingElement || de;
  out.overflowX = se.scrollWidth - se.clientWidth;

  // 找出所有「宽度显著」且包含文本的元素，看看谁占了多少
  const all = document.querySelectorAll('body *');
  const rows = [];
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const w = el.offsetWidth;
    if (w < 120) continue;
    // 只看「有实际文本内容」的块，且不是祖先级的巨大容器
    const txt = (el.innerText || '').trim();
    if (txt.length < 20) continue;
    const children = el.children.length;
    rows.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
      w: Math.round(w),
      left: Math.round(el.getBoundingClientRect().left / zoom),
      ch: children,
      txt: txt.slice(0, 30).replace(/\s+/g, ' '),
      disp: cs.display,
      pos: cs.position,
      flex: cs.flex,
      minW: cs.minWidth,
    });
  }
  // 按宽度排序，同时保留层级感
  rows.sort((a, b) => b.w - a.w);
  out.rows = rows.slice(0, 18);

  // 专门的：主内容列 / 侧栏候选
  const sels = ['.Post-SideColumn', '.ColumnSideBar', '.Post-NormalMain', '.Post-content',
                '.ArticleItem', 'main', 'article', 'aside', '.Post-Main', '.PostHeader',
                '[class*="SideColumn"]', '[class*="SideBar"]', '[class*="Sidebar"]',
                '.RichText', '.RichContent', '.ztext'];
  for (const s of sels) {
    const els = document.querySelectorAll(s);
    for (const el of els) {
      const cs = getComputedStyle(el);
      out.containers.push({
        sel: s,
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 50),
        w: Math.round(el.offsetWidth),
        left: Math.round(el.getBoundingClientRect().left / zoom),
        display: cs.display,
        minW: cs.minWidth,
        width: cs.width,
        flex: cs.flex,
        visible: cs.display !== 'none' && cs.visibility !== 'hidden',
      });
    }
  }
  return out;
}
"""

def run(label, script):
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
        ctx = b.new_context(locale="zh-CN", **DESKTOP_MODE)
        if script:
            ctx.add_init_script(path=script)
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:100]))
        try:
            pg.goto(URL, wait_until="domcontentloaded", timeout=45000)
        except Exception as e:
            print("  goto:", str(e)[:60])
        pg.wait_for_timeout(6000)
        for y in (700, 1600):
            pg.mouse.wheel(0, y); pg.wait_for_timeout(400)
        pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(600)
        d = pg.evaluate(INFO_JS)
        print(f"\n===== {label} =====")
        print(f"zoom={d['zoom']} layoutW={d['layoutW']} cssW={d['cssW']} overflowX={d['overflowX']}")
        print("\n-- 最宽的有文本元素（前 12）--")
        for r in d["rows"][:12]:
            print(f"  w={r['w']:>4} left={r['left']:>4} <{r['tag']}> .{r['cls'][:38]:<38} "
                  f"disp={r['disp']:<12} minW={r['minW']:<8} | {r['txt'][:24]}")
        print("\n-- 主列 / 侧栏候选 --")
        for c in d["containers"]:
            v = "显示" if c["visible"] else "已隐藏"
            print(f"  [{v}] {c['sel']:<26} w={c['w']:>4} left={c['left']:>4} "
                  f"disp={c['display']:<12} minW={c['minW']:<8} .{c['cls'][:32]}")
        if errs:
            print("\npageerror:", errs[:2])
        pg.screenshot(path=f"/tmp/zl_{label}.png")
        b.close()

run("no_script", None)
run("with_v4", V4)
