"""验证假设：弹层打开后，在弹层内滑到底继续滑 → 触发背景滚动(scroll chaining)
→ 滚动监听又压一条缓冲 → 用户要多按一次返回才能退出。

这正是「前两次无反应、第三次整页退回」的另一种成因：
  缓冲#1 = 点评论入口（click 拦截）
  缓冲#2 = 弹层内滚动带动背景滚动（滚动压缓冲）
  第3次 = 消费真实历史 → 整页退回

用【登录态】真实专栏页验证（复用 .zhihu-profile/）。
"""
from playwright.sync_api import sync_playwright
import os, sys, json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROFILE = os.path.join(ROOT, ".zhihu-profile")
OUT = os.path.join(ROOT, "测试截图", "登录态")
V4 = os.path.join(ROOT, "zhihu-desk2mob.user.js")
TARGET = "https://zhuanlan.zhihu.com/p/2074785936261505339"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

with sync_playwright() as p:
    os.makedirs(OUT, exist_ok=True)
    ctx = p.chromium.launch_persistent_context(
        PROFILE, headless=False,
        args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
        viewport={"width": 980, "height": 2130},
        screen={"width": 393, "height": 852},
        device_scale_factor=2.625, has_touch=True,
        user_agent=UA, locale="zh-CN",
    )
    ctx.add_init_script(path=V4)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    logs = []
    pg.on("console", lambda m: logs.append(m.text))

    pg.goto(TARGET, wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(6000)

    snap = lambda: pg.evaluate("""() => ({
        y: Math.round(window.scrollY||0),
        st: history.state,
        len: history.length,
        modal: !!(function(){
            const vw=document.documentElement.clientWidth, vh=document.documentElement.clientHeight;
            const all=document.body.querySelectorAll('*');
            for(let i=0;i<all.length;i++){const el=all[i];
              if(el.id==='zhihu-mobile-badge'||el.id==='zf-modal-close')continue;
              let cs;try{cs=getComputedStyle(el);}catch(e){continue;}
              if(cs.position!=='fixed'&&cs.position!=='absolute')continue;
              if(cs.display==='none'||cs.visibility==='hidden')continue;
              const r=el.getBoundingClientRect();
              if(r.width>=vw*0.55&&r.height>=vh*0.35)return true;}
            return false;})()
    })""")

    print("T0 打开专栏页:", json.dumps(snap()))

    # 点开评论弹层
    pg.evaluate("""() => {
        const btns = document.querySelectorAll('button, [role="button"]');
        for (const b of btns) {
            const t = (b.textContent || '').trim();
            if (t.indexOf('评论') >= 0 && t.length <= 20) { b.click(); return; }
        }
    }""")
    pg.wait_for_timeout(3000)
    print("T1 弹层打开:", json.dumps(snap()))

    # ★ 关键实验：在弹层内滚动（模拟用户滑评论列表）
    print()
    print("在弹层内滚动（模拟用户滑评论列表到底再继续滑）…")
    for i in range(10):
        pg.mouse.move(490, 1000)
        pg.mouse.wheel(0, 1500)
        pg.wait_for_timeout(300)
        s = snap()
        print("   滑%d: y=%s 栈顶=%s len=%s" % (i, s["y"], json.dumps(s["st"]), s["len"]))
        if s["st"] and s["st"].get("zfModal") and i == 0:
            pass
        # 关注：背景 scrollY 是否被带动
        if s["y"] > 100:
            print("      ⚠ 背景被带动滚动了！y=%s" % s["y"])

    s2 = snap()
    print()
    print("T2 弹层内滚动后:", json.dumps(s2))

    # 连续返回，数几次才退出
    print()
    print("连续返回，统计几次能退出：")
    prev = pg.evaluate("() => location.href")
    for n in (1, 2, 3, 4):
        try:
            pg.go_back(wait_until="commit", timeout=8000)
        except Exception as e:
            print("   back%d 异常:" % n, str(e)[:50])
        pg.wait_for_timeout(2000)
        cur = pg.evaluate("() => location.href")
        changed = cur != prev
        print("   第%d次返回: url变化=%s  url=%s" % (n, changed, cur[:60]))
        if changed:
            print("   ⇒ 共按 %d 次退出" % n)
            break
        prev = cur

    print()
    print("== 脚本日志 ==")
    for l in logs:
        if "弹层" in l:
            print("  ", l[:130])
    ctx.close()
