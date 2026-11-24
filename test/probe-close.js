// probe-close.js — 找到「真正能让评论弹层关掉」的控件/事件
// 用法: node probe-close.js            （弹层应已打开）
'use strict';
const C = require('./cdp-local');

const VIS = `(() => {
  const m = [...document.querySelectorAll('.Modal-content')].find(x => x.checkVisibility && x.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
  if (!m) return null;
  const card = m.closest('.css-1aq8hf9') || m.parentElement;
  const layer = (() => { let l = m; while (l && l !== document.body) { const cs = getComputedStyle(l); if (cs.position === 'fixed' && (parseInt(cs.zIndex, 10) || 0) >= 50) return l; l = l.parentElement; } return null; })();
  return {
    exists: true,
    cardOpacity: getComputedStyle(card).opacity,
    layerKids: layer ? [...layer.children].map(k => { const r = k.getBoundingClientRect(); return { cls: ((k.className || '') + '').slice(0, 26), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }; }) : [],
    closeCandidates: [...document.querySelectorAll('[aria-label],[role="button"],button')]
      .filter(e => /关闭|收起|取消/.test(e.getAttribute('aria-label') || '') || /^(关闭|收起|取消)$/.test((e.textContent || '').replace(/[\\u200b]/g, '').trim()))
      .slice(0, 6)
      .map(e => { const r = e.getBoundingClientRect(); return { tag: e.tagName, t: ((e.getAttribute('aria-label') || e.textContent) || '').replace(/[\\u200b]/g, '').trim().slice(0, 6), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], inLayer: !!(layer && layer.contains(e)) }; }),
  };
})()`;

const TRY = (kind) => `(() => {
  const m = [...document.querySelectorAll('.Modal-content')].find(x => x.checkVisibility && x.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
  if (!m) return 'no-modal';
  const btn = [...document.querySelectorAll('[aria-label]')].find(e => /关闭/.test(e.getAttribute('aria-label') || ''));
  if (${JSON.stringify(kind)} === 'button') {
    if (!btn) return 'no-btn';
    const r = btn.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, clientX: Math.round(r.left + r.width/2), clientY: Math.round(r.top + r.height/2) };
    if (btn.tagName === 'BUTTON') btn.click();
    btn.dispatchEvent(new PointerEvent('pointerdown', o));
    btn.dispatchEvent(new MouseEvent('mousedown', o));
    btn.dispatchEvent(new PointerEvent('pointerup', o));
    btn.dispatchEvent(new MouseEvent('mouseup', o));
    btn.dispatchEvent(new MouseEvent('click', o));
    return 'ok';
  }
  if (${JSON.stringify(kind)} === 'escape') {
    const ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true });
    document.dispatchEvent(ev); (document.activeElement || document.body).dispatchEvent(ev);
    return 'ok';
  }
  if (${JSON.stringify(kind)} === 'scrim') {
    let layer = m; while (layer && layer !== document.body) { const cs = getComputedStyle(layer); if (cs.position === 'fixed' && (parseInt(cs.zIndex, 10) || 0) >= 50) break; layer = layer.parentElement; }
    const scrim = layer ? [...layer.children].find(k => !k.contains(m)) : null;
    if (!scrim) return 'no-scrim';
    const r = scrim.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, clientX: Math.round(r.left + 2), clientY: Math.round(r.top + r.height - 4) };
    scrim.dispatchEvent(new PointerEvent('pointerdown', o));
    scrim.dispatchEvent(new MouseEvent('mousedown', o));
    scrim.dispatchEvent(new PointerEvent('pointerup', o));
    scrim.dispatchEvent(new MouseEvent('mouseup', o));
    scrim.dispatchEvent(new MouseEvent('click', o));
    return 'ok cls=' + ((scrim.className || '') + '');
  }
  return 'unknown';
})()`;

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, 'question/');
  const sid = await C.attach(api, tab.targetId || tab.id);
  console.log('结构:', JSON.stringify(await C.evalJson(api, VIS, sid), null, 1));
  const isOpen = async () => !!(await C.evalJson(api, `!![...document.querySelectorAll('.Modal-content')].find(x => x.checkVisibility && x.checkVisibility({ opacityProperty: true, visibilityProperty: true }))`, sid));
  for (const kind of ['button', 'escape', 'scrim']) {
    if (!(await isOpen())) { console.log(kind, '→ 弹层已关（前一步生效）'); break; }
    const r = await C.evalJson(api, TRY(kind), sid);
    await C.sleep(1500);
    console.log(kind.padEnd(8), r, '→ modal:', await isOpen());
  }
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
