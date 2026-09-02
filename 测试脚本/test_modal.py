"""验证弹层返回关闭，以及最关键的负向用例：没有弹层时返回键必须照常后退

用例：
  1. 有弹层 → 按返回 → 弹层关掉，页面不跳转
  2. 无弹层 → 按返回 → 页面正常后退（脚本不许劫持返回键）
  3. 在「侧栏已被去掉」的页面上弹层功能依然正常（两个新功能互不干扰）
"""
from lib import *
from playwright.sync_api import sync_playwright
import os, sys
from urllib.parse import unquote   # pg.url 里的中文路径是 %E6%… 编码过的，比较前得还原

HERE = os.path.dirname(os.path.abspath(__file__))
SHOT = os.path.join(os.path.dirname(HERE), "测试截图")
V4 = "/workspace/zhihu-mobile/zhihu-desk2mob.user.js"

URL_MODAL = "file://" + os.path.join(HERE, "testpage_modal.html")
URL_RAIL  = "file://" + os.path.join(HERE, "testpage_rail.html")

HAS_MODAL = "() => !!document.getElementById('testModal')"
HAS_ZFBTN = "() => !!document.getElementById('zf-modal-close')"

fails = []

def mk(p, script):
    ctx = p.new_context(**DESKTOP_MODE)
    if script:
        ctx.add_init_script(path=script)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:130]))
    return ctx, pg, errs

def go_back(pg):
    try:
        pg.go_back(wait_until="load", timeout=15000)
    except Exception as e:
        print("  go_back:", str(e)[:60])

# ── 用例 1：有弹层，按返回应该只关弹层 ──────────────────────────
def case_modal(p, label, script, url, shot_name):
    ctx, pg, errs = mk(p, script)
    base = unquote(url.split('#')[0])
    pg.goto(url, wait_until="load", timeout=30000)
    pg.wait_for_timeout(2500)
    # 先造一条历史，让「返回」有地方可退（否则返回会直接离开页面，测不出区别）
    pg.evaluate("history.pushState({t:1}, '', location.href + '#dummy')")
    pg.wait_for_timeout(300)

    print(f"\n===== {label} =====")
    pg.click("#openBtn")
    pg.wait_for_timeout(1000)
    opened = pg.evaluate(HAS_MODAL)
    zfbtn = pg.evaluate(HAS_ZFBTN)
    print(f"  已打开 弹层: {opened}   脚本关闭按钮: {zfbtn}")
    if shot_name:
        pg.screenshot(path=os.path.join(SHOT, shot_name + "-弹层打开.png"))

    go_back(pg)
    pg.wait_for_timeout(1200)

    modal = pg.evaluate(HAS_MODAL)
    cur = unquote(pg.url)
    same = cur.startswith(base)
    hash_kept = cur.endswith("#dummy")
    print(f"  返回后 弹层: {modal}   仍在本页: {same}   hash 保住: {hash_kept}")
    if shot_name:
        pg.screenshot(path=os.path.join(SHOT, shot_name + "-返回后.png"))

    if script:
        ok = (not modal) and same
        print("  判定:", "✓ 返回键关掉弹层，页面没走" if ok else
              ("✗ 弹层没关掉" if modal else "✗ 页面被退出去了"))
        if not ok:
            fails.append(label)
    else:
        print("  判定（对照组，应当关不掉）:", "✓ 符合预期" if modal else "✗ 对照组反而不该关掉")
    if errs:
        print("  pageerror:", errs[:2])
    ctx.close()

# ── 用例 2：没有弹层，返回键必须照常后退 ─────────────────────────
def case_nomodal(p, label, script):
    ctx, pg, errs = mk(p, script)
    base = URL_MODAL
    pg.goto(base, wait_until="load", timeout=30000)
    pg.wait_for_timeout(2500)
    pg.evaluate("history.pushState({t:1}, '', location.href + '#dummy')")
    pg.wait_for_timeout(300)

    print(f"\n===== {label} =====")
    hashof = lambda u: ("#" + u.split('#')[1]) if '#' in u else "(无)"
    print("  返回前 URL hash:", hashof(pg.url))
    go_back(pg)
    pg.wait_for_timeout(1000)
    back = not pg.url.endswith("#dummy")
    print("  返回后 URL hash:", hashof(pg.url))
    print("  判定:", "✓ 返回键正常后退，脚本没有劫持" if back else "✗ 返回键被脚本吞了")
    if script and not back:
        fails.append(label)
    if errs:
        print("  pageerror:", errs[:2])
    ctx.close()

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    case_modal(b, "用例1a 弹层·无脚本（对照组）", None, URL_MODAL, None)
    case_modal(b, "用例1b 弹层·装脚本", V4, URL_MODAL, "弹层")
    case_modal(b, "用例3  侧栏页上开弹层·装脚本", V4, URL_RAIL, "弹层+侧栏")
    case_nomodal(b, "用例2a 无弹层返回·无脚本", None)
    case_nomodal(b, "用例2b 无弹层返回·装脚本", V4)
    b.close()

print("\n" + "=" * 46)
print("结论：" + ("全部通过" if not fails else "未通过 → " + "、".join(fails)))
sys.exit(1 if fails else 0)
