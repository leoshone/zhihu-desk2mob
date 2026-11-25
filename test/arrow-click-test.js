// arrow-click-test.js — 找出「哪个元素 + 哪种事件」真能让线程视图收起
'use strict';
const C = require('./cdp-local');

const ARROWS = `(() => {
  return [...document.querySelectorAll('svg[class*="ArrowLeft"]')].map((s, i) => {
    const r = s.getBoundingClientRect();
    const head = s.parentElement && s.parentElement.parentElement;
    const node = s.closest('.css-tpyajk') || s.closest('.css-feetku') || s.parentElement.parentElement.parentElement;
    const nr = node ? node.getBoundingClientRect() : null;
    let chain = [];
    let p = s;
    for (let k = 0; k < 5 && p; k++) {
      chain.push(p.tagName + '.' + (((p.className.baseVal !== undefined ? p.className.baseVal : p.className) || '') + '').slice(0, 22) + '|cursor:' + getComputedStyle(p).cursor);
      p = p.parentElement;
    }
    return {
      i, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      head: head ? (head.textContent || '').replace(/[\\u200b]/g, '').trim().slice(0, 8) : '',
      nodeDisp: node ? getComputedStyle(node).display : '',
      nodeRect: nr ? [Math.round(nr.top), Math.round(nr.height)] : null,
      chain,
    };
  });
})()`;

const CLICK_AT = (idx, level) => `(() => {
  const s = [...document.querySelectorAll('svg[class*="ArrowLeft"]')][${idx}];
  if (!s) return 'no-svg';
  let el = s;
  for (let k = 0; k < ${level} && el; k++) el = el.parentElement;
  if (!el) return 'no-el';
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, view: window, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  el.dispatchEvent(new MouseEvent('mousedown', o));
  el.dispatchEvent(new PointerEvent('pointerup', o));
  el.dispatchEvent(new MouseEvent('mouseup', o));
  el.dispatchEvent(new MouseEvent('click', o));
  return 'dispatched on ' + el.tagName + '.' + (((el.className || '') + '')).slice(0, 24);
})()`;

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, '/answer/');
  const sid = await C.attach(api, tab.targetId || tab.id);
  const threadOpen = async () => (await C.evalJson(api, `[...document.querySelectorAll('svg[class*="ArrowLeft"]')].filter(s => s.getBoundingClientRect().width > 8).length`, sid)) > 0;

  console.log('箭头候选:', JSON.stringify(await C.evalJson(api, ARROWS, sid), null, 1));
  if (!(await threadOpen())) { console.log('当前不在线程视图'); process.exit(0); }

  // 逐一尝试：svg 本身 / 父 span / 祖父 div(cursor:pointer)
  for (const level of [0, 1, 2, 3]) {
    if (!(await threadOpen())) { console.log('level', level, '→ 已收起'); break; }
    console.log('level', level, await C.evalJson(api, CLICK_AT(0, level), sid));
    await C.sleep(1500);
    console.log('   threadOpen =', await threadOpen());
  }
  // 仍不行 → 用可信鼠标事件（CDP）点在同一位置
  if (await threadOpen()) {
    const pos = await C.evalJson(api, `(() => {
      const s = [...document.querySelectorAll('svg[class*="ArrowLeft"]')].find(x => x.getBoundingClientRect().width > 8);
      const r = s.getBoundingClientRect();
      return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
    })()`, sid);
    console.log('trusted click at', pos);
    await api.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos[0], y: pos[1], button: 'left', clickCount: 1 }, sid);
    await api.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos[0], y: pos[1], button: 'left', clickCount: 1 }, sid);
    await C.sleep(1500);
    console.log('   threadOpen =', await threadOpen());
  }
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
