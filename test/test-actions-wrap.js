// test-actions-wrap.js — 卡片底部「赞同」操作栏不再右侧出界（换行 + 间距/外边距修正）
// 用法: node test-actions-wrap.js             重载当前回答页并注入 src 下脚本
//       node test-actions-wrap.js --installed 测真机暴力猴里已安装的版本
//
// 背景（实测 2026-09-30，用户反馈「赞同栏右侧被遮挡了一些按钮」）：
// 知乎的 .ContentItem-actions 是 display:flex + flex-wrap:nowrap，子项**全部 flex:0 0 auto**
// （谁也不收缩，也带 24px 的 margin-left）。桌面列宽 700+ 时刚好一行；脚本把列宽压到 358 后
// 内容 565~642px ⇒ 右侧约 3 个按钮被屏幕切掉（overflow 是 visible：滚不到、点不到）。
// 另有几类卡片被知乎加了 margin: 0 -20px 的「出血」，父容器只有 326px 时出血成 366px、x=-4
// ⇒ 右端 362 仍出屏 4px。
// 断言：① 每个操作栏都已换行；② 内容不溢出（scrollWidth ≤ clientWidth）；
//       ③ 右缘在列宽内；④ 反向：按钮一个都没少、首末按钮都还有宽度（没被隐藏/压成 0）。
// ⚠️ 判别力（改前必须 FAIL）：用 `--installed` 跑修复前的 v1.3.11 时，②③ 应当报 FAIL。
'use strict';
const fs = require('fs');
const path = require('path');
const cdp = require('./cdp');

const SCRIPT = path.join(__dirname, '..', 'zhihu-desk2mob.user.js');
const INJECT_MODE = process.argv[2] !== '--installed';
const TAB_SUBSTR = 'question';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const ST = `JSON.stringify((()=>{
  const de = document.documentElement;
  const zoom = parseFloat(getComputedStyle(de).zoom) || 1;
  const visW = innerWidth / zoom;
  const all = [...document.querySelectorAll('.ContentItem-actions')].map(el => {
    const r = el.getBoundingClientRect();
    const kids = [...el.children];
    const g = k => { const b = k.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
    const visible = kids.filter(k => { const b = k.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
    // ⚠️ 容器自身的 rect.right 恒等于列宽（溢出的是**内容**），拿它断言没有判别力 ——
    //    改前对照实测：v1.3.11 下 5 个栏的 right 全是 358 却各自溢出 206~274px。
    //    真正能反映「按钮被裁」的是**最右子项**的右缘。
    const maxKidRight = kids.length ? Math.max(...kids.map(k => k.getBoundingClientRect().right)) : 0;
    return {
      cls: (el.className || '').toString().replace(/\\s+/g, ' ').slice(0, 44),
      wrap: getComputedStyle(el).flexWrap,
      cw: el.clientWidth, sw: el.scrollWidth,
      overflow: Math.round(el.scrollWidth - el.clientWidth),
      right: Math.round(r.right),
      maxKidRight: Math.round(maxKidRight),
      kids: kids.length, kidsVisible: visible.length,
      firstW: kids.length ? g(kids[0]).w : 0,
      lastW: kids.length ? g(kids[kids.length - 1]).w : 0,
      txt: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40)
    };
  });
  return { url: location.href, visW: Math.round(visW), z2m: !!document.getElementById('z2m-style'), n: all.length, all };
})())`;

(async () => {
  const code = fs.readFileSync(SCRIPT, 'utf8');
  console.log('脚本: ' + SCRIPT.split(/[\\/]/).pop() + '  [' + (INJECT_MODE ? '注入模式' : '已安装版本') + ']');
  const api = await cdp.browserApi();
  try {
    const tab = await cdp.findTab(api, TAB_SUBSTR) || await cdp.findTab(api);
    if (!tab) throw new Error('未找到知乎回答/问题页标签（请先在真机上打开一个）');
    const sid = await cdp.attach(api, tab.targetId);
    console.log('目标: ' + tab.url);
    await api.send('Page.navigate', { url: tab.url }, sid);
    await cdp.waitReady(api, sid, 30);
    await cdp.sleep(3500);
    if (INJECT_MODE) {
      const r = await cdp.evalJs(api, `(()=>{ try { ${code}\n; return 'injected'; } catch(e){ return 'ERR:' + e.message; } })()`, sid);
      console.log('注入 -> ' + JSON.stringify(r && r.value));
      await cdp.sleep(2500);
    }
    const s = await cdp.evalJson(api, ST, sid);

    console.log('\n列宽=' + s.visW + '  操作栏实例=' + s.n);
    for (const a of s.all) {
      console.log('  [' + a.wrap + '] cw=' + a.cw + ' sw=' + a.sw + ' 溢出=' + a.overflow
        + ' 最右按钮=' + a.maxKidRight + ' 按钮=' + a.kidsVisible + '/' + a.kids + '  ' + JSON.stringify(a.cls)
        + '  ' + JSON.stringify(a.txt));
    }
    console.log('');

    ok(s.z2m, '脚本已生效（#z2m-style 存在）');
    ok(s.n > 0, '找到操作栏实例（回答页应有 1 个以上）', { n: s.n });
    ok(s.all.every(a => a.wrap === 'wrap'), '每个操作栏都已允许换行', s.all.map(a => a.wrap));
    ok(s.all.every(a => a.overflow <= 1), '每个操作栏的内容都不溢出（scrollWidth ≤ clientWidth）',
      s.all.map(a => a.overflow).filter(x => x > 1));
    ok(s.all.every(a => a.maxKidRight <= s.visW + 1), '每个操作栏的最右按钮都在列宽内（没被屏幕裁掉）',
      s.all.map(a => ({ maxKidRight: a.maxKidRight, visW: s.visW })).filter(x => x.maxKidRight > x.visW + 1));
    ok(s.all.every(a => a.kidsVisible === a.kids), '反向：栏内按钮一个都没少（没有靠隐藏来消溢出）',
      s.all.map(a => a.kidsVisible + '/' + a.kids));
    ok(s.all.every(a => a.firstW > 0 && a.lastW > 0), '反向：首末按钮都还有宽度（没被压成 0）',
      s.all.map(a => [a.firstW, a.lastW]));

    await cdp.shot(api, sid, 'shots/32-actions-wrap.png', 8000);
    console.log('\n截图: shots/32-actions-wrap.png');
    console.log('\n===== 结果: ' + pass + ' passed / ' + fail + ' failed =====');
  } finally {
    api.close();
  }
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
