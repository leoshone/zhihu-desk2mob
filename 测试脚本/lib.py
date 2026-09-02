from playwright.sync_api import sync_playwright

UA_DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
UA_MOBILE  = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"

# Kiwi「桌面版网站」：屏幕 393 宽，Chrome 强制 layout viewport = 980 CSS px，整页缩到 0.4 显示
DESKTOP_MODE = dict(viewport={"width":980,"height":2130}, screen={"width":393,"height":852},
                    device_scale_factor=2.625, has_touch=True, user_agent=UA_DESKTOP)
# 普通移动模式
MOBILE_MODE  = dict(viewport={"width":393,"height":852}, screen={"width":393,"height":852},
                    device_scale_factor=2.625, is_mobile=True, has_touch=True, user_agent=UA_MOBILE)

MEASURE_JS = r"""
() => {
  const de = document.documentElement, se = de.scrollWidth ? de : document.body;
  const se2 = document.scrollingElement || de;
  const zoom = parseFloat(getComputedStyle(de).zoom) || 1;
  const layoutW = de.clientWidth;              // layout viewport (980 / 393)
  const cssW = layoutW / zoom;                 // 实际用于布局的 CSS 宽度
  const overflowX = se2.scrollWidth - se2.clientWidth;

  // 找出布局宽度超出可视宽度的元素（用 offsetWidth，不受 zoom 影响）
  const bad = [];
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const ow = el.offsetWidth;
    if (!ow) continue;
    const pos = cs.position;
    // fixed 元素用视口坐标判断
    let w = ow;
    if (pos === 'fixed') w = el.getBoundingClientRect().width / zoom;
    if (w > cssW + 2) {
      bad.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
        w: Math.round(w), pos,
        depth: (function(){let d=0,p=el;while(p&&p!==document.body){d++;p=p.parentElement}return d})()
      });
    }
  }
  bad.sort((a,b)=>b.w-a.w);
  return {
    zoom: +zoom.toFixed(4), layoutW, cssW: Math.round(cssW),
    scrollWidth: se2.scrollWidth, clientWidth: se2.clientWidth,
    overflowX, overflowCount: bad.length,
    worst: bad.slice(0, 8),
    bodyScrollW: document.body ? document.body.scrollWidth : 0,
    htmlZoomProp: getComputedStyle(de).zoom,
    title: (document.title||'').slice(0,50),
    textLen: document.body ? document.body.innerText.length : 0,
  };
}
"""
