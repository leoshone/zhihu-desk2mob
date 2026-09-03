"""真机式端到端：真实 zhihu.com 上验证「系统返回键关评论弹层」。

流程：先逛 /explore 拿 cookie+referer（绕过 40362），点进问题页，点「评论」，
等脚本的持久检测把评论层抓到并压入缓冲历史；再按返回。

断言（核心机制）：
  1) 点开评论后 history.state.zfModal 存在（或 history.length 比进文章前 +1）
     —— 即脚本成功压入了缓冲历史。
  2) 按返回后评论层关闭、且 URL 仍停在问题页（没有退回 /explore）。
"""
from lib import *
from playwright.sync_api import sync_playwright
import os, sys, json

V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"

DESKTOP = dict(DESKTOP_MODE)
DESKTOP["user_agent"] = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

def snap(pg, tag):
    try:
        return pg.evaluate("""() => ({
            url: location.href,
            len: history.length,
            state: history.state,
            badge: (document.getElementById('zhihu-mobile-badge')||{}).textContent || null
        })""")
    except Exception as e:
        return {"err": str(e)[:80], "tag": tag}

def comment_open(pg):
    """评论层是否还开着：找包含『条评论』且自身/祖先是 fixed/absolute 的层。"""
    return pg.evaluate("""() => {
        var all = Array.from(document.body.querySelectorAll('*'));
        for (var i=0;i<all.length;i++){
            var t = (all[i].innerText||'').trim();
            if (/\\d+\\s*条评论/.test(t)) {
                var e = all[i];
                for (var k=0;k<8 && e;k++){
                    var cs; try{cs=getComputedStyle(e);}catch(_){break;}
                    if ((cs.position==='fixed'||cs.position==='absolute')) {
                        return {found:true, cls:(e.className||'').toString().slice(0,30)};
                    }
                    e = e.parentNode;
                }
            }
        }
        return {found:false};
    }""")

def click_comment(pg):
    return pg.evaluate("""() => {
        var btns = Array.from(document.querySelectorAll('button,a,[role="button"]'));
        for (var i=0;i<btns.length;i++){
            var t=(btns[i].innerText||btns[i].textContent||'').trim();
            if(/评论/.test(t) && t.length<12){ btns[i].click(); return true; }
        }
        return false;
    }""")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
    ctx = b.new_context(**DESKTOP)
    ctx.add_init_script(path=V4)
    pg = ctx.new_page()
    errs = []
    logs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
    pg.on("console", lambda m: logs.append(m.text))

    # 1) 先逛 /explore 拿 cookie + referer
    print(">> goto /explore")
    try:
        pg.goto("https://www.zhihu.com/explore", wait_until="domcontentloaded", timeout=30000)
    except Exception as e:
        print("   explore 异常:", str(e)[:80])
    pg.wait_for_timeout(2500)
    print("   badge:", snap(pg, "explore").get("badge"))

    # 2) 找一个内容链接点进去（问题页 / 回答页）
    print(">> 找内容链接")
    link = pg.evaluate("""() => {
        var as = Array.from(document.querySelectorAll('a[href*="/question/"], a[href*="/answer/"], a[href*="/p/"]'));
        for (var i=0;i<as.length;i++){ if(as[i].href && as[i].href.indexOf('zhihu.com')>0) return as[i].href; }
        return null;
    }""")
    print("   link:", link)
    if not link:
        print("!! 没找到内容链接，退出"); b.close(); sys.exit(2)
    pg.goto(link, wait_until="domcontentloaded", timeout=30000)
    pg.wait_for_timeout(3000)
    s_article = snap(pg, "article")
    print("   进文章:", s_article.get("url"), "| len", s_article.get("len"))

    # 3) 关闭可能出现的登录弹层（右上角 ✕）
    try:
        pg.evaluate("""() => {
            var xs=document.querySelectorAll('button[aria-label="关闭"], .Modal-closeButton, [class*="close"]');
            for(var i=0;i<xs.length;i++){ try{xs[i].click();}catch(e){} }
        }""")
    except Exception: pass
    pg.wait_for_timeout(800)

    # 4) 找「评论」按钮并点开
    print(">> 找评论按钮并点击")
    clicked = click_comment(pg)
    print("   点击评论按钮:", clicked)
    if not clicked:
        print("!! 没找到评论按钮，退出"); b.close(); sys.exit(2)

    # 给脚本的持久检测充足时间（真实知乎评论层是 React 异步挂载，可能 1~2s 才稳定）
    pg.wait_for_timeout(3500)
    s_open = snap(pg, "comment-open")
    op = comment_open(pg)
    print("   开评论后: len", s_open.get("len"), "| state", s_open.get("state"), "| 评论层开着:", op.get("found"))

    # 真机自检：脚本是否在本页激活（角标存在即说明 userscript 已运行）
    active = pg.evaluate("() => !!document.getElementById('zhihu-mobile-badge')")
    print("   脚本在本页激活(badge):", active)

    # 5) 按返回
    print(">> 按返回键 (go_back)")
    try:
        pg.go_back(wait_until="commit", timeout=8000)
    except Exception as e:
        print("   go_back 异常:", str(e)[:60])
    pg.wait_for_timeout(1500)
    s_back = snap(pg, "after-back")
    op_back = comment_open(pg)
    print("   返回后: url", s_back.get("url"), "| len", s_back.get("len"),
          "| state", s_back.get("state"), "| 评论层开着:", op_back.get("found"))

    print("\npageerror:", errs[:3])
    print("\n== 相关 console 日志 ==")
    for l in logs:
        if 'ZFDBG' in l or '失败' in l or 'smb' in l:
            print("   ", l[:160])

    # 判定
    # 缓冲压入：state 带 zfModal，或长度比进文章时 +1
    buf = (s_open.get("state") and s_open.get("state").get("zfModal")) or \
          (isinstance(s_open.get("len"), int) and isinstance(s_article.get("len"), int)
           and s_open["len"] > s_article["len"])
    # 返回后：评论层关掉，且仍停在原问题页
    closed = (op.get("found") and not op_back.get("found"))
    stayed = (s_back.get("url") == s_article.get("url"))
    print("\n=== 结论 ===")
    print("  评论层曾打开        :", op.get("found"))
    print("  缓冲历史已压入      :", bool(buf), "(state=%s, len %s->%s)" % (
        s_open.get("state"), s_article.get("len"), s_open.get("len")))
    print("  返回后评论层已关闭  :", closed)
    print("  返回后仍在本页      :", stayed)
    print("  >>> 总体:", "PASS ✅" if (op.get("found") and buf and closed and stayed) else "FAIL ❌")
    b.close()
