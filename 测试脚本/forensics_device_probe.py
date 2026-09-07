"""真机深挖：为什么滚动阈值 61496？为什么点评论检测不到弹层？

上一轮真机取证的异常：
  • 视口 891x1753（桌面模拟是 980x2130）
  • 滚动阈值 61496.75 —— 远大于文档实际高度，滚动压缓冲永不触发
  • 点「110 条评论」后，三层判据全部未命中，无 >=55%x35% 的浮层

本脚本逐项拆开：
  1) zoom / 视口 / 文档高度 / 正文锚点计算过程（哪个选择器、r.top、r.height）
  2) 点评论前后，页面上所有 fixed/absolute 层的清单（不论大小）
  3) 评论按钮点击后页面 DOM 发生了什么变化
"""
from playwright.sync_api import sync_playwright
import subprocess, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ADB = os.path.join(ROOT, ".workbuddy", "tools", "platform-tools", "adb.exe")
OUT = os.path.join(ROOT, "测试截图", "真机")
os.makedirs(OUT, exist_ok=True)


def adb(*args):
    return subprocess.run([ADB] + list(args), capture_output=True, text=True, timeout=30)


adb("start-server")
adb("forward", "--remove-all")
adb("forward", "tcp:9222", "localabstract:chrome_devtools_remote")
time.sleep(1)

