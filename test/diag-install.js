// 诊断：为什么 confirm 页不再触发
const { execSync } = require('child_process');
const CDP = require('./lib/cdp.js');
const ADB = 'D:/Software/Android/SDK/platform-tools/adb.exe';
const run = (c) => { try { return execSync(c, { stdio: ['ignore','pipe','ignore'] }).toString(); } catch (e) { return ''; } };

(async () => {
  run(`${ADB} forward --remove tcp:9222`); run(`${ADB} forward tcp:9222 localabstract:chrome_devtools_remote`);
  const api = await CDP.browserApi();
  for (const t of (await CDP.getTargets(api)).filter(t => t.type === 'page' && (t.url || '').includes('8899'))) {
    try { await api.send('Target.closeTarget', { targetId: t.targetId }); } catch (e) {}
  }
  await api.send('Target.createTarget', { url: 'http://127.0.0.1:8899/zhihu-desk2mob.user.js' });
  await CDP.sleep(7000);
  const ts = (await CDP.getTargets(api)).filter(t => t.type === 'page');
  for (const t of ts) console.log(t.type.slice(0,5), (t.url || '').slice(0, 80));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
