"""真机取证：真实专栏页 zhuanlan.zhihu.com/p/2074785936261505339

目标（按顺序）：
  1) 突破风控拿到真实专栏页（多手段：关自动化特征 / explore 养 cookie / 补指纹头 / 慢节奏）
  2) 取证滚动结构：window.scrollY vs 内部滚动容器 —— 验证 v0.7.7 盲区怀疑
  3) 取证评论入口按钮的真实 DOM（tag/class/text/aria）
  4) 真实操作链路：往下滚到评论区 → 查缓冲是否压入 → go_back → 是否留本页
"""
from lib import *
from playwright.sync_api import sync_playwright
import sys, json

V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
TARGET = "https://zhuanlan.zhihu.com/p/2074785936261505339"

DESKTOP = dict(DESKTOP_MODE)
DESKTOP["user_agent"] = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

with sync_playwright() as p:
    b = p.chromium.launch(args=[
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
    ])
    ctx = b.new_context(**DESKTOP)
    # 补全桌面 Chrome 指纹头（风控看 sec-ch-ua / Accept-Language）
    ctx.set_extra_http_headers({
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
    })
    ctx.add_init_script(path=V4)
    pg = ctx.new_page()
    errs = []
    logs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:100]))
    pg.on("console", lambda m: logs.append(m.text))

    print(">> 1) 逛 /explore 养 cookie（4s，模拟真人先看看首页）")
    try:
        pg.goto("https://www.zhihu.com/explore", wait_until="domcontentloaded", timeout=30000)
        pg.wait_for_timeout(2000)
        # 模拟真人：鼠标动一下、滚一屏
        pg.mouse.move(400, 300); pg.mouse.wheel(0, 800)
        pg.wait_for_timeout(2000)
        print("   explore OK, badge:", pg.evaluate("() => (document.getElementById('zhihu-mobile-badge')||{}).textContent||null"))
    except Exception as e:
        print("   explore 异常:", str(e)[:80])

    print(">> 2) 站内跳转到目标专栏页（带 referer）")
    try:
        pg.evaluate("(u) => { location.href = u; }", TARGET)
        pg.wait_for_load_state("domcontentloaded", timeout=30000)
    except Exception as e:
        print("   跳转异常:", str(e)[:80])
    pg.wait_for_timeout(5000)   # 放慢，让页面完全稳定

    info = pg.evaluate("""() => ({
        url: location.href,
        title: (document.title||'').slice(0,40),
        bodyLen: document.body ? document.body.innerText.length : 0,
        badge: (document.getElementById('zhihu-mobile-badge')||{}).textContent||null
    })""")
    print("   URL:", info["url"])
    print("   标题:", info["title"], "| body 文本:", info["bodyLen"], "| badge:", info["badge"])
    if "unhuman" in info["url"] or "signin" in info["url"] or info["bodyLen"] < 300:
        print("!! 仍被风控拦截，取证失败")
        pg.screenshot(path="D:/AiSpaces/Code/zhihu-desk2mob/测试截图/真机专栏-被拦.png")
        b.close(); sys.exit(2)

    print(">> 3) ★滚动结构取证：谁在滚？")
    scroll_info = pg.evaluate("""() => {
        const de = document.documentElement, bd = document.body;
        const winY = window.scrollY || 0;
        const deScrollable = de.scrollHeight - de.clientHeight;
        // 找所有可滚动的内部容器
        const inner = [];
        const all = document.querySelectorAll('*');
        for (let i = 0; i < all.length; i++) {
            const el = all[i];
            const cs = getComputedStyle(el);
            if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
                const d = el.scrollHeight - el.clientHeight;
                if (d > 100) {
                    inner.push({
                        tag: el.tagName.toLowerCase(),
                        cls: (el.className||'').toString().slice(0,50),
                        id: el.id,
                        scrollableDist: Math.round(d),
                        scrollTop: Math.round(el.scrollTop)
                    });
                }
            }
        }
        return {
            windowScrollY: Math.round(winY),
            docScrollHeight: de.scrollHeight,
            docClientHeight: de.clientHeight,
            deScrollable: Math.round(deScrollable),
            innerScrollables: inner.slice(0, 6)
        };
    }""")
    print(json.dumps(scroll_info, ensure_ascii=False, indent=2))

    print(">> 4) ★评论入口 DOM 取证")
    cmt_btn = pg.evaluate("""() => {
        const els = Array.from(document.querySelectorAll('button,a,[role="button"],div,span'));
        const out = [];
        for (const el of els) {
            const t = (el.textContent||'').trim().replace(/\\s+/g,' ');
            const cls = (el.className||'').toString();
            const aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
            const r = el.getBoundingClientRect();
            if (r.width < 10 || r.height < 10) continue;
            const cmtish = (t.length<=20 && /评论/.test(t)) || /comment/i.test(cls) || /评论|comment/i.test(aria);
            if (!cmtish) continue;
            out.push({
                tag: el.tagName.toLowerCase(),
                cls: cls.slice(0,50),
                text: t.slice(0,30),
                aria: aria.slice(0,20),
                rect: Math.round(r.width)+'x'+Math.round(r.height)+'@y'+Math.round(r.top)
            });
            if (out.length >= 8) break;
        }
        return out;
    }""")
    for x in cmt_btn:
        print("   %s.%s text=%r aria=%r %s" % (x["tag"], x["cls"][:30], x["text"], x["aria"], x["rect"]))

    print(">> 5) 真实操作：往下滚到评论区（模拟用户滚动手势）")
    for _ in range(6):   # 分段滚动，模拟真人
        pg.mouse.wheel(0, 1200)
        pg.wait_for_timeout(400)
    pg.wait_for_timeout(1000)
    after_scroll = pg.evaluate("""() => ({
        winY: Math.round(window.scrollY||0),
        len: history.length,
        state: history.state
    })""")
    print("   滚动后: winY=%s len=%s state=%s" % (after_scroll["winY"], after_scroll["len"], after_scroll["state"]))
    buf = after_scroll["state"] and (after_scroll["state"].get("zfModal") or after_scroll["state"].get("zfStay"))
    print("   ⇒ 滚动后缓冲已压入:", bool(buf))
    pg.screenshot(path="D:/AiSpaces/Code/zhihu-desk2mob/测试截图/真机专栏-滚动后.png")

    print(">> 6) go_back（模拟系统返回键）")
    try:
        pg.go_back(wait_until="commit", timeout=8000)
    except Exception as e:
        print("   go_back 异常:", str(e)[:60])
    pg.wait_for_timeout(2000)
    after_back = pg.evaluate("""() => ({
        url: location.href,
        winY: Math.round(window.scrollY||0),
        state: history.state
    })""")
    same = after_back["url"] == info["url"] or after_back["url"].split('?')[0] == info["url"].split('?')[0]
    print("   返回后: url=%s" % after_back["url"])
    print("   仍在本页:", same, "| winY=%s state=%s" % (after_back["winY"], after_back["state"]))
    pg.screenshot(path="D:/AiSpaces/Code/zhihu-desk2mob/测试截图/真机专栏-返回后.png")

    print("\npageerror:", errs[:3])
    print("\n== 脚本 console 日志 ==")
    for l in logs:
        if '弹层' in l or 'ZFDBG' in l:
            print("   ", l[:140])

    b.close()
