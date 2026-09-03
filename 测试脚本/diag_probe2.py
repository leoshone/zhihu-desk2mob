from lib import *
from playwright.sync_api import sync_playwright
import os
SHOT = "D:/AiSpaces/Code/zhihu-desk2mob/测试截图/"

targets = [
    "https://zhuanlan.zhihu.com/p/2074785936261505339",
    "https://www.zhihu.com/explore",
    "https://www.zhihu.com/question/19550225/answer/123456789",
]
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for i, url in enumerate(targets):
        ctx = b.new_context(**DESKTOP_MODE)
        pg = ctx.new_page()
        try:
            pg.goto(url, wait_until="domcontentloaded", timeout=45000)
        except Exception as e:
            print(url, "goto 失败", str(e)[:80]); ctx.close(); continue
        pg.wait_for_timeout(6000)
        info = pg.evaluate("""() => ({
            url: location.href, title: document.title,
            textLen: (document.body?document.body.innerText:'').length,
            head: (document.body?document.body.innerText:'').slice(0,200),
            nodes: document.querySelectorAll('*').length
        })""")
        print("\n===", url, "===")
        print("->", info["url"])
        print("title:", info["title"], "| textLen:", info["textLen"], "| nodes:", info["nodes"])
        print("head:", info["head"].replace("\n", " ")[:200])
        pg.screenshot(path=SHOT + f"probe2_{i}.png", full_page=False)
        ctx.close()
    b.close()
