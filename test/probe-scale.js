// probe-scale.js — 逐个标签量出「屏上换算因子」(zoom × scale) 与正文字的屏上 px
// 用途：给 `CFG.textScale` 定值 / 复核。用户手动捏合到满意大小后，用它把那个大小量成因子。
// 用法: node probe-scale.js
// ⚠️ 会**依次激活每个标签**（冻结的后台标签会让 attach 永久挂起），因此会把用户当前标签顶掉；
//    若随后抓屏，抓到的可能已不是原来那个页面。
'use strict';
const cdp = require('./cdp');

const S = `JSON.stringify((()=>{
  const z = parseFloat(document.documentElement.style.zoom) || 1;
  const vv = window.visualViewport;
  const s = vv ? vv.scale : 1;
  const el = document.querySelector('.RichContent, .RichText, .Post-RichText, .CommentContent');
  const css = el ? parseFloat(getComputedStyle(el).fontSize) : null;
  return {
    url: location.href,
    hasStyle: !!document.getElementById('z2m-style'),
    zoom: +z.toFixed(5), scale: +s.toFixed(5),
    factor: +(z * s).toFixed(5),                       // 屏上换算因子（= 期望的 textScale）
    bodyCssPx: css,
    bodyOnScreenPx: css ? +(css * z * s).toFixed(2) : null,
  };
})())`;

(async () => {
  const api = await cdp.browserApi();
  try {
    const pages = (await cdp.getTargets(api)).filter(t => t.type === 'page');
    for (const t of pages) {
      try {
        const sid = await cdp.attach(api, t.targetId);      // attach 内部会先激活（冻结标签会挂）
        const d = await cdp.evalJson(api, S, sid, 8000);
        console.log(JSON.stringify(d));
      } catch (e) {
        console.log(JSON.stringify({ url: t.url, err: e.message.slice(0, 60) }));
      }
    }
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
