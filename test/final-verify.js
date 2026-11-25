// final-verify.js — 真机最终确认：在用户实际打开的 tab 上，用【真返回键】跑验收路径
// 与 e2e-accept.js 的区别：返回用 adb keyevent 4（真实系统返回），不是 history.back()
'use strict';
const C = require('./cdp-local');

const clean = `const clean = s => (s || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').trim();`;
const ST = `(() => { ${clean}
  return {
    state: history.state,
    url: location.href,
    modalVis: [...document.querySelectorAll('.Modal-content')].filter(m => m.checkVisibility && m.checkVisibility({ opacityProperty: true, visibilityProperty: true })).length,
    arrows: [...document.querySelectorAll('svg[class*="ArrowLeft"]')].filter(s => s.getBoundingClientRect().width > 8).length,
    viewAll: [...document.querySelectorAll('button')].filter(b => clean(b.textContent).startsWith('查看全部') && b.getBoundingClientRect().width > 0).length,
    v: window.__z2mVersion, inst: window.__z2mInst,
    log: (window.__z2mLog || []).slice(-6),
  };
})()`;

let api, tab, sid;
async function reattach() {
  try { require('child_process').execSync('adb forward tcp:9222 localabstract:chrome_devtools_remote'); } catch (e) {}
  await C.sleep(600);
  api = await C.browserApi();
  const ts = await C.getTargets(api);
  const cands = ts.filter(t => t.type === 'page' && (t.url || '').includes(process.env.TAB_FILTER || 'question/655443488'));
  if (!cands.length) throw new Error('tab gone after hw-back');
  for (const c of cands) {
    const s2 = await C.attach(api, c.targetId);
    const v = await C.evalJson(api, 'window.__z2mVersion || null', s2).catch(() => null);
    if (v) { tab = c; sid = s2; return sid; }
    try { api.ws.send(JSON.stringify({ id: 999999, method: 'Target.detachFromTarget', params: { sessionId: s2 } })); } catch (e) {}
  }
  sid = await C.attach(api, cands[0].targetId);
  tab = cands[0];
  return sid;
}
(async () => {
  api = await C.browserApi();
  const ts0 = await C.getTargets(api);
  const cands0 = ts0.filter(t => t.type === 'page' && (t.url || '').includes(process.env.TAB_FILTER || 'question/655443488'));
  if (!cands0.length) { console.log('no tab'); process.exit(1); }
  tab = cands0[0]; sid = await C.attach(api, tab.targetId);
  // 若第一个不是脚本生效的 tab，换成生效的
  const v0 = await C.evalJson(api, 'window.__z2mVersion || null', sid).catch(() => null);
  if (!v0) {
    for (const c of cands0) {
      const s2 = await C.attach(api, c.targetId);
      const v2 = await C.evalJson(api, 'window.__z2mVersion || null', s2).catch(() => null);
      if (v2) { tab = c; sid = s2; break; }
    }
  }
  await api.send('Page.bringToFront', {}, sid).catch(() => {});
  const S = async (tag) => { const r = await C.evalJson(api, ST, sid); console.log('[' + tag + ']', JSON.stringify({ st: r.state ? Object.keys(r.state)[0] : null, mv: r.modalVis, ar: r.arrows, url: r.url.slice(30, 56) })); return r; };
  const hwBack = async (ms) => {
    const before = await C.evalJson(api, 'JSON.stringify({s:history.state,mv:[...document.querySelectorAll(".Modal-content")].filter(m=>m.checkVisibility&&m.checkVisibility({opacityProperty:true,visibilityProperty:true})).length,ar:[...document.querySelectorAll("svg[class*=ArrowLeft]")].filter(s=>s.getBoundingClientRect().width>8).length})', sid).catch(() => null);
    require('child_process').execSync('adb shell input keyevent 4');
    await C.sleep(1600);
    let after = await C.evalJson(api, 'JSON.stringify({s:history.state,mv:[...document.querySelectorAll(".Modal-content")].filter(m=>m.checkVisibility&&m.checkVisibility({opacityProperty:true,visibilityProperty:true})).length,ar:[...document.querySelectorAll("svg[class*=ArrowLeft]")].filter(s=>s.getBoundingClientRect().width>8).length})', sid).catch(() => null);
    // 没变化 → keyevent 可能没被消费，重发一次
    if (before && after && before === after) {
      console.log('  (keyevent 未消费，重发)');
      require('child_process').execSync('adb shell input keyevent 4');
      await C.sleep(ms || 2500);
    } else {
      await C.sleep(Math.max(0, (ms || 2500) - 1600));
    }
    try { await reattach(); await api.send('Page.bringToFront', {}, sid); await C.sleep(400); } catch (e) { console.log('  (reattach failed: ' + e.message + ')'); }
  };

  await api.send('Page.bringToFront', {}, sid);
  await C.sleep(1500);
  // 新开的 tab 可能脚本尚未生效（innerWidth 判定 / 注入延迟），等 __z2mVersion 出现
  let v = null;
  for (let i = 0; i < 20; i++) {
    v = await C.evalJson(api, 'window.__z2mVersion || null', sid).catch(() => null);
    if (v) break;
    if (i === 6) { // 8s 还没有就 reload 一次
      await api.send('Page.enable', {}, sid).catch(() => {});
      await api.send('Page.reload', {}, sid).catch(() => {});
    }
    await C.sleep(1500);
  }
  console.log('=== 真机最终确认（真返回键）===');
  const s0 = await S('0 当前状态');
  console.log('    版本:', v, '实例:', await C.evalJson(api, 'window.__z2mInst', sid).catch(() => '?'));

  // 若弹层已开则先收干净
  if (s0.modalVis || s0.arrows) { console.log('  （弹层残留，先复位）'); }

  // 步骤1 开弹层
  await api.send('Page.bringToFront', {}, sid).catch(() => {});
  await C.sleep(400);
  console.log(await C.evalJson(api, `(() => { ${clean}
    const b = [...document.querySelectorAll('button')].find(x => /^\\d+\\s*条评论$/.test(clean(x.textContent)) && x.getBoundingClientRect().width > 0);
    if (!b) return 'nf'; b.click(); return 'opened';
  })()`, sid));
  await C.sleep(7000);
  const s1 = await S('1 弹层');
  if (s1.modalVis !== 1) {
    console.log('  (弹层未开，等 8s 重试一次)');
    await C.sleep(8000);
    console.log(await C.evalJson(api, `(() => { ${clean}
      const b = [...document.querySelectorAll('button')].find(x => /^\\d+\\s*条评论$/.test(clean(x.textContent)) && x.getBoundingClientRect().width > 0);
      if (!b) return 'nf'; b.click(); return 'opened';
    })()`, sid));
    await C.sleep(7000);
  }

  // 步骤2 进线程
  await api.send('Page.bringToFront', {}, sid).catch(() => {});
  await C.sleep(300);
  console.log(await C.evalJson(api, `(() => { ${clean}
    const b = [...document.querySelectorAll('button')].find(x => clean(x.textContent).startsWith('查看全部') && x.getBoundingClientRect().width > 0);
    if (!b) return 'nf'; b.click(); return 'thread';
  })()`, sid));
  await C.sleep(4000);
  const s2 = await S('2 线程');
  console.log(s2.arrows === 1 ? '  PASS 进入线程' : '  FAIL 未进入线程');

  // 步骤3 真返回键 → 列表
  await hwBack();
  const s3 = await S('3 返回');
  console.log(s3.arrows === 0 && s3.modalVis === 1 ? '  PASS 回到列表' : '  FAIL 未回列表', JSON.stringify({ ar: s3.arrows, mv: s3.modalVis }));

  // 步骤4 再进
  await api.send('Page.bringToFront', {}, sid).catch(() => {});
  await C.sleep(300);
  console.log(await C.evalJson(api, `(() => { ${clean}
    const b = [...document.querySelectorAll('button')].find(x => clean(x.textContent).startsWith('查看全部') && x.getBoundingClientRect().width > 0);
    if (!b) return 'nf'; b.click(); return 'thread2';
  })()`, sid));
  await C.sleep(4000);
  const s4 = await S('4 再进');
  console.log(s4.arrows === 1 ? '  PASS 再次能进线程' : '  FAIL 第二次点不动');

  // 步骤5 真返回 → 列表
  await hwBack();
  const s5 = await S('5 返回');
  console.log(s5.arrows === 0 && s5.modalVis === 1 ? '  PASS 回到列表' : '  FAIL 未回列表');

  // 步骤6 真返回 → 关弹层，仍在问答页（关键项）
  await hwBack(3500);
  const s6 = await S('6 返回(关弹层)');
  const pass6 = s6.modalVis === 0 && s6.url.includes('zhihu.com/question');
  console.log(pass6 ? '  PASS 弹层关闭且仍在问答页' : '  FAIL 6b 退出/未关', JSON.stringify({ mv: s6.modalVis, url: s6.url.slice(30, 56) }));

  console.log('\n=== 结论:', pass6 ? '真机确认 OK' : '仍有问题', '===');
  api.close();
  process.exit(pass6 ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
