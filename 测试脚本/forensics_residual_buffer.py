"""取证：登录弹层关闭后，栈顶为什么会残留一条 zfModal 缓冲？

页面加载顺序：
  1. 登录弹层出现 → onModalOpen → ensureBuffer 压缓冲
  2. 用户点 ✕ 关掉登录弹层 → 期望 onModalGone 把缓冲 silent back 退掉
  3. 实测：state 仍是 {zfModal:1} —— onModalGone 没生效，或者 back 没退掉

逐帧记录 checkModal 的 lastHad 变化与 history.state。
"""
from lib import *
from playwright.sync_api import sync_playwright
import json

V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
TARGET = "https://zhuanlan.zhihu.com/p/2074785936261505339"
DESKTOP = dict(DESKTOP_MODE)
DESKTOP["user_agent"] = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
    ctx = b.new_context(**DESKTOP)
    ctx.set_extra_http_headers({
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
    })
    ctx.add_init_script(path=V4)
    pg = ctx.new_page()
    logs = []
    pg.on("console", lambda m: logs.append(m.text))
    pg.goto("https://www.zhihu.com/explore", wait_until="domcontentloaded", timeout=30000)
    pg.wait_for_timeout(2000)
    pg.evaluate("(u) => { location.href = u; }", TARGET)
    pg.wait_for_load_state("domcontentloaded", timeout=30000)
    pg.wait_for_timeout(5000)

    probe = """() => {
        const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
        // 复刻 findOpenModal（checkModal 用的严格判据）
        let strictHit = null;
        const all = document.body.querySelectorAll('*');
        for (let i = 0; i < all.length; i++) {
            const el = all[i];
            if (el.id === 'zhihu-mobile-badge' || el.id === 'zf-modal-close') continue;
            if (el.hasAttribute('data-zhidden')) continue;
            let cs; try { cs = getComputedStyle(el); } catch(e) { continue; }
            if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            if (parseFloat(cs.opacity) < 0.15) continue;
            const r = el.getBoundingClientRect();
            if (r.width >= vw*0.55 && r.height >= vh*0.35) {
                const t = (el.innerText || '').trim();
                if (!strictHit || t.length > strictHit.txt) {
                    strictHit = {cls: (typeof el.className === 'string' ? el.className : '').slice(0,40), txt: t.length};
                }
            }
        }
        return {state: history.state, len: history.length, modal: strictHit};
    }"""

    print("T0 页面加载(登录弹层开着):")
    print("   ", json.dumps(pg.evaluate(probe), ensure_ascii=False))

    # 关掉登录弹层
    pg.evaluate("""() => {
        const xs = document.querySelectorAll('.Modal-closeButton, button[aria-label="关闭"]');
        for (const x of xs) { try { x.click(); } catch(e){} }
    }""")
    for w in (500, 1000, 2000, 3500):
        pg.wait_for_timeout(w if w == 500 else w - prev if False else 500)
        r = pg.evaluate(probe)
        print("   关闭后 +%dms:" % w, json.dumps(r, ensure_ascii=False))
    pg.wait_for_timeout(3000)
    r = pg.evaluate(probe)
    print("T2 稳定后:", json.dumps(r, ensure_ascii=False))
    residual = bool(r["state"] and r["state"].get("zfModal"))
    print()
    print("⇒ 登录弹层关掉后仍残留缓冲:", residual)

    print()
    print("== 脚本日志 ==")
    for l in logs:
        if "弹层" in l:
            print("  ", l[:120])
    b.close()
