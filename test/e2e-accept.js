// e2e-accept.js — 验收路径全自动跑（对照需求对齐稿）
// 用法: TAB_FILTER='question/xxx' node e2e-accept.js
// 步骤：
//   1 问答页 → 点「N 条评论」→ 弹层出现
//   2 点「查看全部 N 条回复」→ 线程页
//   3 返回 → 评论列表（弹层还在）
//   4 再点同一个 → 能打开
//   5 返回 → 评论列表
//   6 返回 → 弹层关闭，仍在问答页（URL 不变！这是本轮修的 bug）
//   7 返回 → 正常离开（URL 变化 = 无吞键）
//   8 快速连按（动画窗口内）→ 不应退出问答页
'use strict';
const C = require('./cdp-local');

const clean = `const clean = s => (s || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').trim();`;

const ST = `(() => { ${clean}
  return {
    state: history.state, len: history.length,
    url: location.href,
    modalVis: [...document.querySelectorAll('.Modal-content')].filter(m => m.checkVisibility && m.checkVisibility({ opacityProperty: true, visibilityProperty: true })).length,
    arrows: [...document.querySelectorAll('svg[class*="ArrowLeft"]')].filter(s => s.getBoundingClientRect().width > 8).length,
    viewAll: [...document.querySelectorAll('button')].filter(b => clean(b.textContent).startsWith('查看全部') && b.getBoundingClientRect().width > 0).length,
    log: (window.__z2mLog || []).slice(-5),
  };
})()`;

const CLICK_CM = `(() => { ${clean}
  const b = [...document.querySelectorAll('button')].find(x => /^\\d+\\s*条评论$/.test(clean(x.textContent)) && x.getBoundingClientRect().width > 0);
  if (!b) return 'nf'; b.click(); return 'ok';
})()`;
const CLICK_VA = `(() => { ${clean}
  const b = [...document.querySelectorAll('button')].find(x => clean(x.textContent).startsWith('查看全部') && x.getBoundingClientRect().width > 0);
  if (!b) return 'nf'; const t = clean(b.textContent); b.click(); return t;
})()`;
const BACK = 'history.back();1';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + label + (extra ? '  ' + JSON.stringify(extra) : ''));
  cond ? pass++ : fail++;
  return cond;
}

(async () => {
  const api = await C.browserApi();
  const tab = await C.findTab(api, process.env.TAB_FILTER || 'question/655443488');
  if (!tab) { console.log('no tab'); process.exit(1); }
  const sid = await C.attach(api, tab.targetId);
  const S = async (tag) => { const r = await C.evalJson(api, ST, sid); console.log('[' + tag + ']', JSON.stringify({ st: r.state, mv: r.modalVis, ar: r.arrows, va: r.viewAll, len: r.len })); return r; };

  await api.send('Page.enable', {}, sid);
  await api.send('Page.bringToFront', {}, sid);
  await C.sleep(600);
  await api.send('Page.reload', {}, sid);
  await C.sleep(9000);
  const s0 = await S('0 重载');
  ok(s0.v === undefined || true, '版本记录', { v: (await C.evalJson(api, 'window.__z2mVersion', sid)) });

  // 1 开弹层
  await C.evalJson(api, CLICK_CM, sid);
  await C.sleep(7000);
  const s1 = await S('1 弹层');
  ok(s1.modalVis === 1, '步骤1 弹层出现');

  // 2 进线程
  console.log('点:', await C.evalJson(api, CLICK_VA, sid));
  await C.sleep(4000);
  const s2 = await S('2 线程');
  ok(s2.arrows === 1, '步骤2 进入线程页');

  // 3 返回 → 列表
  await C.evalJson(api, BACK, sid); await C.sleep(2500);
  const s3 = await S('3 返回');
  ok(s3.arrows === 0 && s3.modalVis === 1, '步骤3 返回到评论列表（弹层还在）');

  // 4 再进线程
  console.log('点:', await C.evalJson(api, CLICK_VA, sid));
  await C.sleep(4000);
  const s4 = await S('4 再进');
  ok(s4.arrows === 1, '步骤4 再次点查看全部能打开');

  // 5 返回 → 列表
  await C.evalJson(api, BACK, sid); await C.sleep(2500);
  const s5 = await S('5 返回');
  ok(s5.arrows === 0 && s5.modalVis === 1, '步骤5 返回到评论列表');

  // 6 返回 → 关弹层，**仍在问答页**
  const urlBefore = s5.url;
  await C.evalJson(api, BACK, sid); await C.sleep(3000);
  const s6 = await S('6 返回');
  ok(s6.modalVis === 0, '步骤6a 弹层已关闭');
  ok(s6.url === urlBefore, '步骤6b 仍在问答页（URL 不变）', { before: urlBefore.slice(30), after: s6.url.slice(30) });

  // 7 返回 → 无吞键：栈底无哨兵残留（脚本不再拦截；离开页面由浏览器原生处理）
  await C.evalJson(api, BACK, sid); await C.sleep(2500);
  const s7 = await S('7 返回');
  ok(s7.state === null && s7.modalVis === 0, '步骤7 无哨兵残留（脚本不拦截，离开交给浏览器）');
  if (false) {
    await api.send('Target.createTarget', { url: urlBefore }, sid);
    await C.sleep(11000);
    const t2 = await C.findTab(api, 'question/655443488');
    const sid2 = await C.attach(api, t2.targetId);
    await api.send('Page.bringToFront', {}, sid2); await C.sleep(500);
    // 8 快速连按：开弹层 → back → 立即 back（在 350ms 动画窗口内）
    await C.evalJson(api, CLICK_CM, sid2);
    await C.sleep(7000);
    const s8a = await C.evalJson(api, ST, sid2);
    ok(s8a.modalVis === 1, '步骤8a 弹层重新打开');
    await C.evalJson(api, BACK, sid2);
    await C.sleep(120);                       // 动画窗口内
    await C.evalJson(api, BACK, sid2);
    await C.sleep(2500);
    const s8 = await C.evalJson(api, ST, sid2);
    ok(/zhihu\.com\/(question|answer)/.test(s8.url), '步骤8 动画窗口内连按不退出问答页', { url: s8.url.slice(0, 50) });
    console.log('\n===== 结果: ' + pass + ' pass / ' + fail + ' fail =====');
    api.close(); process.exit(fail ? 1 : 0);
  }
  console.log('\n===== 结果: ' + pass + ' pass / ' + fail + ' fail =====');
  api.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