PROBE = """() => {
    const de = document.documentElement;
    const zoom = parseFloat(getComputedStyle(de).zoom) || 1;
    const vw = de.clientWidth, vh = de.clientHeight;

    // 1) 正文锚点计算过程（复刻脚本 articleBottomY 的算法）
    const sels = ['.Post-RichTextContainer', '.RichText', '.Post-Main',
                  '.Question-mainColumn', '.Topstory-mainColumn', 'article'];
    const anchors = [];
    for (const sel of sels) {
        let n = 0;
        for (const el of document.querySelectorAll(sel)) {
            n++;
            if (anchors.length >= 6) break;
            if (!el.getClientRects().length) continue;
            if ((el.innerText||'').trim().length < 300) continue;
            const r = el.getBoundingClientRect();
            if (r.height < 300) continue;
            anchors.push({
                sel: sel, idx: n,
                cls: (typeof el.className==='string'?el.className:'').slice(0,30),
                rTop: Math.round(r.top), rH: Math.round(r.height),
                offsetH: el.offsetHeight,
                scrollH: el.scrollHeight,
                docBottom: Math.round(r.top/zoom + (window.scrollY||0) + r.height/zoom)
            });
        }
    }

    // 2) 所有 fixed/absolute 层（不论大小，取面积最大的 12 个）
    const layers = [];
    const all = document.body.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (el.id === 'zhihu-mobile-badge' || el.id === 'zf-modal-close') continue;
        let cs; try { cs = getComputedStyle(el); } catch(e) { continue; }
        if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (parseFloat(cs.opacity) < 0.15) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 50 || r.height < 50) continue;
        layers.push({
            tag: el.tagName.toLowerCase(),
            cls: (typeof el.className==='string'?el.className:'').slice(0,34),
            pos: cs.position, z: cs.zIndex,
            w: Math.round(r.width), h: Math.round(r.height),
            pctW: Math.round(r.width/vw*100), pctH: Math.round(r.height/vh*100),
            txt: ((el.innerText||'').trim()).length,
            inter: el.querySelectorAll('button,a,input,textarea,[role="button"]').length
        });
    }
    layers.sort((a,b) => (b.w*b.h) - (a.w*a.h));

    return {
        zoom: zoom,
        vw: vw, vh: vh,
        screenW: window.screen.width, screenH: window.screen.height,
        innerW: window.innerWidth, innerH: window.innerHeight,
        dpr: window.devicePixelRatio,
        docScrollH: de.scrollHeight,
        bodyScrollH: document.body ? document.body.scrollHeight : 0,
        scrollY: Math.round(window.scrollY||0),
        htmlWidthStyle: de.style.width || '(none)',
        htmlZoomStyle: de.style.zoom || '(none)',
        anchors: anchors,
        topLayers: layers.slice(0, 12)
    };
}"""

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
    ctx = b.contexts[0]
    target = None
    for pg in ctx.pages:
        if "zhuanlan.zhihu.com" in (pg.url or ""):
            target = pg
            break
    if not target:
        print("❌ 没找到专栏页"); b.close(); sys.exit(1)

    print("目标:", target.url)
    print()
    d = target.evaluate(PROBE)
    print("=" * 70)
    print("【环境】")
    print("  zoom =", d["zoom"], " 视口(clientWidth/Height) =", d["vw"], "x", d["vh"])
    print("  window.innerWidth/Height =", d["innerW"], "x", d["innerH"])
    print("  screen =", d["screenW"], "x", d["screenH"], " dpr =", d["dpr"])
    print("  html style width =", d["htmlWidthStyle"], " zoom =", d["htmlZoomStyle"])
    print()
    print("【文档高度】")
    print("  documentElement.scrollHeight =", d["docScrollH"])
    print("  body.scrollHeight =", d["bodyScrollH"])
    print("  scrollY =", d["scrollY"])
    print()
    print("【正文锚点计算（脚本用它算滚动阈值）】")
    print("  阈值 = 正文底边 - 一屏")
    for a in d["anchors"]:
        print("   · %s[%d] .%s" % (a["sel"], a["idx"], a["cls"]))
        print("       r.top=%s r.height=%s offsetH=%s scrollH=%s  → 文档底边=%s" % (
            a["rTop"], a["rH"], a["offsetH"], a["scrollH"], a["docBottom"]))
    if not d["anchors"]:
        print("   （没找到符合条件的正文锚点）")
    print()
    print("【fixed/absolute 层（按面积前 12）】")
    print("  %-38s %-9s %-6s %-11s %-7s %-5s %s" % ("类名", "position", "z", "尺寸", "占屏%", "文字", "交互元素"))
    for l in d["topLayers"]:
        print("  %-38s %-9s %-6s %-11s %-7s %-5s %s" % (
            l["cls"][:38], l["pos"], l["z"],
            str(l["w"]) + "x" + str(l["h"]),
            str(l["pctW"]) + "%x" + str(l["pctH"]) + "%",
            l["txt"], l["inter"]))
    with open(os.path.join(OUT, "探针-环境.json"), "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    print()
    print("💾 测试截图/真机/探针-环境.json")

    # 点评论按钮，看 DOM 变化
    print()
    print("=" * 70)
    print("【点「评论」按钮后的变化】")
    before = target.evaluate(PROBE)
    clicked = target.evaluate("""() => {
        const btns = document.querySelectorAll('button, [role="button"]');
        for (const b of btns) {
            const t = (b.textContent || '').trim();
            if (t.indexOf('评论') >= 0 && t.length <= 20) { b.click(); return t; }
        }
        return null;
    }""")
    print("  点了:", clicked)
    target.wait_for_timeout(3000)
    after = target.evaluate(PROBE)
    print("  scrollY: %s → %s" % (before["scrollY"], after["scrollY"]))
    print("  文档高: %s → %s" % (before["docScrollH"], after["docScrollH"]))
    print("  层数量: %d → %d" % (len(before["topLayers"]), len(after["topLayers"])))
    print()
    print("  点后 fixed/absolute 层（前 8）:")
    for l in after["topLayers"][:8]:
        print("    %-36s %-9s z=%-6s %-11s 占屏%s%%x%s%% 文字%s 交互%s" % (
            l["cls"][:36], l["pos"], l["z"], str(l["w"]) + "x" + str(l["h"]),
            l["pctW"], l["pctH"], l["txt"], l["inter"]))
    with open(os.path.join(OUT, "探针-点评论后.json"), "w", encoding="utf-8") as f:
        json.dump(after, f, ensure_ascii=False, indent=1)
    b.close()
