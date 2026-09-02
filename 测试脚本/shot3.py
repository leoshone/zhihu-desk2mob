"""生成三联对比图：无脚本 / v3 / v4，输出到 /workspace/zhihu-mobile/测试截图/"""
from lib import *
from PIL import Image, ImageDraw
import os

V4 = "/workspace/zhihu-mobile/zhihu-desk2mob.user.js"
V3 = "/root/uploads/1788273074515509197-zhihu-desk2mob.user.js"
OUT = "/workspace/zhihu-mobile/测试截图"
os.makedirs(OUT, exist_ok=True)

SCENES = [
    ("question", "https://www.zhihu.com/question/19550225",
     [("no_script", None), ("v3", V3), ("v4", V4)], DESKTOP_MODE, "DESKTOP", 1500),
    ("explore", "https://www.zhihu.com/explore",
     [("no_script", None), ("v3", V3), ("v4", V4)], DESKTOP_MODE, "DESKTOP", 1500),
    ("mobile-explore", "https://www.zhihu.com/explore",
     [("no_script", None), ("v4", V4)], MOBILE_MODE, "MOBILE", 852),
]

BAR = 46  # 顶部标签条高度

def make(src, dst, w, cap_h):
    im = Image.open(src).convert("RGB")
    r = w / im.width
    h = min(int(im.height * r), cap_h)
    return im.resize((w, int(im.height * r)), Image.LANCZOS).crop((0, 0, w, h))

def stitch(imgs, labels, dst):
    w = sum(i.width for i in imgs) + 8 * (len(imgs) - 1)
    h = max(i.height for i in imgs) + BAR
    canvas = Image.new("RGB", (w, h), (24, 24, 27))
    d = ImageDraw.Draw(canvas)
    x = 0
    for im, lb in zip(imgs, labels):
        color = {"no_script": (200, 70, 70), "v3": (200, 140, 50), "v4": (60, 160, 100)}[lb]
        d.rectangle([x, 0, x + im.width, BAR - 4], fill=color)
        d.text((x + 10, 16), lb.upper(), fill=(255, 255, 255))
        canvas.paste(im, (x, BAR))
        x += im.width + 8
    canvas.save(dst, quality=88)
    print("saved", dst, canvas.size)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
    for name, url, cases, kw, mode, cap in SCENES:
        imgs, lbs = [], []
        for label, script in cases:
            ctx = b.new_context(locale="zh-CN", **kw)
            if script:
                ctx.add_init_script(path=script)
            pg = ctx.new_page()
            try:
                pg.goto(url, wait_until="domcontentloaded", timeout=45000)
            except Exception as e:
                print("goto warn", str(e)[:50])
            pg.wait_for_timeout(5000)
            for y in (700, 1400, 2200):
                pg.mouse.wheel(0, y); pg.wait_for_timeout(350)
            pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(700)
            tmp = f"/tmp/shot_{mode}_{name}_{label}.png"
            pg.screenshot(path=tmp)
            imgs.append(make(tmp, tmp, 393 if mode == "MOBILE" else 393, cap))
            lbs.append(label)
            ctx.close()
        stitch(imgs, lbs, f"{OUT}/{mode.lower()}-{name}.png")
    b.close()
print("done")
