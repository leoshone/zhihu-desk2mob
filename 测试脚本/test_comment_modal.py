"""评论弹层：系统返回键必须能关掉弹层、且不能把用户送出页面。

三种复刻形态（对应知乎真实可能的结构）：
  A 居中弹层超高 → 关闭按钮被顶到视口外
  B 遮罩与弹层同级同 z-index，遮罩先插入 → 老逻辑会挑中遮罩
  C portal 容器 fixed 铺满，内部 relative，关闭按钮无 close 关键字

断言：
  1. 脚本应给出兜底关闭按钮（说明检测到了弹层）
  2. 弹层自身的关闭按钮必须落在视口内（几何断言，光"存在"不够）
  3. 按系统返回 → 弹层消失 + 仍在本页（URL 不变）
  4. 关掉后正文仍在
"""
from lib import *
from playwright.sync_api import sync_playwright
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHOT = os.path.join(os.path.dirname(HERE), "测试截图")
V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"

URL = "file:///" + os.path.join(HERE, "testpage_comment_modal.html").replace("\\", "/")

STATE = r"""
() => {
  const host = document.getElementById('layerHost');
  const btn = document.getElementById('zf-modal-close');
  const zf = btn ? (() => { const r = btn.getBoundingClientRect();
      return {w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top)}; })() : null;
  // 弹层自己的关闭按钮：取弹层里第一个尺寸 > 0 的 button
  let native = null;
  if (host) {
    const bs = host.querySelectorAll('button');
    for (const b of bs) {
      const r = b.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const vh = document.documentElement.clientHeight;
        native = {cls: (typeof b.className === 'string' ? b.className : '').slice(0, 40),
                  top: Math.round(r.top), left: Math.round(r.left),
                  inView: r.top >= 0 && r.bottom <= vh && r.left >= 0};
        break;
      }
    }
  }
  // 真正该消失的是弹层节点（host 的直接子节点），不是 host 这个挂载点容器
  let live = false;
  if (host) {
    for (const k of host.children) {
      const cs = getComputedStyle(k);
      const r = k.getBoundingClientRect();
      if (cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0) { live = true; break; }
    }
  }
  return {
    layer: !!host,
    layerVisible: live,
    zfBtn: zf,
    nativeBtn: native,
    textLen: document.body.innerText.length,
  };
}
"""

fails = []
def run(p, label, typ, script, shot, tap=False):
    ctx = p.new_context(**DESKTOP_MODE)
    if script:
        ctx.add_init_script(path=script)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
    pg.goto(URL + "?type=" + typ, wait_until="load", timeout=30000)
    pg.wait_for_timeout(2000)
    # 造一条可退的历史（模拟从首页点进正文）
    pg.evaluate("history.pushState({t:1}, '', location.href + '#dummy')")
    pg.wait_for_timeout(200)
    base = pg.url

    print(f"\n===== {label} · 形态{typ} =====")
    pg.click("#openBtn")
    pg.wait_for_timeout(1200)
    st = pg.evaluate(STATE)
    print("  打开后:", st)
    if shot:
        pg.screenshot(path=os.path.join(SHOT, f"{shot}-{typ}-打开.png"))

    if not st["layer"]:
        print("  ✗ 弹层没打开（复刻页自身问题）"); fails.append(label); ctx.close(); return

    if script:
        if not st["zfBtn"]:
            print("  ✗ 脚本没给出兜底关闭按钮 → 弹层没被识别"); fails.append(label + "·未识别")
        nb = st["nativeBtn"]
        if nb and not nb["inView"]:
            print(f"  ✗ 弹层关闭按钮在视口外 (top={nb['top']}) → 用户点不到"); fails.append(label + "·按钮出界")
        elif nb:
            print(f"  ✓ 弹层关闭按钮在视口内 (top={nb['top']})")

    if tap:
        # 端到端：直接点原生关闭按钮（修复后应被钉回视口、可点），验证真的能关
        # 先诊断：关闭按钮中心点最顶层的元素是不是它自己（被遮挡=真机也点不到）
        hit = pg.evaluate(r"""() => {
          const b = document.querySelector('.r-x');
          if (!b) return {found:false};
          const r = b.getBoundingClientRect();
          const cx = r.left + r.width/2, cy = r.top + r.height/2;
          const top = document.elementFromPoint(cx, cy);
          const cs = getComputedStyle(b);
          const chain = [];
          let p = top;
          for (let i=0; i<5 && p; i++) {
            chain.push(p.tagName + '.' + (typeof p.className==='string'?p.className:'').slice(0,24)
                       + '#' + (p.id||'') + '[' + getComputedStyle(p).position + ' z=' + getComputedStyle(p).zIndex + ']');
            p = p.parentElement;
          }
          const desc = top ? (top.tagName + '.' + (typeof top.className==='string'?top.className:'').slice(0,30)) : 'null';
          return {found:true, cx:Math.round(cx), cy:Math.round(cy), topDesc:desc,
                  isSelf: top === b || (b.contains(top)),
                  rxPos: cs.position, rxZ: cs.zIndex, rxPe: cs.pointerEvents,
                  topChain: chain};
        }""")
        print("  命中诊断:", hit)
        try:
            pg.click(".r-x", timeout=6000)
        except Exception as e:
            print("  tap原生关闭:", str(e)[:60])
        pg.wait_for_timeout(1200)
        st3 = pg.evaluate(STATE)
        same3 = (pg.url == base)
        gone3 = (not st3["layer"]) or (not st3["layerVisible"])
        print("  点原生关闭后:", {k: st3[k] for k in ("layer", "layerVisible")}, "| 仍在本页:", same3)
        if script:
            if not gone3:
                print("  ✗ 点原生关闭按钮没关掉弹层"); fails.append(label + "·点关不掉")
            elif same3 and st3["textLen"] > 200:
                print("  ✓ 点原生关闭按钮关掉弹层且留在原页")
        ctx.close()
        return

    try:
        pg.go_back(wait_until="load", timeout=12000)
    except Exception as e:
        print("  go_back:", str(e)[:60])
    pg.wait_for_timeout(1500)
    st2 = pg.evaluate(STATE)
    same = (pg.url == base)
    print("  返回后:", {k: st2[k] for k in ("layer", "layerVisible", "textLen")}, "| 仍在本页:", same)
    if shot:
        pg.screenshot(path=os.path.join(SHOT, f"{shot}-{typ}-返回后.png"))

    gone = (not st2["layer"]) or (not st2["layerVisible"])
    if script:
        if not gone:
            print("  ✗ 返回键没关掉弹层"); fails.append(label + "·没关掉")
        if not same:
            print("  ✗ 页面被退出去了"); fails.append(label + "·页面跳走")
        if gone and same and st2["textLen"] > 200:
            print("  ✓ 返回键关掉弹层且留在原页")
    if errs:
        print("  pageerror:", errs[:2])
    ctx.close()

if __name__ == "__main__":
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        for t in ("A", "B", "C", "D"):
            run(b, "v0.6.1(旧)", t, os.path.join(HERE, "_v061.user.js"), None)
        for t in ("A", "B", "C"):
            run(b, "v0.7.0(新)", t, V4, "评论弹层")
        run(b, "v0.7.2(新)", "D", V4, "评论弹层")            # 形态D：系统返回键关评论+留本页
        run(b, "v0.7.2(新)", "D", V4, "评论弹层", tap=True)  # 形态D：端到端点原生关闭（顺带验证）
        b.close()
    print("\n" + "=" * 50)
    print("结论：" + ("全部通过" if not fails else "未通过 → " + "、".join(fails)))
    sys.exit(1 if fails else 0)
