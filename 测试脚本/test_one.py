from lib import *
from PIL import Image
import json, sys

def shrink(src, dst, w=393):
    im = Image.open(src); r = w/im.width
    im.resize((w, int(im.height*r)), Image.LANCZOS).save(dst)

script = sys.argv[1] if len(sys.argv)>1 else None
label  = sys.argv[2] if len(sys.argv)>2 else "x"
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox","--disable-blink-features=AutomationControlled"])
    ctx = b.new_context(locale="zh-CN", **DESKTOP_MODE)
    if script: ctx.add_init_script(path=script)
    pg = ctx.new_page()
    logs=[]
    pg.on("console", lambda m: logs.append(m.text[:160]) if "知乎适配" in m.text else None)
    for url in ["https://www.zhihu.com/question/19550225","https://www.zhihu.com/explore"]:
        pg.goto(url, wait_until="domcontentloaded", timeout=45000)
        pg.wait_for_timeout(5000)
        m = pg.evaluate(MEASURE_JS)
        name = url.rstrip('/').split('/')[-1]
        print(f"--- {label} | {url}")
        print(f"  zoom={m['zoom']} layoutW={m['layoutW']} cssW={m['cssW']} scrollW={m['scrollWidth']} clientW={m['clientWidth']} overflowX={m['overflowX']} count={m['overflowCount']} textLen={m['textLen']}")
        for w in m['worst'][:6]:
            print(f"    {w['w']:>5}px <{w['tag']}> .{w['cls'][:45]} [{w['pos']}] d{w['depth']}")
        pg.screenshot(path=f"{label}_{name}_raw.png")
        shrink(f"{label}_{name}_raw.png", f"{label}_{name}_screen.png")
    print("CONSOLE:", logs[:8])
    b.close()
