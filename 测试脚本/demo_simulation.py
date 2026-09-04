"""演示：电脑上如何模拟 Kiwi「桌面版网站」测试返回键关评论。

四幕：
  第1幕  无脚本访问专栏复刻页 → 记录「坏状态」（返回退回首页、溢出等）
  第2幕  同一页面注入 v0.7.7 → 点评论 → 压缓冲 → 返回留本页
  第3幕  ★ 盲区演示：把滚动改成「内部容器滚动」（复刻真实专栏页疑点）→ v0.7.7 失效
         —— 这就是「模拟过了真机挂」的机制解释
  第4幕  真实 zhihu.com 问题页端到端（点评论→返回→留本页）
"""
from lib import *
from playwright.sync_api import sync_playwright
import os, sys

V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
SHOT = "D:/AiSpaces/Code/zhihu-desk2mob/测试截图"
URL = "http://127.0.0.1:8753/testpage_zhuanlan_inline.html"
os.makedirs(SHOT, exist_ok=True)

def st(pg):
    return pg.evaluate("""() => ({
        url: location.href,
        len: history.length,
        state: history.state,
        winScrollY: Math.round(window.scrollY || 0)
    })""")

def back(pg):
    try: pg.go_back(wait_until="commit", timeout=8000)
    except Exception as e: print("   go_back 异常:", str(e)[:60])
    pg.wait_for_timeout(1200)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    print("=" * 62)
    print("第0幕 模拟配置：Kiwi 桌面模式 = 980x2130 视口 + 393 屏幕 + 桌面UA + 触摸")
    print("=" * 62)
    ctx = b.new_context(**DESKTOP_MODE)
    ctx.add_init_script(path=V4)
    pg = ctx.new_page()
    pg.goto("http://127.0.0.1:8753/blank.html" if False else URL, wait_until="load")
    pg.wait_for_timeout(1000)
    env = pg.evaluate("""() => ({
        视口: window.innerWidth + 'x' + window.innerHeight,
        屏幕: screen.width + 'x' + screen.height,
        UA: navigator.userAgent.slice(0, 60),
        触摸: navigator.maxTouchPoints > 0
    })""")
    for k, v in env.items(): print("   %s: %s" % (k, v))
    pg.screenshot(path=SHOT + "/演示-0-模拟环境.png")

    # ─────────────────────────────────────────────────────────
    print()
    print("=" * 62)
    print("第1幕 无脚本对照：点评论入口 → 按返回 → 会被退回哪里")
    print("=" * 62)
    pg2 = b.new_context(**DESKTOP_MODE).new_page()   # 不注入脚本
    pg2.goto(URL, wait_until="load")
    pg2.wait_for_timeout(800)
    pg2.evaluate("document.getElementById('commentEntry').click()")
    pg2.wait_for_timeout(400)
    before = st(pg2)
    print("   点评论后: len=%s state=%s" % (before["len"], before["state"]))
    back(pg2)
    after = st(pg2)
    exited = after["url"] != before["url"]
    print("   按返回后: URL 变了吗 →", "退回上一页了" if exited else "没退")
    print("   ⇒ 无脚本时返回键 = 真后退（用户原始痛点）")
    pg2.screenshot(path=SHOT + "/演示-1-无脚本对照.png")
    pg2.close()

    # ─────────────────────────────────────────────────────────
    print()
    print("=" * 62)
    print("第2幕 注入 v0.7.7：点评论入口 → 压缓冲 → 返回留本页")
    print("=" * 62)
    pg.evaluate("document.getElementById('commentEntry').click()")
    pg.wait_for_timeout(600)
    s_open = st(pg)
    buf = bool(s_open["state"] and s_open["state"].get("zfModal"))
    print("   点评论后: len=%s state=%s → 缓冲压入=%s" % (s_open["len"], s_open["state"], buf))
    pg.screenshot(path=SHOT + "/演示-2a-压缓冲.png")
    back(pg)
    s_back = st(pg)
    stayed = s_back["url"] == s_open["url"]
    print("   按返回后: URL 没变=%s state=%s → 留在本页=%s" % (stayed, s_back["state"], stayed))
    pg.screenshot(path=SHOT + "/演示-2b-返回留本页.png")

    # ─────────────────────────────────────────────────────────
    print()
    print("=" * 62)
    print("第3幕 ★盲区演示：真实专栏页若是「内部容器滚动」→ v0.7.7 检测不到")
    print("=" * 62)
    # 造一个内部滚动容器：把整页内容塞进 overflow:auto 的 div，body 不滚
    pg.evaluate("""() => {
        const app = document.createElement('div');
        app.id = 'innerScroll';
        app.style.cssText = 'position:fixed;inset:0;overflow-y:auto;';
        while (document.body.firstChild) app.appendChild(document.body.firstChild);
        document.body.appendChild(app);
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
    }""")
    pg.wait_for_timeout(300)
    probe = pg.evaluate("""() => {
        const app = document.getElementById('innerScroll');
        app.scrollTop = 5000;   // 滚内部容器（模拟真实专栏页的滚动方式）
        return {winScrollY_after: Math.round(window.scrollY || 0),
                innerScrollTop: Math.round(app.scrollTop)};
    }""")
    pg.wait_for_timeout(800)
    s3 = st(pg)
    print("   内部容器滚到 %s 后：window.scrollY=%s（恒 0！）" % (probe["innerScrollTop"], s3["winScrollY"]))
    print("   state=%s → 我的滚动监听挂在 window 上，一次都没触发 → 没压缓冲" % s3["state"])
    print("   ⇒ 这就是『模拟过了、真机挂』的机制：模拟页用 window 滚动，真实页可能是内部容器")
    pg.screenshot(path=SHOT + "/演示-3-盲区内部滚动.png")

    b.close()

print()
print("=" * 62)
print("第4幕 真实 zhihu.com 端到端（问题页：点评论→返回→留本页）")
print("=" * 62)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# 直接复用已有真机测试
import subprocess
r = subprocess.run([sys.executable, "D:/AiSpaces/Code/zhihu-desk2mob/测试脚本/test_real_comment_back.py"],
                   capture_output=True, text=True, timeout=150)
tail = r.stdout.strip().splitlines()[-9:]
for l in tail: print("   " + l)
