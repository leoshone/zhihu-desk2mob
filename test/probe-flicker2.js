// probe-flicker2.js — 逐帧记录吸底栏几何/类状态，量化「闪烁」的形态；并查知乎样式表 is-fixed 规则
'use strict';
const cdp = require('./cdp');

const INSTALL = `JSON.stringify((()=>{
  const s = document.querySelector('.ContentItem-actions.Sticky');
  if (!s) return { err: 'no sticky bar' };
  const frames = [];
  let running = true;
  const rec = () => {
    if (!running || frames.length > 900) return;
    const r = s.getBoundingClientRect();
    const cs = getComputedStyle(s);
    frames.push({ t: performance.now()|0, top: Math.round(r.top), b: Math.round(r.bottom),
                  h: Math.round(r.height), w: Math.round(r.width),
                  fixed: s.classList.contains('is-fixed'), vis: cs.visibility, disp: cs.display,
                  pos: cs.position, op: cs.opacity });
    requestAnimationFrame(rec);
  };
  requestAnimationFrame(rec);
  window.__fr = { frames, stop: () => { running = false; } };
  return { started: true };
})())`;

const REPORT = `JSON.stringify((()=>{
  const F = window.__fr.frames;
  window.__fr.stop();
  // 找出「几何/类突变」的帧：与前一帧相比 top 变化 > 4px 或 is-fixed 切换或宽度变化 > 4px
  const jumps = [];
  for (let i = 1; i < F.length; i++) {
    const a = F[i-1], b = F[i];
    if (Math.abs(a.top - b.top) > 4 || a.fixed !== b.fixed || Math.abs(a.w - b.w) > 4 || a.vis !== b.vis || a.op !== b.op) {
      jumps.push({ i, t: b.t, from: { top: a.top, b: a.b, w: a.w, fixed: a.fixed, vis: a.vis, op: a.op },
                         to:   { top: b.top, b: b.b, w: b.w, fixed: b.fixed, vis: b.vis, op: b.op } });
    }
  }
  return { n: F.length, dur: F.length ? ((F[F.length-1].t - F[0].t)/1000).toFixed(1) : 0,
           jumps: jumps.slice(0, 80), jumpCount: jumps.length,
           first: F[0], last: F[F.length-1] };
})())`;

const RULES = `JSON.stringify((()=>{
  const out = [];
  for (const ss of document.styleSheets) {
    let rules; try { rules = [...ss.cssRules]; } catch (e) { continue; }
    const walk = (rs) => {
      for (const r of rs) {
        if (r.cssRules) { walk(r.cssRules); continue; }
        const sel = r.selectorText || '';
        if (/is-fixed|is-bottom|RichContent-actions|ContentItem-actions/.test(sel) && /Sticky|is-/.test(sel + (r.parentRule && r.parentRule.selectorText || ''))) {
          out.push({ sel, css: r.style.cssText.slice(0, 300) });
        }
      }
    };
    walk(rules);
  }
  return out.filter(x => /Sticky|is-fixed|is-bottom/.test(x.sel)).slice(0, 30);
})())`;

(async () => {
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, process.argv[2] || 'answer');
    if (!tab) { console.log('NO matching tab'); return; }
    await api.send('Target.activateTarget', { targetId: tab.targetId });
    await cdp.sleep(400);
    const sid = await cdp.attach(api, tab.targetId);
    await cdp.waitReady(api, sid);
    const inst = await cdp.evalJson(api, INSTALL, sid);
    console.log('install:', JSON.stringify(inst));
    // 滚动复现：小幅上下滑动（模拟用户操作）
    for (const dy of [-120, 80, -80, 80, -80, 40]) {
      await cdp.evalJs(api, `scrollBy(0, ${dy})`, sid);
      await cdp.sleep(300);
    }
    await cdp.sleep(500);
    const rep = await cdp.evalJson(api, REPORT, sid);
    console.log(`frames=${rep.n} dur=${rep.dur}s jumpCount=${rep.jumpCount}`);
    console.log('first frame:', JSON.stringify(rep.first));
    console.log('last  frame:', JSON.stringify(rep.last));
    console.log('--- 突变帧（前 40）---');
    (rep.jumps || []).slice(0, 40).forEach(j => console.log(JSON.stringify(j)));
    console.log('--- 知乎样式表中 Sticky/is-fixed 相关规则 ---');
    const rules = await cdp.evalJson(api, RULES, sid);
    (rules || []).forEach(r => console.log(r.sel, '=>', r.css));
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
