"""真机取证：登录一次，之后由脚本自己点开评论、dump 弹层的真实 DOM 与几何。

用法：
    python 测试脚本/capture_real_comment.py [目标URL]

流程：
  1. 持久化 profile（.zhihu-profile，已在 .gitignore 里），首次运行没有登录态
     → 用正常尺寸的窗口打开知乎，等人工登录（最多 4 分钟，自动轮询 cookie）
  2. 登录完成后才注入适配脚本（登录页不注入，免得 393px 宽度下二维码不好扫）
  3. 用 CDP 把视口切换成 Kiwi 桌面模式（980×2130 + screen 393×852）
  4. 自己点开评论（候选逐个试，直到出现覆盖 ≥50% 的浮层）
  5. dump：浮层结构 + 几何坐标 + 关闭按钮位置 + console/网络日志 + 截图
     → 写入 测试脚本/real_capture.json

只有第 1 步的登录需要人；其余全自动，且登录态存 profile，以后跑不用再登。
"""
from lib import UA_DESKTOP
from playwright.sync_api import sync_playwright
import json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROFILE = os.path.join(ROOT, ".zhihu-profile")
SHOT = os.path.join(ROOT, "测试截图")
SCRIPT = os.path.join(ROOT, "zhihu-desk2mob.user.js")
OUT = os.path.join(HERE, "real_capture.json")

TARGET = sys.argv[1] if len(sys.argv) > 1 else "https://zhuanlan.zhihu.com/p/2074785936261505339"
LOGIN_WAIT = 240          # 等人登录的秒数
INJECT = os.environ.get("NO_INJECT", "0") != "1"

# 浮层取证：位置 / 尺寸 / z-index / 文本 / 子元素
DUMP_LAYERS = r"""
() => {
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    let cs; try { cs = getComputedStyle(el); } catch (e) { continue; }
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.3 || r.height < vh * 0.15) continue;
    let depth = 0, p = el; while (p && p !== document.body) { depth++; p = p.parentElement; }
    let txt = ''; try { txt = (el.innerText || '').trim().slice(0, 60).replace(/\n/g, ' '); } catch (e) {}
    out.push({
      tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
      id: el.id || '', pos: cs.position, z: cs.zIndex, depth,
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      transform: cs.transform === 'none' ? '' : cs.transform,
      bg: cs.backgroundColor, overflowY: cs.overflowY,
      kids: el.children.length, txt
    });
  }
  return {vw, vh, zoom, layers: out};
}
"""

# 弹层里所有能点的东西，重点看右上角那一带（关闭按钮的老巢）
DUMP_BUTTONS = r"""
(sel) => {
  const root = document.querySelector(sel);
  if (!root) return [];
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const out = [];
  for (const el of root.querySelectorAll('button,a,svg,[role="button"],[class*="close"],[class*="Close"]')) {
    let cs; try { cs = getComputedStyle(el); } catch (e) { continue; }
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    out.push({
      tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
      aria: el.getAttribute('aria-label') || '', text: (el.innerText || '').trim().slice(0, 12),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      inViewport: r.top >= 0 && r.bottom <= vh && r.left >= 0 && r.right <= vw,
      topRightZone: r.left > vw * 0.6 && r.top < vh * 0.15
    });
  }
  return out;
}
"""

# 页面上所有可能是「评论入口」的可点元素
CANDIDATES = r"""
() => {
  const out = [];
  for (const el of document.querySelectorAll('button,a,div[role="button"],span[role="button"],svg')) {
    let t = ''; try { t = (el.innerText || '').trim(); } catch (e) {}
    const aria = el.getAttribute('aria-label') || '';
    const cls = (typeof el.className === 'string' ? el.className : '');
    const href = el.getAttribute('href') || '';
    if (!/评论|回复|条评论/.test(t + aria) && !/comment/i.test(cls + href + aria)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    out.push({
      tag: el.tagName, cls: cls.slice(0, 60), href: href.slice(0, 40),
      text: t.slice(0, 20), aria: aria.slice(0, 20),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
    });
  }
  return out;
}
"""

STATE = r"""
() => {
  const de = document.documentElement;
  return {
    url: location.href, title: document.title,
    zoom: getComputedStyle(de).zoom,
    vw: de.clientWidth, vh: de.clientHeight,
    textLen: (document.body ? document.body.innerText : '').length,
    blocked: /存在异常|40362/.test(document.body ? document.body.innerText.slice(0, 300) : ''),
    bodyOverflow: getComputedStyle(document.body).overflow,
    htmlOverflow: getComputedStyle(de).overflow
  };
}
"""


