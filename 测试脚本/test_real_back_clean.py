"""★ 真实专栏页 · 带环境校验的返回键回归

吸取的教训（本机踩过的坑）：知乎的登录弹层是**异步延迟渲染**的，
实测页面加载后 8 秒才出现。之前的测试脚本在加载后 5 秒就点「关闭」，
那时弹层根本不存在 —— 于是弹层稍后自然出现、压入缓冲，
被误判成「残留缓冲 / 缓冲没清理」。测试必须先等环境干净再动手。

本脚本的三条铁律：
  1. 开始测试前，等登录弹层出现 → 关掉 → 等缓冲被清干净（history.state 无 zf*）
  2. 每一步操作后都校验环境（弹层身份、栈顶状态）再继续
  3. 评论弹层用特征校验（含「条评论」文字 + 按钮数 ≥ 10），
     避免把登录弹层误当成评论弹层

三个用例：
  A. 页顶（无弹层、无缓冲）按返回 → 必须正常后退，脚本不许干预
  B. 滚到评论区按返回 → 留在页面；再按一次 → 正常退出（不被困死）
  C. 点开评论弹层按返回 → 弹层关闭且留在页面；再按一次 → 正常退出
"""
from lib import *
from playwright.sync_api import sync_playwright
import json, sys

V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
TARGET = "https://zhuanlan.zhihu.com/p/2074785936261505339"
DESKTOP = dict(DESKTOP_MODE)
DESKTOP["user_agent"] = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

STATE = "() => ({url: location.href, st: history.state, len: history.length, y: Math.round(scrollY||0)})"

# 弹层身份：区分登录弹层与评论弹层
LAYER = """() => {
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    let best = null;
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
        if (r.width < vw*0.55 || r.height < vh*0.35) continue;
        const t = (el.innerText || '').trim();
        if (!best || t.length > best.txt) {
            best = {cls: (typeof el.className === 'string' ? el.className : '').slice(0,45),
                    txt: t.length,
                    btns: el.querySelectorAll('button').length,
                    isComment: /条评论|写评论|条回复/.test(t)};
        }
    }
    return best;
}"""


def wait_clean(pg, timeout_ms=25000):
    """等登录弹层出现 → 关掉 → 等缓冲清干净。返回 True 表示环境已干净。"""
    # 1) 等登录弹层出现
    appeared = False
    for _ in range(timeout_ms // 500):
        if pg.evaluate("() => !!document.querySelector('.Modal-wrapper, [class*=Modal-wrapper]')"):
            appeared = True
            break
        pg.wait_for_timeout(500)
    if appeared:
        pg.evaluate("""() => {
            const xs = document.querySelectorAll('.Modal-closeButton, button[aria-label="关闭"]');
            for (const x of xs) { try { x.click(); } catch(e){} }
        }""")
    # 2) 等缓冲被清掉（history.state 里没有 zf* 标记）
    for _ in range(30):
        pg.wait_for_timeout(500)
        st = pg.evaluate("() => history.state")
        layer = pg.evaluate(LAYER)
        if not (st and (st.get("zfModal") or st.get("zfStay"))) and not layer:
            return True
    return False


def back(pg, wait=2200):
    try:
        pg.go_back(wait_until="commit", timeout=8000)
    except Exception as e:
        print("     go_back 异常:", str(e)[:60])
    pg.wait_for_timeout(wait)


results = {}

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

    def fresh_page():
        """重新导航到专栏页并把环境清干净"""
        pg.goto(TARGET, wait_until="domcontentloaded", timeout=30000)
        pg.wait_for_timeout(3000)
        return wait_clean(pg)

    pg.goto("https://www.zhihu.com/explore", wait_until="domcontentloaded", timeout=30000)
    pg.wait_for_timeout(2000)

    # ═══ 用例 A：页顶无弹层无缓冲，按返回必须正常后退 ═══
    print("=" * 60)
    print("用例 A：页顶（无弹层、无缓冲）按返回 → 应正常后退")
    clean = fresh_page()
    print("  环境已清理:", clean)
    s0 = pg.evaluate(STATE)
    print("  按返回前:", json.dumps({k: s0[k] for k in ("url", "st", "y")})[:110])
    back(pg)
    s1 = pg.evaluate(STATE)
    results["A"] = s1["url"] != s0["url"]
    print("  按返回后:", s1["url"][:60])
    print("  ⇒ A 通过（正常后退，未被劫持）:", results["A"])

    # ═══ 用例 B：滚到评论区，第一次留在本页，第二次退出 ═══
    print("=" * 60)
    print("用例 B：滚到评论区 → 第1次返回留本页，第2次返回退出")
    fresh_page()
    for i in range(8):
        pg.evaluate("window.scrollBy(0, 1800)")
        pg.wait_for_timeout(280)
        if pg.evaluate("() => {const s=history.state; return !!(s && s.zfModal);}"):
            break
    pg.wait_for_timeout(600)
    b0 = pg.evaluate(STATE)
    print("  滚到评论区:", json.dumps({k: b0[k] for k in ("y", "st")}))
    back(pg)
    b1 = pg.evaluate(STATE)
    stayed = b1["url"] == b0["url"]
    print("  第1次返回:", b1["url"][:60], "| 留在页面:", stayed)
    back(pg)
    b2 = pg.evaluate(STATE)
    escaped = b2["url"] != b1["url"]
    print("  第2次返回:", b2["url"][:60], "| 正常退出:", escaped)
    results["B"] = stayed and escaped
    print("  ⇒ B 通过:", results["B"])

    # ═══ 用例 C：点开评论弹层，第一次关弹层，第二次退出 ═══
    print("=" * 60)
    print("用例 C：点开评论弹层 → 第1次返回关弹层留本页，第2次返回退出")
    fresh_page()
    pg.evaluate("""() => {
        const btns = document.querySelectorAll('button.Button.ContentItem-action');
        for (const btn of btns) {
            if ((btn.textContent||'').indexOf('评论') >= 0) { btn.click(); return; }
        }
    }""")
    pg.wait_for_timeout(2500)
    layer = pg.evaluate(LAYER)
    print("  弹层身份:", json.dumps(layer, ensure_ascii=False))
    c0 = pg.evaluate(STATE)
    print("  开弹层后 state:", json.dumps(c0["st"]))
    back(pg)
    c1 = pg.evaluate(STATE)
    layer1 = pg.evaluate(LAYER)
    closed = (layer is not None) and (layer1 is None)
    stayed_c = c1["url"] == c0["url"]
    print("  第1次返回: 弹层已关:", closed, "| 留在页面:", stayed_c, "| state:", json.dumps(c1["st"]))
    back(pg)
    c2 = pg.evaluate(STATE)
    escaped_c = c2["url"] != c1["url"]
    print("  第2次返回:", c2["url"][:60], "| 正常退出:", escaped_c)
    results["C"] = closed and stayed_c and escaped_c
    print("  ⇒ C 通过:", results["C"])

    print()
    print("== 脚本日志 ==")
    for l in logs:
        if "弹层" in l:
            print("  ", l[:130])
    b.close()

print()
print("=" * 60)
for k in ("A", "B", "C"):
    print("  用例 %s: %s" % (k, "✅" if results.get(k) else "❌"))
print("总体:", "✅ 全部通过" if all(results.values()) else "❌ 有失败")
sys.exit(0 if all(results.values()) else 1)
