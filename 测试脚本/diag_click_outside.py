"""诊断：clickOutside 为什么没被调用 / 调用了为什么没生效"""
from playwright.sync_api import sync_playwright
import subprocess, time, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
URL = "http://127.0.0.1:8753/testpage_click_outside.html"

proc = subprocess.Popen([
    "C:/Users/xiongbin/.workbuddy/binaries/python/envs/default/Scripts/python.exe",
    "-m", "http.server", "8753"
], cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)

DESKTOP = dict(
    viewport={"width": 980, "height": 2130}, screen={"width": 393, "height": 852},
    device_scale_factor=2.625, has_touch=True,
    user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        ctx = b.new_context(**DESKTOP)
        ctx.add_init_script(path=V4)
        pg = ctx.new_page()
        logs = []
        pg.on("console", lambda m: logs.append(m.text))
        pg.goto(URL, wait_until="load", timeout=30000)
        pg.wait_for_timeout(1200)
        pg.evaluate("document.getElementById('entry').click()")
        pg.wait_for_timeout(800)

        # 手动逐步跑 closeTopModal 的逻辑
        r = pg.evaluate("""
        () => {
            const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
            const cands = [];
            const all = document.body.querySelectorAll('*');
            for (let i = 0; i < all.length; i++) {
                const el = all[i];
                if (el.id === 'zhihu-mobile-badge' || el.id === 'zf-modal-close') continue;
                let cs; try { cs = getComputedStyle(el); } catch(e) { continue; }
                if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
                if (cs.display === 'none' || cs.visibility === 'hidden') continue;
                if (parseFloat(cs.opacity) < 0.15) continue;
                const r = el.getBoundingClientRect();
                if (r.width < vw*0.55 || r.height < vh*0.35) continue;
                let txt = ''; try { txt = (el.innerText||'').trim(); } catch(e){}
                let inter = 0;
                try { inter = el.querySelectorAll('button,a,input,textarea,[role=button]').length; } catch(e){}
                cands.push({tag: el.tagName, id: el.id,
                            cls: (typeof el.className==='string'?el.className:'').slice(0,30),
                            w: Math.round(r.width), h: Math.round(r.height),
                            z: cs.zIndex, txt: txt.length, inter});
            }
            return cands;
        }
        """)
        print("候选层 (>=55%%x35%%):")
        for c in r:
            print("  ", json.dumps(c, ensure_ascii=False))

        # 直接调 clickOutsideModal —— 通过 __zfDiag 无法调私有函数，
        # 改为在页面上复刻其逻辑看能否找到 backdrop
        r2 = pg.evaluate("""
        () => {
            // 找 findOpenModal 的结果（按 layerScore）
            const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
            let best = null, bestScore = -1;
            const all = document.body.querySelectorAll('*');
            for (let i = 0; i < all.length; i++) {
                const el = all[i];
                if (el.id === 'zhihu-mobile-badge' || el.id === 'zf-modal-close') continue;
                let cs; try { cs = getComputedStyle(el); } catch(e) { continue; }
                if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
                if (cs.display === 'none' || cs.visibility === 'hidden') continue;
                if (parseFloat(cs.opacity) < 0.15) continue;
                const r = el.getBoundingClientRect();
                if (r.width < vw*0.55 || r.height < vh*0.35) continue;
                const txt = (el.innerText||'').trim();
                let score = 0;
                if (txt.length > 0) score += 100;
                if (txt.length > 40) score += 50;
                try { score += Math.min(el.querySelectorAll('button,a,input,textarea,[role=button]').length, 15); } catch(e){}
                if (score > bestScore) { best = el; bestScore = score; }
            }
            if (!best) return {m: null};
            const out = {mCls: (typeof best.className==='string'?best.className:'').slice(0,30), targets: []};
            function isBackdropLike(el) {
                if (!el || el === document.body || el === document.documentElement) return false;
                let cs; try { cs = getComputedStyle(el); } catch(e) { return false; }
                if (!cs) return false;
                if (cs.display === 'none' || cs.visibility === 'hidden') return false;
                if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
                let r; try { r = el.getBoundingClientRect(); } catch(e2) { return false; }
                return r.width >= vw*0.9 && r.height >= vh*0.9;
            }
            let a = best.parentElement;
            while (a && a !== document.body) {
                if (isBackdropLike(a)) { out.targets.push({src: 'parent-chain', cls: (typeof a.className==='string'?a.className:'').slice(0,30)}); break; }
                a = a.parentElement;
            }
            if (best.parentElement) {
                const sibs = best.parentElement.children;
                for (let i = 0; i < sibs.length; i++) {
                    if (sibs[i] !== best && isBackdropLike(sibs[i])) {
                        out.targets.push({src: 'sibling', cls: (typeof sibs[i].className==='string'?sibs[i].className:'').slice(0,30)});
                    }
                }
            }
            const kids = document.body.children;
            for (let j = 0; j < kids.length; j++) {
                if (kids[j] === best || best.contains(kids[j]) || kids[j].contains(best)) continue;
                if (kids[j].id === 'zhihu-mobile-badge' || kids[j].id === 'zf-modal-close') continue;
                if (isBackdropLike(kids[j])) out.targets.push({src: 'body-child', cls: (typeof kids[j].className==='string'?kids[j].className:'').slice(0,30)});
            }
            return out;
        }
        """)
        print()
        print("findOpenModal 选中:", json.dumps(r2.get("mCls"), ensure_ascii=False))
        print("clickOutside 候选 targets:", json.dumps(r2.get("targets"), ensure_ascii=False))
        b.close()
finally:
    proc.terminate()