def is_logged_in(page):
    """以页面元素为准：顶栏有「登录/注册」= 未登录；有头像/创作者入口 = 已登录。
    cookie 不可靠 —— d_c0 是设备指纹，匿名也有，上一版就栽在这。"""
    return page.evaluate(r"""
() => {
  const loginBtn = document.querySelector('.AppHeader-loginBtn, a[href*="signin"], button[class*="loginBtn"]');
  if (loginBtn && loginBtn.getBoundingClientRect().width > 0) return false;
  const avatar = document.querySelector('.AppHeader-avatar, [class*="AppHeader-profile"], a[href^="/creator"], img[class*="Avatar"][src*="zhimg"]');
  return !!avatar;
}
""")


def ensure_viewport(cdp, page, log):
    """Kiwi 桌面模式视口会被莫名重置（实测点开登录层后从 980×2130 漂回 1085×780，
    zoom 从 2.49 变 2.76），每次关键动作后都重新压一遍并校验。"""
    cdp.send("Emulation.setDeviceMetricsOverride", {
        "width": 980, "height": 2130, "deviceScaleFactor": 2.625, "mobile": False,
        "screenWidth": 393, "screenHeight": 852,
        "screenOrientation": {"type": "portraitPrimary", "angle": 0}})
    page.wait_for_timeout(400)
    ok = page.evaluate("() => Math.abs(getComputedStyle(document.documentElement).zoom - 2.4936) < 0.05")
    if not ok:
        log.append("视口校验失败：zoom 不是 2.4936")
    return ok


