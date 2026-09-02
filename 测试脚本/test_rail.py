"""验证 hideRightRail（按位置去掉右侧栏）：只看位置、不看类名，且不能误伤评论区/底部推荐

判据：
  · 专栏页  article.Post-Main  明显变宽
  · 右侧栏  #railZhuanlan      变 display:none
  · 评论区  #cmtZone / 推荐区 #recZone  必须活着（误伤检查）
  · 首页    .Topstory-mainColumn 变宽，#railHome 消失
"""
from lib import *
from playwright.sync_api import sync_playwright
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
BASE = "file://" + os.path.join(HERE, "testpage_rail.html")

M = r"""
() => {
  const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const se = document.scrollingElement || document.documentElement;
  const vis = (id) => {
    const el = document.getElementById(id);
    if (!el) return {found:false};
    const cs = getComputedStyle(el);
    return {found:true, disp:cs.display, w:el.offsetWidth, h:el.offsetHeight,
            txt:(el.innerText||'').trim().length};
  };
  const q = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.offsetWidth : -1;
  };
  return {
    zoom: +zoom.toFixed(4),
    cssW: Math.round(document.documentElement.clientWidth / zoom),
    overflowX: se.scrollWidth - se.clientWidth,
    // 主内容
    postMain: q('article.Post-Main'),
    richText: q('.RichText'),
    topstory: q('.Topstory-mainColumn'),
    // 右侧栏（纯哈希类名，没有任何语义 class）
    railZ: vis('railZhuanlan'),
    railH: vis('railHome'),
    // 误伤检查目标
    cmtZone: vis('cmtZone'),
    recZone: vis('recZone'),
  };
}
"""

def show(tag, d):
    print(f"\n===== {tag} =====")
    print(f"  zoom={d['zoom']}  cssW={d['cssW']}  overflowX={d['overflowX']}")
    g = lambda k: (str(d[k]) + 'px') if isinstance(d[k], (int, float)) else '—'
    print(f"  正文 article.Post-Main = {g('postMain')}   .RichText = {g('richText')}"
          f"   .Topstory-mainColumn = {g('topstory')}")
    for name, key in (("右侧栏#railZhuanlan", "railZ"), ("右侧栏#railHome", "railH"),
                      ("评论区#cmtZone", "cmtZone"), ("推荐区#recZone", "recZone")):
        v = d[key]
        if not v["found"]:
            print(f"  {name:<20} (本场景不存在)")
        else:
            print(f"  {name:<20} display={v['disp']:<8} 宽={v['w']:<5} 高={v['h']:<5} txt={v['txt']}")

def judge(d):
    """返回 (通过项, 失败项)"""
    ok, bad = [], []
    # 只对本场景存在的元素做判定
    # 两个场景共存于同一页面，靠父元素 display 切换。三态区分：
    #   hidden = 自身 display:none（被脚本去掉）
    #   shown  = 本场景存在且还显示着
    #   na     = 不在本场景（父元素隐藏，自身 computed display 仍是 block，但宽高为 0）
    def state(v):
        if not v["found"]:
            return "na"
        if v["disp"] == "none":
            return "hidden"
        return "shown" if (v["w"] > 0 or v["h"] > 0) else "na"

    for name, key in (("专栏页右侧栏", "railZ"), ("首页右侧栏", "railH")):
        s = state(d[key])
        if s == "hidden":
            ok.append(f"{name}已去掉")
        elif s == "shown":
            bad.append(f"{name}没去掉（宽={d[key]['w']} 高={d[key]['h']}）")

    for name, key in (("评论区", "cmtZone"), ("推荐区", "recZone")):
        s = state(d[key])
        if s == "shown":
            ok.append(f"{name}保住了（未被误伤）")
        elif s == "hidden":
            bad.append(f"{name}被误伤了")

    main = d["postMain"] if d["postMain"] > 0 else d["topstory"]
    if main >= 300:
        ok.append(f"正文宽 {main}px ≥ 300")
    else:
        bad.append(f"正文只有 {main}px，太窄")
    if d["overflowX"] <= 0:
        ok.append("无横向溢出")
    else:
        bad.append(f"横向溢出 {d['overflowX']}px")
    return ok, bad

allbad = 0
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for scene, label in (("", "专栏页"), ("#home", "首页")):
        url = BASE + scene
        for mode, script in (("无脚本", None), ("装脚本", V4)):
            ctx = b.new_context(**DESKTOP_MODE)
            if script:
                ctx.add_init_script(path=script)
            pg = ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)[:140]))
            pg.goto(url, wait_until="load", timeout=30000)
            pg.wait_for_timeout(3000)
            d = pg.evaluate(M)
            show(f"{label} · {mode}", d)
            if mode == "装脚本":
                ok, bad = judge(d)
                for x in ok:
                    print("    ✓ " + x)
                for x in bad:
                    print("    ✗ " + x)
                allbad += len(bad)
            if errs:
                print("    pageerror:", errs[:2])
            ctx.close()
    b.close()

print("\n" + ("=" * 46))
print("结论：" + ("全部通过" if allbad == 0 else f"{allbad} 项未通过"))
sys.exit(1 if allbad else 0)
