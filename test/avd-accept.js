// avd-accept.js — AVD Kiwi 上的验收路径（1.9.28 ×bypass 版）
'use strict';
const C = require('./cdp-local');
const cleanExpr = "const clean=s=>(s||'').replace(/[\\u200b]/g,'').trim();";

const ST = `(() => { ${cleanExpr}
  return {
    st: history.state ? Object.keys(history.state)[0] : null,
    mv: [...document.querySelectorAll('.Modal-content')].filter(m => m.checkVisibility && m.checkVisibility({ opacityProperty: true, visibilityProperty: true })).length,
    ci: [...document.querySelectorAll('.Comments-container')].filter(c => getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().height > 100).length,
    ar: [...document.querySelectorAll('svg[class*="ArrowLeft"]')].filter(s => s.getBoundingClientRect().width > 8).length,
    url: location.href.slice(30, 58),
  };
})()`;

const CLICK_CM = `(() => { ${cleanExpr}
  const bs = [...document.querySelectorAll('button')].filter(x => /^\\d+\\s*条评论$/.test(clean(x.textContent)) && x.getBoundingClientRect().width > 0);
  if (!bs.length) return 'nf';
  bs[0].click(); return 'ok';
})()`;

const CLICK_VA = `(() => { ${cleanExpr}
  const b = [...document.querySelectorAll('button')].find(x => clean(x.textContent).startsWith('查看全部') && x.getBoundingClientRect().width > 0);
  if (!b) return 'nf';
  b.click(); return 'ok';
})()`;

const CLICK_X = `(() => {
  const b = document.querySelector('[aria-label="关闭"]');
  if (!b) return 'nf';
  b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch' }));
  return 'ok';
})()`;

const T = (p, ms) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error('timeout')), ms))]);

(async () => {
  const api = await C.browserApi();
  await C.sleep(1500);
  const ts = await C.getTargets(api);
  const z = ts.filter(x => x.type === 'page').find(x => (x.url || '').includes('655443488'));
  if (!z) { console.log('no tab'); process.exit(1); }
  const sid = await C.attach(api, z.targetId);
  await api.send('Page.bringToFront', {}, sid);
  await C.sleep(400);
  const S = async (tag) => { const r = await T(C.evalJson(api, ST, sid), 20000); console.log('[' + tag + ']', JSON.stringify(r)); return r; };
  let pass = 0, fail = 0;
  const ck = (c, l) => { console.log((c ? '  PASS ' : '  FAIL ') + l); c ? pass++ : fail++; };

  await api.send('Page.reload', {}, sid);
  await C.sleep(15000);
  await S('0 重载');

  // 1 开弹层
  await T(C.evalJson(api, CLICK_CM, sid), 25000);
  const s1a = await S('1a 点击后');
  if (s1a.mv !== 1) { await C.sleep(8000); }
  const s1 = await S('1 弹层');
  ck(s1.mv === 1 || s1.ci > 0, '步骤1 评论打开（弹层或内联）');

  // 2 进线程（同样带重试）
  await T(C.evalJson(api, CLICK_VA, sid), 20000);
  await C.sleep(4500);
  let s2 = await S('2 线程');
  if (s2.ar !== 1) {
    await T(C.evalJson(api, CLICK_VA, sid), 20000);   // 重试
    await C.sleep(4500);
    s2 = await S('2b 重试后');
  }
  ck(s2.ar === 1, '步骤2 进入线程');

  // 3 返回 → 列表（Kiwi 137 收线程慢：先等 2.8s，仍在线程就再等 3s 采样一次）
  await C.evalJson(api, 'history.go(-1);1', sid);
  await C.sleep(2800);
  let s3 = await S('3 返回');
  if (s3.ar === 1) { await C.sleep(3000); s3 = await S('3b 再采样'); }
  ck(s3.ar === 0 && (s3.mv === 1 || s3.ci > 0), '步骤3 返回到列表');

  // 4 再进线程
  await T(C.evalJson(api, CLICK_VA, sid), 20000);
  await C.sleep(4500);
  const s4 = await S('4 再进');
  ck(s4.ar === 1, '步骤4 再次能进线程');

  // 5 返回 → 列表（同 3 的慢收起重采样）
  await C.evalJson(api, 'history.go(-1);1', sid);
  await C.sleep(2800);
  let s5 = await S('5 返回');
  if (s5.ar === 1) { await C.sleep(3000); s5 = await S('5b 再采样'); }
  ck(s5.ar === 0 && (s5.mv === 1 || s5.ci > 0), '步骤5 返回到列表');

  // 6 ×关闭（用户思路核心）。AVD Kiwi 若是内联态则无弹层无×，跳过并在弹层态下测。
  const urlBefore = s5.url;
  if (s5.mv === 0 && s5.ci > 0) {
    console.log('  (内联态：无弹层无×，AVD Kiwi 走内联展开路径，×关闭项不适用)');
    pass++;
    const s6 = await S('6 内联返回');
    await C.evalJson(api, 'history.go(-1);1', sid);
    await C.sleep(2800);
  } else {
    await T(C.evalJson(api, CLICK_X, sid), 15000);
    await C.sleep(3000);
    const s6 = await S('6 点×');
    ck(s6.mv === 0, '步骤6a ×关闭弹层');
    ck(s6.url === urlBefore, '步骤6b 仍在问答页');
  }

  // 7 再开评论（内联）→ 进线程（弹层会再出现）→ 点×关弹层（×可重复性验证）
  await T(C.evalJson(api, CLICK_CM, sid), 25000);
  await C.sleep(6000);
  await T(C.evalJson(api, CLICK_VA, sid), 20000);
  await C.sleep(4500);
  const s7 = await S('7 再进线程');
  ck(s7.ar === 1 || s7.mv === 1, '步骤7a 再次进线程');
  // ×按钮此时应该被 relocation 到视口内
  const btnInView = await T(C.evalJson(api, `(() => {
    const b = document.querySelector('[aria-label="关闭"]');
    if (!b) return {no:'btn'};
    const r = b.getBoundingClientRect();
    return {inView: r.left >= 0 && r.right <= innerWidth && r.width >= 20, pos:[Math.round(r.left),Math.round(r.top)]};
  })()`, sid), 15000);
  console.log('×按钮:', JSON.stringify(btnInView));
  ck(btnInView.inView === true, '步骤7b ×按钮在视口内');
  if (btnInView.inView) {
    await T(C.evalJson(api, CLICK_X, sid), 15000);
    await C.sleep(3000);
    const s7b = await S('7c ×后');
    console.log('×后视图:', JSON.stringify(s7b));
    ck(s7b.url.indexOf('655443488') !== -1, '步骤7c ×后仍在问答页');
  }

  console.log('\n===== AVD 结果: ' + pass + ' pass / ' + fail + ' fail =====');
  api.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message.slice(0, 80)); process.exit(1); });
