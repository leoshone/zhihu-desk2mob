// ab-cfg-audit.js — 「过度开发排查」：逐个开关 CFG 项注入脚本，在 AVD 桌面窄列环境
// （audit-kiwi 同款 891 视口）比较 docH / 溢出数 / z2m-style 规则数 / 关键元素形态。
// 判据：关掉某项后若指标变差 → 该项必要；无变化且无视觉职责 → 嫌疑冗余。
// 用法: node ab-cfg-audit.js <url>
'use strict';
const fs = require('fs');
const path = require('path');
const cdp = require('./lib/cdp.js');

const SCRIPT_PATH = path.join(__dirname, '..', 'zhihu-desk2mob.user.js');

// 逐项开关（CFG 键名 → 注入前替换文本）
const CFG_KEYS = ['bleedEdges', 'limitZoomOut', 'commentBack', 'fixCommentLayout',
  'inlineCommentReveal', 'hideIdeaOption', 'hideCircleSync', 'fitIdeaButton',
  'fitPublishButton', 'matchComposerAvatar', 'wrapAroundThumb'];

const DIAG = `JSON.stringify((()=>{
  const overflows = [...document.querySelectorAll('body *')].filter(e=>{
    const b=e.getBoundingClientRect(); const cs=getComputedStyle(e);
    return b.width>0 && b.right > Math.min(window.innerWidth, 400) + 2 && cs.position!=='fixed' && cs.visibility!=='hidden' && cs.display!=='none';
  }).length;
  const bar = document.querySelector('.ContentItem-actions.Sticky');
  const holder = document.querySelector('.Sticky--holder');
  return { vw: innerWidth, docH: document.body.scrollHeight, docW: document.documentElement.scrollWidth,
    overflows, rules: (() => { const el = document.getElementById('z2m-style'); if (!el || !el.sheet) return 0; try { return el.sheet.cssRules.length; } catch (e) { return -1; } })(),
    bar: bar ? { pos: getComputedStyle(bar).position, bottom: bar.style.bottom || '-', clsFixed: bar.classList.contains('is-fixed') } : null,
    holderH: holder ? holder.style.height || '(none)' : null };
})())`;

(async () => {
  const url = process.argv[2] || 'https://www.zhihu.com/question/2107267149399947120/answer/2107851637251368094';
  const api = await cdp.browserApi();
  try {
    let t = await cdp.findTab(api, 'zhihu.com');
    if (!t) t = await cdp.findTab(api, '');
    const sid = await cdp.attach(api, t.targetId);
    const userJsRaw = fs.readFileSync(SCRIPT_PATH, 'utf8');

    const runOne = async (label, mutate) => {
      // 每次 navigate 重建干净状态
      await api.send('Emulation.setDeviceMetricsOverride', { width: 891, height: 1987, deviceScaleFactor: 3.0235, mobile: true }, sid);
      await api.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36' }, sid);
      let js = userJsRaw;
      if (mutate) js = mutate(js);
      await api.send('Page.navigate', { url }, sid);
      await cdp.waitReady(api, sid, 40);
      const r1 = await api.send('Runtime.evaluate', { expression: js, returnByValue: false }, sid);
      if (r1.exceptionDetails) { console.log(label, 'INJECT-EXCEPTION', JSON.stringify(r1.exceptionDetails).slice(0, 150)); }
      await cdp.sleep(5000);
      await cdp.evalJs(api, 'window.scrollTo(0, 4000)', sid);
      await cdp.sleep(2000);
      let d = await cdp.evalJson(api, DIAG, sid, 15000);
      if (typeof d === 'string') d = JSON.parse(d);
      console.log(label.padEnd(24), JSON.stringify(d));
      return d;
    };

    console.log('=== 全功能开（基线） ===');
    const base = await runOne('ALL-ON', null);

    console.log('=== 逐项关闭 ===');
    for (const key of CFG_KEYS) {
      const re = new RegExp('(\\b' + key + '\\s*:\\s*)(true|\\d+(?:\\.\\d+)?)', );
      const mutate = (js) => {
        if (!re.test(js)) return js;                     // 键不存在则跳过
        return js.replace(re, (m, p1) => p1 + (key === 'feedThumbLines' || key === 'hotThumbLines' || key === 'columnThumbLines' ? '0' : 'false'));
      };
      if (!re.test(userJsRaw)) { console.log(key.padEnd(24), 'SKIP(键不存在)'); continue; }
      await runOne('OFF:' + key, mutate);
    }

    console.log('=== 全部关闭（最小功能集=纯反缩放+单列） ===');
    const minMut = (js) => {
      let out = js;
      for (const key of CFG_KEYS) {
        const isNum = key.includes('Thumb');
        out = out.replace(new RegExp('(\\b' + key + '\\s*:\\s*)(true|\\d+(?:\\.\\d+)?)'), (m, p1) => p1 + (isNum ? '0' : 'false'));
      }
      return out;
    };
    await runOne('ALL-MIN', minMut);
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
