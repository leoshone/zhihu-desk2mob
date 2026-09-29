// probe-comment.js — 侦察知乎回答页「评论」交互的真实 DOM 形态
// 用法:
//   node probe-comment.js env            环境与脚本状态
//   node probe-comment.js triggers       找出所有评论触发按钮
//   node probe-comment.js click <index>  点击第 index 个评论按钮并 dump 结果
//   node probe-comment.js dump           当前页面叠加层快照
// 只做只读观察 + 模拟点击，不修改任何站点代码。
'use strict';
const cdp = require('./cdp');

const TAB_SUBSTR = '/answer/';

async function withTab(fn) {
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, TAB_SUBSTR) || await cdp.findTab(api);
    if (!tab) throw new Error('no zhihu tab found');
    const sid = await cdp.attach(api, tab.targetId);
    return await fn(api, sid, tab);
  } finally { api.close(); }
}

const ENV_JS = `JSON.stringify((()=>{
  const html = document.documentElement;
  const vv = window.visualViewport;
  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    screen: { w: screen.width, h: screen.height },
    vv: vv ? { scale: +vv.scale.toFixed(3), width: Math.round(vv.width), height: Math.round(vv.height) } : null,
    htmlZoom: html.style.zoom || '(none)',
    htmlZoomComputed: getComputedStyle(html).zoom,
    z2mStyle: !!document.getElementById('z2m-style'),
    z2mStop: typeof window.__z2mStop,
    z2mTick: typeof window.__z2mTick,
    z2mW: getComputedStyle(html).getPropertyValue('--z2m-w').trim(),
    bodyW: Math.round(document.body.getBoundingClientRect().width),
    scroll: { x: window.scrollX, y: window.scrollY },
    histLen: history.length,
    histState: history.state,
  };
})())`;

// 找出 .ContentItem-actions 里所有按钮的文本 + 结构
const TRIGGERS_JS = `JSON.stringify((()=>{
  const out = [];
  document.querySelectorAll('.ContentItem-actions button, .ContentItem-actions a, .ContentItem-actions > *').forEach((el, i) => {
    const txt = (el.innerText || el.textContent || '').replace(/\\s+/g,' ').trim();
    if (!txt) return;
    const r = el.getBoundingClientRect();
    out.push({
      i, tag: el.tagName,
      cls: (el.className || '').toString().slice(0, 90),
      txt: txt.slice(0, 40),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      visible: r.width > 0 && r.height > 0,
    });
  });
  // 也统计所有含「评论」字样的可点元素
  const like = [];
  document.querySelectorAll('button, a, div[role="button"]').forEach(el => {
    const t = (el.innerText || '').trim();
    if (/评论/.test(t) && t.length < 30) {
      const r = el.getBoundingClientRect();
      like.push({ tag: el.tagName, cls: (el.className||'').toString().slice(0,90), txt: t.slice(0,30),
                  rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } });
    }
  });
  return { actions: out, commentLike: like };
})())`;

// body 直接子节点的叠加层快照：position 非 static、覆盖面积大者
const OVERLAY_JS = `JSON.stringify((()=>{
  const body = document.body;
  const br = body.getBoundingClientRect();
  const kids = [...body.children].map((el, i) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const vis = cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0;
    return {
      i, tag: el.tagName,
      cls: (el.className || '').toString().slice(0, 110),
      id: el.id || '',
      pos: cs.position, z: cs.zIndex, disp: cs.display, vis,
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      txt: vis ? (el.innerText || '').replace(/\\s+/g,' ').trim().slice(0, 60) : '',
    };
  }).filter(k => k.vis);
  return { bodyRect: { w: Math.round(br.width), h: Math.round(br.height) },
           histLen: history.length, histState: history.state, y: window.scrollY, kids };
})())`;

// 深度扫描：全 DOM 中脱离文档流、面积大、z-index 高的叠加层（含后代），
// 以及任何带关闭语义的元素（aria-label / class 含 close|modal|dialog|mask）。
const LAYER_JS = `JSON.stringify((()=>{
  const vv = window.visualViewport;
  const visW = Math.round(vv ? vv.width : innerWidth), visH = Math.round(vv ? vv.height : innerHeight);
  const layers = [], closers = [];
  document.querySelectorAll('body *').forEach(el => {
    let cs; try { cs = getComputedStyle(el); } catch(e){ return; }
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return;
    const isOverlay = cs.position === 'fixed' || cs.position === 'absolute';
    if (isOverlay) {
      const z = parseInt(cs.zIndex, 10);
      const area = r.width * r.height;
      if (area > 40000 && (r.width > 100 || r.height > 100) && (z > 0 || cs.position === 'fixed')) {
        layers.push({
          tag: el.tagName,
          cls: (el.className||'').toString().slice(0,120),
          pos: cs.position, z: cs.zIndex, disp: cs.display,
          rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
          scroll: { sh: el.scrollHeight, ch: el.clientHeight, sy: Math.round(el.scrollTop) },
          inView: r.bottom > 0 && r.top < visH && r.right > 0 && r.left < visW,
          txt: (el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,80),
          path: (()=>{ let p=[], n=el; for(let i=0;i<6&&n&&n.tagName;i++){ p.unshift(n.tagName.toLowerCase()+(n.id?'#'+n.id:'')+(n.className?'.'+String(n.className).split(/\\s+/)[0]:'')); n=n.parentElement; } return p.join('>'); })(),
        });
      }
    }
    // 关闭语义元素
    const al = (el.getAttribute('aria-label')||'');
    const t = (el.className||'').toString();
    if (/close|关闭|收起|取消|dismiss/i.test(al) || /(^|[\\s-])(Close|close)[A-Za-z]*($|[\\s-])/.test(t) || /Modal-?[Cc]lose|Dialog-?[Cc]lose|CloseButton/i.test(t)) {
      closers.push({
        tag: el.tagName, cls: t.slice(0,120), ariaLabel: al,
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        inView: r.bottom > 0 && r.top < visH && r.right > 0 && r.left < visW,
        txt: (el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,40),
      });
    }
  });
  layers.sort((a,b) => (parseInt(b.z,10)||0) - (parseInt(a.z,10)||0));
  return { visW, visH, histLen: history.length, histState: history.state,
           layerCount: layers.length, layers: layers.slice(0, 25), closers: closers.slice(0, 25) };
})())`;

