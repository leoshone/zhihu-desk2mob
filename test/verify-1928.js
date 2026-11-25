// verify-1928.js — 验证 1.9.28 的 × bypass 路径（热注入版）
'use strict';
const fs = require('fs');
const C = require('./cdp-local');
const SRC = fs.readFileSync(__dirname + '/../zhihu-desk2mob.user.js', 'utf8');

(async () => {
  const api = await C.browserApi();
  const z = await C.findTab(api, process.env.TAB_FILTER || '655443488');
  const sid = await C.attach(api, z.targetId);
  await api.send('Page.enable', {}, sid);
  await api.send('Page.bringToFront', {}, sid);
  await C.sleep(400);

  await C.evalJson(api, SRC, sid);
  await C.sleep(1200);
  console.log('inject v =', await C.evalJson(api, 'window.__z2mVersion', sid));

  // 开弹层
  console.log('开弹层:', await C.evalJson(api, `(() => {
    const clean = s => (s || '').replace(/[\\u200b]/g, '').trim();
    const bs = [...document.querySelectorAll('button')].filter(x => /^\\d+\\s*条评论$/.test(clean(x.textContent)) && x.getBoundingClientRect().width > 0);
    if (!bs.length) return 'nf';
    bs[0].click(); return 'ok';
  })()`, sid));
  await C.sleep(8000);

  console.log('弹层+×:', JSON.stringify(await C.evalJson(api, `(() => {
    const m = [...document.querySelectorAll('.Modal-content')].find(m => m.checkVisibility && m.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
    const b = document.querySelector('[aria-label="关闭"]');
    const br = b ? b.getBoundingClientRect() : null;
    return { mv: !!m, btnInView: br ? (br.left >= 0 && br.right <= innerWidth && br.width >= 20) : false };
  })()`, sid)));

  console.log('触发×:', await C.evalJson(api, `(() => {
    const b = document.querySelector('[aria-label="关闭"]');
    if (!b) return 'nf';
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch' }));
    return 'ok';
  })()`, sid));
  await C.sleep(3500);

  console.log('×后:', JSON.stringify(await C.evalJson(api, `({
    mv: [...document.querySelectorAll('.Modal-content')].filter(m => m.checkVisibility && m.checkVisibility({ opacityProperty: true, visibilityProperty: true })).length,
    st: history.state ? Object.keys(history.state)[0] : null,
    url: location.href.slice(30, 56),
    log: (window.__z2mLog || []).slice(-6),
  })`, sid)));
  api.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
