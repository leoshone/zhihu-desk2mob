"""在真实知乎页面上审计 hideRightRail：到底隐藏了什么？有没有误伤正文？

脚本隐藏元素的方式是 inline style `display:none !important`，
所以只要把带这条 inline 样式的元素捞出来，就知道它动了谁。
"""
from lib import *
from playwright.sync_api import sync_playwright
import os, sys

V4 = "/workspace/zhihu-mobile/zhihu-desk2mob.user.js"

URLS = [
    ("问题页", "https://www.zhihu.com/question/19550225"),
    ("发现页", "https://www.zhihu.com/explore"),
]

M = r"""
() => {
  const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const se = document.scrollingElement || document.documentElement;
  const hidden = [];
  for (const el of document.querySelectorAll('body *')) {
    // 只看脚本自己设的 inline display:none（元素自身，不看父级）
    if (el.style && el.style.display === 'none' &&
        el.style.getPropertyPriority('display') === 'important') {
      hidden.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 48),
        txt: (el.innerText || '').trim().slice(0, 46).replace(/\s+/g, ' '),
        txtLen: (el.innerText || '').trim().length,
        depth: (function(){let d=0,p=el;while(p&&p!==document.body){d++;p=p.parentElement}return d})(),
      });
    }
  }
  // 主内容宽度，确认没有把正文藏了
  const probes = {};
  for (const s of ['article.Post-Main','.Question-main','.Topstory-mainColumn',
                   '.RichText','.Question-mainColumn','main']) {
    const el = document.querySelector(s);
    if (!el) continue;
    const cs = getComputedStyle(el);
    probes[s] = {w: el.offsetWidth, disp: cs.display,
                 txt: (el.innerText||'').trim().length};
  }
  return {
    zoom: +zoom.toFixed(4),
    cssW: Math.round(document.documentElement.clientWidth / zoom),
    overflowX: se.scrollWidth - se.clientWidth,
    bodyTxt: (document.body.innerText||'').trim().length,
    hiddenCount: hidden.length,
    hidden: hidden,
    probes: probes,
    title: (document.title||'').slice(0, 40),
  };
}
"""

bad = 0
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for name, url in URLS:
        for mode, script in (("无脚本", None), ("装脚本", V4)):
            ctx = b.new_context(**DESKTOP_MODE)
            if script:
                ctx.add_init_script(path=script)
            pg = ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
            try:
                pg.goto(url, wait_until="domcontentloaded", timeout=45000)
                pg.wait_for_timeout(5000)
            except Exception as e:
                print(f"[{name}/{mode}] 加载失败: {str(e)[:70]}")
                ctx.close()
                continue
            d = pg.evaluate(M)
            print(f"\n===== {name} · {mode} =====")
            print(f"  zoom={d['zoom']} cssW={d['cssW']} overflowX={d['overflowX']} "
                  f"正文总字数={d['bodyTxt']}  title={d['title']}")
            if mode == "装脚本":
                if not d["hidden"]:
                    print("  脚本隐藏了 0 个元素")
                for h in d["hidden"]:
                    mark = "⚠" if h["txtLen"] > 400 else "·"
                    print(f"  {mark} 隐藏 <{h['tag']}> .{h['cls']}  深度{h['depth']} "
                          f"txt={h['txtLen']}  「{h['txt']}」")
                print("  主内容现状：")
                for k, v in d["probes"].items():
                    flag = "  ✗ 被藏了！" if v["disp"] == "none" else ""
                    print(f"    {k:<28} 宽={v['w']:<5} disp={v['disp']:<8} txt={v['txt']}{flag}")
                    if v["disp"] == "none" and v["txt"] > 300:
                        bad += 1
            if errs:
                print("  pageerror:", errs[:2])
            ctx.close()
    b.close()

print("\n" + "=" * 46)
print("结论：" + ("没有误伤主内容" if bad == 0 else f"{bad} 处主内容被误藏"))
sys.exit(1 if bad else 0)