(async () => {
  const cmd = process.argv[2] || 'env';
  await withTab(async (api, sid) => {
    const SHOTS = 'shots/';
    if (cmd === 'env') {
      console.log(JSON.stringify(await cdp.evalJson(api, ENV_JS, sid), null, 2));
    } else if (cmd === 'triggers') {
      const t = await cdp.evalJson(api, TRIGGERS_JS, sid);
      console.log('--- .ContentItem-actions 子元素 ---');
      (t.actions || []).forEach(a => console.log(`  [${a.i}] ${a.tag} "${a.txt}" ${JSON.stringify(a.rect)} cls=${a.cls}`));
      console.log('--- 含「评论」字样的可点元素 ---');
      (t.commentLike || []).forEach(a => console.log(`  ${a.tag} "${a.txt}" ${JSON.stringify(a.rect)} cls=${a.cls}`));
    } else if (cmd === 'dump') {
      console.log(JSON.stringify(await cdp.evalJson(api, OVERLAY_JS, sid), null, 2));
    } else if (cmd === 'layer') {
      const d = await cdp.evalJson(api, LAYER_JS, sid);
      console.log(`visW=${d.visW} visH=${d.visH} histLen=${d.histLen} histState=${JSON.stringify(d.histState)} layers=${d.layerCount}`);
      console.log('--- 脱离文档流的叠加层（按 z 降序）---');
      d.layers.forEach(l => console.log(`  ${l.tag} z=${l.z} pos=${l.pos} ${JSON.stringify(l.rect)} scroll(sh=${l.scroll.sh},ch=${l.scroll.ch}) inView=${l.inView}\n      path=${l.path}\n      cls=${l.cls}\n      txt=${l.txt.slice(0,70)}`));
      console.log('--- 关闭语义元素 ---');
      d.closers.forEach(c => console.log(`  ${c.tag} "${c.txt}" aria=${c.ariaLabel} ${JSON.stringify(c.rect)} inView=${c.inView} cls=${c.cls}`));
    } else if (cmd === 'shot') {
      const p = await cdp.shot(api, sid, process.argv[3] || SHOTS + 'probe.png');
      console.log('saved', p);
    } else if (cmd === 'click') {
      const idx = parseInt(process.argv[3] || '0', 10);
      const before = await cdp.evalJson(api, LAYER_JS, sid);
      console.log('BEFORE histLen=' + before.histLen + ' layers=' + before.layerCount);
      await cdp.shot(api, sid, SHOTS + 'before-click.png');
      const r = await cdp.evalJson(api, `JSON.stringify((()=>{
        const els = [...document.querySelectorAll('button, a, div[role="button"]')].filter(el => /评论/.test((el.innerText||'').trim()) && (el.innerText||'').trim().length < 30);
        const el = els[${idx}];
        if (!el) return { err: 'no trigger at index ${idx}', count: els.length };
        const info = { txt: (el.innerText||'').trim().slice(0,40), tag: el.tagName, cls: (el.className||'').toString().slice(0,90) };
        el.scrollIntoView({ block: 'center' });
        el.click();
        return Object.assign(info, { clicked: true, count: els.length });
      })())`, sid);
      console.log('CLICK ->', JSON.stringify(r));
      await cdp.sleep(2500);
      const after = await cdp.evalJson(api, LAYER_JS, sid);
      console.log('AFTER histLen=' + after.histLen + ' histState=' + JSON.stringify(after.histState) + ' layers=' + after.layerCount);
      console.log('--- 叠加层 ---');
      after.layers.forEach(l => console.log(`  ${l.tag} z=${l.z} pos=${l.pos} ${JSON.stringify(l.rect)} scroll(sh=${l.scroll.sh},ch=${l.scroll.ch}) inView=${l.inView}\n      path=${l.path}\n      txt=${l.txt.slice(0,70)}`));
      console.log('--- 关闭语义元素 ---');
      after.closers.forEach(c => console.log(`  ${c.tag} "${c.txt}" aria=${c.ariaLabel} ${JSON.stringify(c.rect)} inView=${c.inView} cls=${c.cls}`));
      await cdp.shot(api, sid, SHOTS + 'after-click.png');
    }
  });
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
