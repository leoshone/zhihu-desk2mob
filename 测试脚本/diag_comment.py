"""探测真实知乎评论弹层的 DOM 结构（匿名可达页面）"""
from lib import *
from playwright.sync_api import sync_playwright
import json, os

URL = "https://zhuanlan.zhihu.com/p/2074785936261505339"
V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"

DUMP = r"""
() => {
  const out = {url: location.href, title: document.title, zoom: getComputedStyle(document.documentElement).zoom};
  out.loginWall = location.pathname.indexOf('signin') >= 0 || !!document.querySelector('.SignFlow');
  // 找带「评论」字样的可点元素
  const cands = [];
  const all = document.querySelectorAll('button,a,div[role="button"],span[role="button"]');
  for (const el of all) {
    const t = (el.innerText||'').trim();
    if (t && /评论|回复/.test(t) && t.length < 20) {
      const r = el.getBoundingClientRect();
      cands.push({tag: el.tagName, cls: (typeof el.className==='string'?el.className:'').slice(0,60),
                  text: t.slice(0,20), w: Math.round(r.width), h: Math.round(r.height),
                  top: Math.round(r.top)});
    }
  }
  out.commentButtons = cands.slice(0, 15);
  return out;
}
"""

DUMP_LAYERS = r"""
() => {
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const all = document.querySelectorAll('body *');
  const layers = [];
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
    const r = el.getBoundingClientRect();
    if (r.width < vw*0.3 || r.height < vh*0.2) continue;
    let depth=0,p=el; while(p && p!==document.body){depth++;p=p.parentElement}
    layers.push({
      tag: el.tagName, cls: (typeof el.className==='string'?el.className:'').slice(0,70),
      pos: cs.position, z: cs.zIndex, w: Math.round(r.width), h: Math.round(r.height),
      left: Math.round(r.left), top: Math.round(r.top), depth,
      text: (el.innerText||'').slice(0,40).replace(/\n/g,' '),
      kids: el.children.length
    });
  }
  const seen = new Set(), uniq = [];
  for (const l of layers) { const k = l.cls+l.tag+Math.round(l.w/10); if (!seen.has(k)) { seen.add(k); uniq.push(l); } }
  return {vw, vh, zoom, layers: uniq.slice(0, 25)};
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    ctx = b.new_context(**DESKTOP_MODE)
    ctx.add_init_script(path=V4)
    pg = ctx.new_page()
    pg.goto(URL, wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(4000)
    d = pg.evaluate(DUMP)
    print("== 页面 ==")
    print(json.dumps(d, ensure_ascii=False, indent=1)[:2500])

    if d["loginWall"]:
        print("\n!! 撞登录墙，没法继续")
        b.close(); raise SystemExit(0)

    # 尝试点第一个评论相关按钮
    btns = pg.query_selector_all("button, a, div[role=button]")
    target = None
    for el in btns:
        t = (el.inner_text() or "").strip()
        if t and "评论" in t and len(t) < 15:
            target = el; print("\n点击:", t); break
    if target:
        try:
            target.click(timeout=5000)
        except Exception as e:
            print("click 失败:", str(e)[:100])
            try: pg.evaluate("(el)=>el.click()", target)
            except Exception as e2: print("js click 失败:", str(e2)[:80])
        pg.wait_for_timeout(2500)
        lay = pg.evaluate(DUMP_LAYERS)
        print("\n== 点击后的浮层 ==")
        print(json.dumps(lay, ensure_ascii=False, indent=1)[:4000])
        pg.screenshot(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "测试截图", "真机-评论弹层.png"))
    else:
        print("\n没找到评论按钮")
    b.close()
