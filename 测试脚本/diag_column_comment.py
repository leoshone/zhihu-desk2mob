"""真机取证：专栏页（zhuanlan.zhihu.com/p/...）的评论按钮长什么样、点击后发生什么。

用户报告 v0.7.5 在专栏页仍失效。本脚本抓：
  1) 页面上所有疑似「评论」入口的完整 DOM 信息（tag/class/id/text/aria/父子链）
  2) 用 isCommentTrigger 的四路判据逐条打分，看哪条漏了
  3) 点击后 3.5s 内：是否有 fixed/absolute 层出现？URL/state 变化？缓冲压入没有？
"""
from lib import *
from playwright.sync_api import sync_playwright
import sys

V4 = "D:/AiSpaces/Code/zhihu-desk2mob/zhihu-desk2mob.user.js"
TARGET = "https://zhuanlan.zhihu.com/p/34954862"

DESKTOP = dict(DESKTOP_MODE)
DESKTOP["user_agent"] = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

# 与 v0.7.5 脚本里 isCommentTrigger 完全一致的判据（在页面上下文里跑）
ISCMT_JS = """
(btn) => {
  var el = btn;
  if (!el) return {hit:false, why:'null'};
  var tag = (el.tagName || '').toLowerCase();
  if (!/^(button|a|div|span|li)$/.test(tag)) return {hit:false, why:'tag:'+tag};
  var txt = '';
  try { txt = (el.textContent || el.innerText || '').trim().replace(/\\s+/g, ' '); } catch (e) {}
  if (/^\\d+\\s*条?\\s*评论$/.test(txt) || txt === '评论') return {hit:true, why:'text-exact', txt:txt};
  if (txt.length <= 16 && /评论/.test(txt)) return {hit:true, why:'text-short', txt:txt};
  var cls = (el.className || '').toString();
  var id = el.id || '';
  if (/\\bcomment\\b/i.test(cls) || /\\bcomment\\b/i.test(id)) return {hit:true, why:'class', txt:txt};
  var label = '';
  try { label = (el.getAttribute('aria-label') || ''); } catch (e) {}
  if (label && (label.indexOf('评论') >= 0 || /comment/i.test(label))) return {hit:true, why:'aria', txt:label};
  var p = el.parentElement;
  if (p && p !== document.body) {
    var pt = '';
    try { pt = (p.textContent || p.innerText || '').trim().replace(/\\s+/g, ' '); } catch (e) {}
    if (pt.length <= 20 && /\\d*\\s*条?\\s*评论/.test(pt)) return {hit:true, why:'parent-text', txt:pt};
  }
  return {hit:false, why:'no-match', txt:txt.slice(0,30), cls:cls.slice(0,40)};
}
"""

