"""现场取证：v3 选择器存活情况、硬编码 min-width、vw/vh 规则数、DOM 规模"""
from lib import *
import json

PROBE = {
    # v3 依赖的语义 class
    ".AppHeader-inner": "v3 顶栏内层",
    ".AppHeader": "v3/v4 顶栏",
    ".SearchBar": "v3/v4 搜索框",
    ".SearchBar-container": "v3 搜索框容器",
    ".Question-main": "v3 问题主区",
    ".Topstory-container": "v3 首页容器",
    ".Question-mainColumn": "v3/v4 主列",
    ".Topstory-mainColumn": "v3/v4 首页主列",
    ".Question-sideColumn": "v3/v4 右侧栏",
    ".ColumnSideBar": "v3 专栏侧栏",
    ".GlobalSideBar": "v3 全局侧栏",
    ".Post-NormalMain": "v3 文章主体",
    ".QuestionHeader-title": "v3/v4 问题标题",
    ".RichText": "v3/v4 富文本",
    ".RichContent": "v3/v4 富文本",
    "header.AppHeader nav": "v4 顶栏导航",
}

JS = r"""
(sels) => {
  const out = {sel:{}, minw:[], vunits:0, rules:0, sheets:0, domCount:0, emotion:0, sample:[]};
  out.domCount = document.querySelectorAll('*').length;
  out.emotion  = document.querySelectorAll('[class*="css-"]').length;

  for (const s of sels) {
    const n = document.querySelectorAll(s).length;
    out.sel[s] = n;
  }

  // 硬编码 min-width 且超过 400px 的元素
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    const cs = getComputedStyle(el);
    const mw = parseFloat(cs.minWidth);
    if (mw > 400) {
      out.minw.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0,50),
        minWidth: Math.round(mw),
        width: Math.round(el.offsetWidth)
      });
      if (out.sample.length < 12) out.sample.push(el.tagName.toLowerCase() + '.' + (typeof el.className === 'string' ? el.className.slice(0,40) : '') + ' min-w=' + Math.round(mw));
    }
  }
  out.minw.sort((a,b)=>b.minWidth-a.minWidth);

  // vw / vh 规则统计
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules; } catch(e) { continue; }
    if (!rules) continue;
    out.sheets++;
    for (const r of rules) {
      if (!r || !r.style) continue;
      out.rules++;
      for (let k=0;k<r.style.length;k++){
        const v = r.style.getPropertyValue(r.style[k]);
        if (v.indexOf('vw') >= 0 || v.indexOf('vh') >= 0) { out.vunits++; break; }
      }
    }
  }
  return out;
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
    ctx = b.new_context(locale="zh-CN", **DESKTOP_MODE)
    pg = ctx.new_page()
    pg.goto("https://www.zhihu.com/question/19550225", wait_until="domcontentloaded", timeout=45000)
    pg.wait_for_timeout(6000)
    r = pg.evaluate(JS, list(PROBE.keys()))
    print("=== 页面规模 ===")
    print(f"DOM 元素总数: {r['domCount']}   emotion 原子类元素: {r['emotion']}")
    print(f"样式表: {r['sheets']} 张, 规则 {r['rules']} 条, 含 vw/vh 的规则 {r['vunits']} 条")
    print("\n=== v3 依赖的选择器存活情况（问题页）===")
    for s, desc in PROBE.items():
        n = r["sel"][s]
        flag = "存活" if n else "*** 已消失（死代码）***"
        print(f"  {s:<28} {n:>4} 个   {desc}  {flag}")
    print("\n=== 硬编码 min-width > 400px 的元素 ===")
    print(f"  共 {len(r['minw'])} 个，前 10：")
    for m in r["minw"][:10]:
        print(f"    min-width={m['minWidth']:>5}px  实测宽={m['width']:>5}px  <{m['tag']}> .{m['cls']}")
    b.close()
    json.dump(r, open("forensics.json", "w"), ensure_ascii=False, indent=1)
