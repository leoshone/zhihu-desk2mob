"""取证：评论弹层的关闭按钮候选 / portal 结构 / React 挂载点。"""
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
    pg.goto("https://www.zhihu.com/explore", wait_until="domcontentloaded", timeout=30000)
    pg.wait_for_timeout(2000)
    pg.evaluate("(u) => { location.href = u; }", TARGET)
    pg.wait_for_load_state("domcontentloaded", timeout=30000)
    pg.wait_for_timeout(5000)
    pg.evaluate("""() => {
        const xs = document.querySelectorAll('.Modal-closeButton, button[aria-label="关闭"]');
        for (const x of xs) { try { x.click(); } catch(e){} }
    }""")
    pg.wait_for_timeout(2500)
    pg.evaluate("""() => {
        const btns = document.querySelectorAll('button.Button.ContentItem-action');
        for (const btn of btns) {
            if ((btn.textContent||'').indexOf('评论') >= 0) { btn.click(); return; }
        }
    }""")
    pg.wait_for_timeout(2500)

    r = pg.evaluate("""() => {
        const out = {domNodes: document.body.querySelectorAll('*').length};
        const modal = document.querySelector('.Modal-wrapper');
        out.closeCands = {
            modalCloseBtn: !!document.querySelector('.Modal-closeButton'),
            ariaClose: document.querySelectorAll('[aria-label="关闭"]').length,
            closeClass: document.querySelectorAll('[class*="lose"]').length
        };
        if (modal) {
            const cs = getComputedStyle(modal);
            out.modal = {
                cls: modal.className.slice(0,50),
                pos: cs.position, disp: cs.display, z: cs.zIndex
            };
        }
        const portals = [];
        document.body.childNodes.forEach(n => {
            if (n.nodeType === 1) portals.push(n.tagName + (n.id ? '#' + n.id : '') + '.' + (typeof n.className === 'string' ? n.className.slice(0,30) : ''));
        });
        out.bodyChildren = portals;
        return out;
    }""")
    print(json.dumps(r, ensure_ascii=False, indent=1))
    b.close()
