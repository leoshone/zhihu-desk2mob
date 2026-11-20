// 重装脚本 + 滚动验证（自带重试；reverse/forward 每轮 shell 都会丢，先重建）
const { execSync } = require('child_process');
const CDP = require('./lib/cdp.js');
const ADB = 'D:/Software/Android/SDK/platform-tools/adb.exe';
const run = (c) => { try { return execSync(c, { stdio: ['ignore','pipe','ignore'] }).toString(); } catch (e) { return ''; } };

(async () => {
  for (let round = 0; round < 6; round++) {
    try {
      run(`${ADB} forward --remove tcp:9222`);
      run(`${ADB} forward tcp:9222 localabstract:chrome_devtools_remote`);
      run(`${ADB} reverse --remove tcp:8899`);
      run(`${ADB} reverse tcp:8899 tcp:8899`);
      await new Promise(r => setTimeout(r, 1500));
      const api = await CDP.browserApi();
      // 清 raw 页
      for (const t of (await CDP.getTargets(api)).filter(t => t.type === 'page' && (t.url || '').includes('8899'))) {
        try { await api.send('Target.closeTarget', { targetId: t.targetId }); } catch (e) {}
      }
      await api.send('Target.createTarget', { url: 'http://127.0.0.1:8899/zhihu-desk2mob.user.js' });
      await CDP.sleep(7000);
      const cts = (await CDP.getTargets(api)).filter(t => t.type === 'page' && (t.url || '').includes('confirm'));
      if (!cts.length) throw new Error('no confirm tab');
      const sid = await CDP.attach(api, cts[0].targetId);
      let ok = false;
      for (let j = 0; j < 10; j++) {
        const o = await CDP.evalJson(api, "(() => [...document.querySelectorAll('button')].map(b => (b.innerText||'').trim()).filter(Boolean))()", sid);
        if (o && o.includes('重装')) { ok = true; break; }
        await CDP.sleep(1500);
      }
      if (!ok) throw new Error('no btn');
      await CDP.evalJs(api, "(() => { [...document.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '重装').click(); return 1; })()", sid);
      await CDP.sleep(2000);
      for (const t of (await CDP.getTargets(api)).filter(t => t.type === 'page' && (t.url || '').includes('confirm'))) {
        try { await api.send('Target.closeTarget', { targetId: t.targetId }); } catch (e) {}
      }
      console.log('installed');
      const tab = (await CDP.getTargets(api)).filter(t => t.type === 'page' && (t.url || '').includes('/question/'))[0];
      const url = tab.url;
      const sid2 = await CDP.attach(api, tab.targetId);
      await api.send('Page.navigate', { url }, sid2);
      await CDP.waitReady(api, sid2);
      await CDP.sleep(6000);
      for (const y of [0, 2000, 4000, 8000, 11000, 6000]) {
        await CDP.evalJs(api, 'window.scrollTo(0, ' + y + '); 1', sid2);
        await CDP.sleep(1200);
        const o = await CDP.evalJson(api, "(() => { const s = document.querySelector('.ContentItem-actions.Sticky'); if (!s) return { y: Math.round(scrollY), gone: true }; const r = s.getBoundingClientRect(); return { y: Math.round(scrollY), atBottom: Math.abs(r.bottom - innerHeight) < 6 }; })()", sid2);
        console.log(JSON.stringify(o));
      }
      const r = await api.send('Page.captureScreenshot', { format: 'png' }, sid2);
      require('fs').writeFileSync('shots/scroll-final2.png', Buffer.from(r.data, 'base64'));
      console.log('done');
      process.exit(0);
    } catch (e) {
      console.log('round', round, 'fail:', e.message.slice(0, 60));
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  process.exit(1);
})();