def wait_login(page, log):
    for i in range(LOGIN_WAIT // 5):
        if is_logged_in(page):
            print("  检测到已登录 ✓")
            return True
        if i % 6 == 0:
            print(f"  等待登录… {i*5}s（请在弹出的窗口里登录知乎，登录完不用管）")
        time.sleep(5)
    log.append("等待登录超时")
    return False


# 关闭按钮 → 弹层 的完整祖先链：每层的位置/尺寸/transform/scrollTop
# 用来定位「到底是哪一层把关闭按钮顶出视口的」
CHAIN = r"""
(cls) => {
  const roots = [...document.querySelectorAll('div')]
      .filter(el => (typeof el.className === 'string') && el.className.includes(cls));
  const root = roots[0];
  if (!root) return null;
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const cands = [...root.querySelectorAll('button,svg,[aria-label]')].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && r.width < 220 && r.height < 220;
  });
  const out = [];
  for (const b of cands.slice(0, 10)) {
    const br = b.getBoundingClientRect();
    const chain = [];
    let p = b, guard = 0;
    while (p && p !== document.body && guard++ < 8) {
      const cs = getComputedStyle(p), r = p.getBoundingClientRect();
      chain.push({
        tag: p.tagName, cls: (typeof p.className === 'string' ? p.className : '').slice(0, 46),
        pos: cs.position, z: cs.zIndex, transform: cs.transform === 'none' ? '' : cs.transform,
        overflowY: cs.overflowY, scrollTop: p.scrollTop,
        top: Math.round(r.top), left: Math.round(r.left),
        w: Math.round(r.width), h: Math.round(r.height)
      });
      p = p.parentElement;
    }
    out.push({
      btn: {tag: b.tagName, cls: (typeof b.className === 'string' ? b.className : '').slice(0, 40),
            aria: b.getAttribute('aria-label') || '',
            rect: [Math.round(br.left), Math.round(br.top), Math.round(br.width), Math.round(br.height)]},
      outOfView: br.top < 0 || br.bottom > vh || br.left < 0 || br.right > vw,
      chain
    });
  }
  return {vw, vh, items: out};
}
"""


def pick_layer(layers, vw, vh):
    """挑真正的弹层本体：面积够大、有内容、层级最高"""
    best = None
    for L in layers:
        x, y, w, h = L["rect"]
        if w < vw * 0.5 or h < vh * 0.3:
            continue
        z = int(L["z"]) if str(L["z"]).lstrip("-").isdigit() else 0
        score = (1 if L["txt"] else 0) * 100 + min(L["kids"], 15) + z
        if best is None or score > best[0]:
            best = (score, L)
    return best[1] if best else None


def main():
    os.makedirs(SHOT, exist_ok=True)
    logs, net = [], []
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=PROFILE,
            headless=False,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            viewport={"width": 1100, "height": 780},       # 登录阶段用正常窗口
            user_agent=UA_DESKTOP, has_touch=True,
            ignore_https_errors=True,
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.on("console", lambda m: logs.append(f"[{m.type}] {m.text[:160]}"))
        page.on("pageerror", lambda e: logs.append(f"[pageerror] {str(e)[:160]}"))
        page.on("requestfailed", lambda r: net.append(f"[failed] {r.url[:110]} {r.failure}"))

        print("=== 1. 检查登录态 ===")
        page.goto("https://www.zhihu.com/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        if not is_logged_in(page):
            print("  未登录 → 请在弹出的浏览器窗口里登录（扫码/短信都可以）")
            if not wait_login(page, logs):
                print("  登录超时，下次再跑（登录态会保存在 profile 里）")
                ctx.close(); return 2
        print("  已登录 ✓")

        print("\n=== 2. 切换成 Kiwi 桌面模式视口 + 注入适配脚本 ===")
        if INJECT and os.path.exists(SCRIPT):
            page.add_init_script(path=SCRIPT)
            print("  已注入 zhihu-desk2mob.user.js（后续导航生效）")
        cdp = ctx.new_cdp_session(page)
        ensure_viewport(cdp, page, logs)
        print("  视口 980×2130 / screen 393×852 / zoom 2.4936")

        print(f"\n=== 3. 打开目标页 {TARGET} ===")
        page.goto(TARGET, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(5000)
        ensure_viewport(cdp, page, logs)
        page.wait_for_timeout(1000)
        st = page.evaluate(STATE)
        print("  ", {k: st[k] for k in ("title", "zoom", "vw", "textLen", "blocked")})
        if st["blocked"]:
            print("  ✗ 撞上 40362 风控（页面级硬拦截），本次到此为止")
            page.screenshot(path=os.path.join(SHOT, "真机-被风控.png"))
            ctx.close(); return 3
        page.screenshot(path=os.path.join(SHOT, "真机-正文页.png"))

        # 页面上若浮着登录层：优先点脚本自己的兜底按钮（它就是干这个的，
        # 而且只认真正的弹层）。别再用「右上角区域」几何判据去点 ——
        # 顶栏链接也落在右上角，上一轮就是这么把页面点导航走的。
        lay = page.evaluate(DUMP_LAYERS)
        url_before = page.url
        if lay["layers"]:
            print(f"  发现 {len(lay['layers'])} 个浮层，尝试关掉（可能是登录层）")
            zf = page.query_selector("#zf-modal-close")
            if zf:
                print("  点脚本兜底关闭按钮 #zf-modal-close")
                zf.click()
            else:
                print("  没有兜底按钮 → 发 ESC")
                try:
                    page.keyboard.press("Escape")
                except Exception as e:
                    print("  ESC 失败", str(e)[:60])
            page.wait_for_timeout(1800)
            if page.url != url_before:      # 防误点导航
                print("  ⚠ 页面被点走了，退回来：", page.url[:80])
                page.go_back(wait_until="load", timeout=15000)
                page.wait_for_timeout(1500)
            ensure_viewport(cdp, page, logs)

        print("\n=== 4. 找评论入口并点开 ===")
        cands = page.evaluate(CANDIDATES)
        print(f"  候选 {len(cands)} 个：")
        for c in cands[:12]:
            print("   ", {k: c[k] for k in ("tag", "text", "aria", "cls", "rect")})

        opened = None
        for c in cands[:8]:
            x, y, w, h = c["rect"]
            if y < 0 or y > 2130:      # 视口外的先跳过
                continue
            try:
                page.mouse.click(x + w / 2, min(y + h / 2, 2100))
            except Exception as e:
                print("  点击失败", str(e)[:60]); continue
            page.wait_for_timeout(2000)
            ensure_viewport(cdp, page, logs)
            lay = page.evaluate(DUMP_LAYERS)

            # 弹的是登录框 → 等人登录，登录后重新点这个按钮
            signin = page.evaluate(
                "() => !!document.querySelector('.SignFlow, .SignFlowHomepage, [class*=\"SignFlow\"]')")
            if signin:
                print("  弹的是登录层 → 请在窗口里完成登录，我等着…")
                if wait_login(page, logs):
                    page.wait_for_timeout(1500)
                    ensure_viewport(cdp, page, logs)
                    try:
                        page.mouse.click(x + w / 2, min(y + h / 2, 2100))
                        page.wait_for_timeout(2500)
                        ensure_viewport(cdp, page, logs)
                    except Exception as e:
                        print("  重新点击失败", str(e)[:60])
                lay = page.evaluate(DUMP_LAYERS)

            real = [L for L in lay["layers"]
                    if L["rect"][2] >= lay["vw"] * 0.5 and L["rect"][3] >= lay["vh"] * 0.3
                    and "SignFlow" not in L["cls"]]
            if real:
                opened = {"clicked": c, "layers": lay}
                print("  ✓ 弹层出现：", {k: c[k] for k in ("text", "aria", "cls")})
                break
            print("  点过没反应：", c["text"][:12] or c["cls"][:20])

        if not opened:
            print("  ✗ 没点到弹层（评论入口可能要滚动到评论区）")
            page.screenshot(path=os.path.join(SHOT, "真机-未打开弹层.png"))
            ctx.close(); return 4

        print("\n=== 5. dump 弹层真实结构（校正视口后重采）===")
        ensure_viewport(cdp, page, logs)
        page.wait_for_timeout(1500)          # 给脚本响应 resize、重算 zoom 的时间
        lay = page.evaluate(DUMP_LAYERS)
        print(f"  视口 {lay['vw']}×{lay['vh']}  zoom={lay['zoom']}")
        for L in lay["layers"]:
            print(f"    <{L['tag']}.{L['cls'][:34]}> pos={L['pos']} z={L['z']} d={L['depth']} "
                  f"rect={L['rect']} kids={L['kids']} txt={L['txt'][:26]!r}")
        page.screenshot(path=os.path.join(SHOT, "真机-评论弹层.png"))

        top = pick_layer(lay["layers"], lay["vw"], lay["vh"])
        btns = page.evaluate(DUMP_BUTTONS, "body")   # 全文档搜，关闭按钮可能挂在弹层兄弟节点上

        # 关闭按钮的祖先链：真机上「弹层本体不越界、内部容器越界」就是靠它发现的
        chains = None
        if top:
            mark = (top["cls"].split(" ") or [""])[0] or top["tag"]
            chains = page.evaluate(CHAIN, mark)
            if chains:
                print("\n  关闭按钮 → 弹层 的祖先链：")
                for it in chains["items"]:
                    if not it["outOfView"] and "关闭" not in it["btn"]["aria"]:
                        continue
                    print(f"    按钮 <{it['btn']['tag']}.{it['btn']['cls'][:24]}> "
                          f"aria={it['btn']['aria'][:8]!r} rect={it['btn']['rect']} 越界={it['outOfView']}")
                    for c in it["chain"]:
                        print(f"       ↳ <{c['tag']}.{c['cls'][:28]}> pos={c['pos']} z={c['z']} "
                              f"top={c['top']} left={c['left']} {c['w']}×{c['h']} "
                              f"transform={c['transform'][:22]!r} overflowY={c['overflowY']} scrollTop={c['scrollTop']}")
                break_flag = True

        print("\n  弹层内可点元素（越界的优先）：")
        for b in sorted(btns, key=lambda x: (x["inViewport"], -x["rect"][1]))[:14]:
            print(f"    <{b['tag']}.{b['cls'][:26]}> rect={b['rect']} "
                  f"inViewport={b['inViewport']} 右上角区={b['topRightZone']} "
                  f"text={b['text'][:8]!r} aria={b['aria'][:10]!r}")

        result = {
            "target": TARGET, "when": time.strftime("%Y-%m-%d %H:%M:%S"),
            "viewport": {"vw": lay["vw"], "vh": lay["vh"], "zoom": lay["zoom"]},
            "clicked": opened["clicked"], "layers": lay["layers"],
            "buttons": btns, "chains": chains, "console": logs[-40:], "netFailed": net[-20:],
            "stateAfterOpen": page.evaluate(STATE),
        }
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=1)
        print(f"\n  已写入 {OUT}")

        print("\n=== 6. 按返回键看能不能关掉（脚本 v0.7.0 的活）===")
        before = page.evaluate(STATE)
        try:
            page.go_back(wait_until="load", timeout=15000)
        except Exception as e:
            print("  go_back:", str(e)[:60])
        page.wait_for_timeout(2000)
        after = page.evaluate(STATE)
        lay2 = page.evaluate(DUMP_LAYERS)
        still = [L for L in lay2["layers"]
                 if L["rect"][2] >= lay2["vw"] * 0.5 and L["rect"][3] >= lay2["vh"] * 0.3]
        print(f"  返回后 浮层数={len(still)}  URL 相同={after['url'] == before['url']}  文本量={after['textLen']}")
        page.screenshot(path=os.path.join(SHOT, "真机-返回后.png"))
        result["afterBack"] = {"stillOpen": len(still), "sameUrl": after["url"] == before["url"],
                               "textLen": after["textLen"], "state": after}
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=1)

        print("\n窗口先留着 30 秒，需要看的话可以看；不想等就关掉。")
        try:
            page.wait_for_timeout(30000)
        except Exception:
            pass
        ctx.close()
        return 0


if __name__ == "__main__":
    sys.exit(main())
