"""登录态准备：打开一个持久化 profile 的浏览器窗口，人工登录知乎。

用法：
    python 测试脚本/login_setup.py

会弹出一个 Chromium 窗口并打开知乎登录页。
在窗口里完成登录（扫码 / 短信 / 密码均可），脚本每 2 秒检测一次登录态，
检测通过后会提示「登录成功」并自动关闭窗口。

cookie 落在 .zhihu-profile/（已在 .gitignore 中，绝不入库），
之后所有登录态测试复用同一个 profile，不用重复登录。
"""
from playwright.sync_api import sync_playwright
import os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROFILE = os.path.join(ROOT, ".zhihu-profile")
SHOT = os.path.join(ROOT, "测试截图")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

# 登录态判据：命中任意一条即认为已登录
CHECK = """() => {
    // ① 顶部有「个人主页」链接（登录后才有）
    try {
        const a = document.querySelector('a[href*="/people/"]');
        if (a) return 'people-link: ' + a.getAttribute('href');
    } catch (e) {}
    // ② 顶部头像/用户菜单容器
    try {
        const p = document.querySelector('.AppHeader-profile, .TopNavProfile, [class*="AppHeader-profile"]');
        if (p) return 'profile-box';
    } catch (e) {}
    // ③ 页面上有「退出」或「我的主页」文字
    try {
        const t = document.body.innerText || '';
        if (t.indexOf('我的主页') >= 0 || t.indexOf('退出') >= 0) return 'text-marker';
    } catch (e) {}
    // ④ 登录框还在 = 未登录
    try {
        if (document.querySelector('.SignFlow, .signin, [class*="SignFlow"]')) return null;
    } catch (e) {}
    return null;
}"""

with sync_playwright() as p:
    os.makedirs(PROFILE, exist_ok=True)
    os.makedirs(SHOT, exist_ok=True)
    print("=" * 62)
    print("  profile 目录:", PROFILE)
    print("  即将弹出浏览器窗口 → 请在窗口里登录知乎")
    print("  登录成功后脚本会自动检测并关闭，最多等 10 分钟")
    print("=" * 62)

    ctx = p.chromium.launch_persistent_context(
        PROFILE,
        headless=False,          # 有头：用户要能看到并操作
        args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
        viewport={"width": 1440, "height": 900},
        user_agent=UA,
        locale="zh-CN",
    )
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    pg.goto("https://www.zhihu.com/signin", wait_until="domcontentloaded", timeout=60000)
    print()
    print("已打开知乎登录页，请登录……")

    deadline = time.time() + 600   # 10 分钟
    ok = False
    while time.time() < deadline:
        pg.wait_for_timeout(2000)
        try:
            url = pg.url
        except Exception:
            break
        # 登录成功后知乎通常会跳回首页
        if "signin" not in url:
            hit = None
            try:
                hit = pg.evaluate(CHECK)
            except Exception:
                pass
            if hit:
                print()
                print("  ✅ 检测到登录态（%s），当前页面: %s" % (hit, url[:70]))
                ok = True
                break
        # 还在登录页也要检测（有时不跳转）
        else:
            try:
                hit = pg.evaluate(CHECK)
                if hit:
                    print()
                    print("  ✅ 检测到登录态（%s）" % hit)
                    ok = True
                    break
            except Exception:
                pass

    if ok:
        try:
            pg.screenshot(path=os.path.join(SHOT, "登录态-首页.png"))
            print("  已保存登录态截图: 测试截图/登录态-首页.png")
        except Exception as e:
            print("  截图失败:", str(e)[:80])
    else:
        print()
        print("  ⏱ 10 分钟内未检测到登录态。若已登录，可重跑本脚本做一次检测；")
        print("     若判据失效，把窗口里的页面截图发我，我改判据。")
        try:
            pg.screenshot(path=os.path.join(SHOT, "登录态-未检测到.png"))
        except Exception:
            pass

    print()
    print("3 秒后关闭浏览器（cookie 已写入 profile）……")
    pg.wait_for_timeout(3000)
    ctx.close()
    sys.exit(0 if ok else 1)