DUMP_BTN_JS = """
() => {
  var out = [];
  var sel = 'button,a,[role="button"],div[class*="Button"],span';
  var els = Array.from(document.querySelectorAll(sel));
  for (var i=0;i<els.length;i++){
    var el = els[i];
    var t = '';
    try { t = (el.textContent||'').trim().replace(/\\s+/g,' '); } catch(e){}
    var cls = (el.className||'').toString();
    var label = '';
    try { label = el.getAttribute('aria-label')||''; } catch(e){}
    // 只保留「疑似评论相关」的：文本短且含评论，或 class/aria 含 comment
    var cmtish = (t.length<=20 && /评论/.test(t)) || /comment/i.test(cls) || /评论|comment/i.test(label);
    if (!cmtish) continue;
    var r = el.getBoundingClientRect();
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: cls.slice(0,60),
      id: el.id,
      text: t.slice(0,40),
      aria: label.slice(0,30),
      rect: Math.round(r.width)+'x'+Math.round(r.height)+'@'+Math.round(r.top)+','+Math.round(r.left),
      visible: r.width>0 && r.height>0
    });
    if (out.length>=15) break;
  }
  return out;
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
    ctx = b.new_context(**DESKTOP)
    ctx.add_init_script(path=V4)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:120]))

    print(">> 1) 逛 /explore 拿 cookie")
    try:
        pg.goto("https://www.zhihu.com/explore", wait_until="domcontentloaded", timeout=30000)
        pg.wait_for_timeout(2500)
    except Exception as e:
        print("   explore 异常:", str(e)[:80])

    print(">> 2) 进专栏页", TARGET)
    try:
        pg.goto(TARGET, wait_until="domcontentloaded", timeout=30000)
    except Exception as e:
        print("   goto 异常:", str(e)[:80])
    pg.wait_for_timeout(4000)

    st = pg.evaluate("() => ({url: location.href, len: history.length, state: history.state, badge: (document.getElementById('zhihu-mobile-badge')||{}).textContent||null})")
    print("   页面:", st.get("url"), "| len", st.get("len"), "| badge", st.get("badge"))
    body_len = pg.evaluate("() => (document.body ? document.body.innerText.length : 0)")
    print("   body 文本长度:", body_len, "(太小=被 40362 拦)")
    if body_len < 200:
        print("!! 页面被拦截，取证中止")
        b.close(); sys.exit(2)

    print("\n>> 3) 页面上所有「疑似评论入口」的 DOM：")
    btns = pg.evaluate(DUMP_BTN_JS)
    for i, x in enumerate(btns):
        print("  [%d] %s.%s id=%s text=%r aria=%r rect=%s vis=%s" % (
            i, x["tag"], x["cls"][:36], x["id"][:12], x["text"][:28], x["aria"][:16], x["rect"], x["visible"]))

    print("\n>> 4) 对每个候选跑 v0.7.5 isCommentTrigger 判据：")
    hits = 0
    for i, x in enumerate(btns):
        r = pg.evaluate(ISCMT_JS, None)  # placeholder, need element handle
    # 用 handle 方式重跑
    handles = pg.evaluate("""() => {
        var out = [];
        var els = Array.from(document.querySelectorAll('button,a,[role="button"],div[class*="Button"],span'));
        for (var i=0;i<els.length;i++){
            var el = els[i]; var t='';
            try{t=(el.textContent||'').trim().replace(/\\s+/g,' ');}catch(e){}
            var cls=(el.className||'').toString(); var label='';
            try{label=el.getAttribute('aria-label')||'';}catch(e){}
            if((t.length<=20 && /评论/.test(t)) || /comment/i.test(cls) || /评论|comment/i.test(label)) out.push(i);
        }
        return out;
    }""")
    # 直接在页面里对候选们判
    verdicts = pg.evaluate("""
    () => {
      var els = Array.from(document.querySelectorAll('button,a,[role="button"],div[class*="Button"],span'));
      var out = [];
      for (var i=0;i<els.length;i++){
        var el = els[i]; var t='';
        try{t=(el.textContent||'').trim().replace(/\\s+/g,' ');}catch(e){}
        var cls=(el.className||'').toString(); var label='';
        try{label=el.getAttribute('aria-label')||'';}catch(e){}
        var cmtish = (t.length<=20 && /评论/.test(t)) || /comment/i.test(cls) || /评论|comment/i.test(label);
        if(!cmtish) continue;
        // === isCommentTrigger 同款判据 ===
        var verdict = null;
        var tag = (el.tagName||'').toLowerCase();
        if(!/^(button|a|div|span|li)$/.test(tag)) verdict='MISS(tag:'+tag+')';
        if(!verdict){
          if(/^\\d+\\s*条?\\s*评论$/.test(t) || t==='评论') verdict='HIT(text-exact)';
          else if(t.length<=16 && /评论/.test(t)) verdict='HIT(text-short)';
        }
        if(!verdict && (/\\bcomment\\b/i.test(cls) || /\\bcomment\\b/i.test(el.id))) verdict='HIT(class)';
        if(!verdict && label && (label.indexOf('评论')>=0 || /comment/i.test(label))) verdict='HIT(aria)';
        if(!verdict){
          var p2 = el.parentElement;
          if(p2 && p2!==document.body){
            var pt='';
            try{pt=(p2.textContent||'').trim().replace(/\\s+/g,' ');}catch(e){}
            if(pt.length<=20 && /\\d*\\s*条?\\s*评论/.test(pt)) verdict='HIT(parent-text)';
          }
        }
        out.push({i: out.length, text: t.slice(0,30), verdict: verdict||'MISS(no-match)'});
      }
      return out;
    }""")
    for v in verdicts:
        mark = "✓" if str(v["verdict"]).startswith("HIT") else "✗"
        print("   %s [%d] %r → %s" % (mark, v["i"], v["text"], v["verdict"]))
    hits = sum(1 for v in verdicts if str(v["verdict"]).startswith("HIT"))
    print("   命中 %d / %d" % (hits, len(verdicts)))

    print("\n>> 5) 点击第一个可见的评论入口，观察 3.5s：")
    click_r = pg.evaluate("""
    () => {
      var els = Array.from(document.querySelectorAll('button,a,[role="button"],div[class*="Button"],span'));
      for (var i=0;i<els.length;i++){
        var el=els[i]; var t='';
        try{t=(el.textContent||'').trim().replace(/\\s+/g,' ');}catch(e){}
        var cls=(el.className||'').toString();
        var r = el.getBoundingClientRect();
        if(((t.length<=20 && /评论/.test(t)) || /comment/i.test(cls)) && r.width>0 && r.height>0){
          var info = {clicked:true, tag:el.tagName.toLowerCase(), cls:cls.slice(0,40), text:t.slice(0,30)};
          el.click();
          return info;
        }
      }
      return {clicked:false};
    }""")
    print("   点击:", click_r)
    pg.wait_for_timeout(3500)

    after = pg.evaluate("""
    () => {
      var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      var fixed = [];
      var all = Array.from(document.body.querySelectorAll('*'));
      for (var i=0;i<all.length;i++){
        var el=all[i]; var cs;
        try{cs=getComputedStyle(el);}catch(e){continue;}
        if(cs.position!=='fixed' && cs.position!=='absolute') continue;
        if(cs.display==='none'||cs.visibility==='hidden') continue;
        if(parseFloat(cs.opacity)<0.15) continue;
        var r=el.getBoundingClientRect();
        if(r.width<vw*0.3||r.height<vh*0.3) continue;
        fixed.push((el.className||el.tagName).toString().replace(/\\s+/g,' ').slice(0,40)+' '+Math.round(r.width)+'x'+Math.round(r.height)+'@'+Math.round(r.top));
        if(fixed.length>=8) break;
      }
      return {url:location.href, len:history.length, state:history.state,
              scrollY: Math.round(window.scrollY), fixedLayers: fixed};
    }""")
    print("   点击后 URL:", after.get("url"))
    print("   history.len:", after.get("len"), "| state:", after.get("state"))
    print("   scrollY:", after.get("scrollY"), "(滚动了=内联定位展开)")
    print("   大浮层:", after.get("fixedLayers") or "无 ←(无浮层=内联展开)")

    pg.screenshot(path="测试截图/专栏-取证-点击评论后.png")
    print("\n截图: 测试截图/专栏-取证-点击评论后.png")
    print("pageerror:", errs[:3])
    b.close()
