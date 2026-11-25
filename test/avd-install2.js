// avd-install2.js — AVD Kiwi 装 1.9.28（skill 流程：防缓存URL → confirm 自动点击）
'use strict';
const { execSync } = require('child_process');
const C = require('./cdp-local');
const ADB = 'D:/Software/Android/SDK/platform-tools/adb.exe';
const run = c => { try { execSync(c, { stdio: ['ignore','pipe','ignore'], timeout: 20000 }); } catch(e){} };
const sleep = C.sleep;

(async () => {
  run(`${ADB} start-server`);
  run(`${ADB} -s emulator-5554 forward tcp:9222 localabstract:chrome_devtools_remote`);
  run(`${ADB} -s emulator-5554 reverse tcp:8099 tcp:8099`);
  await sleep(1500);

  const api = await C.browserApi();
  // 关掉旧的 8099 标签
  const old = (await C.getTargets(api)).filter(x => x.type === 'page' && (x.url||'').includes('8099'));
  for (const o of old) { try { await api.send('Target.closeTarget', { targetId: o.targetId }); } catch(e){} }
  await sleep(800);

  // 防缓存 URL 开新标签
  await api.send('Target.createTarget', { url: 'http://localhost:8099/zhihu-desk2mob.user.js?t=' + Date.now() });
  await sleep(9000);

  const cts = (await C.getTargets(api)).filter(x => x.type === 'page' && ((x.url||'').includes('confirm')));
  console.log('confirm tabs:', cts.length);
  if (!cts.length) {
    const pages = (await C.getTargets(api)).filter(x => x.type === 'page').map(x => (x.url||'').slice(0,45));
    console.log('pages:', pages.join(' | ').slice(0,200));
    process.exit(1);
  }
  const sid = await C.attach(api, cts[0].targetId);
  await api.send('Page.bringToFront', {}, sid);
  await sleep(500);
  console.log('安装页:', await C.evalJson(api, 'document.body.innerText.slice(0,60)', sid));
  let clicked = false;
  for (let j = 0; j < 8; j++) {
    const r = await Promise.race([
      C.evalJson(api, `(() => {
        const b = [...document.querySelectorAll('button')].find(x => ['安装','重装','Install','Reinstall'].some(k => (x.innerText||'').trim().startsWith(k)));
        if (b) { b.click(); return 'clicked ' + (b.innerText||'').trim(); }
        return 'nf';
      })()`, sid),
      new Promise((_,j)=>setTimeout(()=>j(new Error('timeout')), 9000)),
    ]);
    console.log('try', j, r);
    if (String(r).startsWith('clicked')) { clicked = true; break; }
    await sleep(1500);
  }
  // 清理 confirm 标签
  for (const t of (await C.getTargets(api)).filter(x => (x.url||'').includes('confirm'))) {
    try { await api.send('Target.closeTarget', { targetId: t.targetId }); } catch(e){}
  }
  console.log(clicked ? 'INSTALL DONE' : 'INSTALL FAILED');
  process.exit(clicked ? 0 : 1);
})().catch(e => { console.error('ERR', e.message.slice(0,80)); process.exit(1); });
