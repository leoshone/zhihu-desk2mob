// 静态检查：找出对 const 变量的重新赋值（含 ++/--）
'use strict';
const src = require('fs').readFileSync('zhihu-desk2mob.user.js', 'utf8');
const lines = src.split('\n');
const consts = new Set();
lines.forEach((l) => {
  const m = l.match(/^\s*const\s+([\w$, ]+)\s*=/);
  if (m) m[1].split(',').forEach(n => consts.add(n.trim().split('=')[0].trim()));
});
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
lines.forEach((l, i) => {
  if (/^\s*const/.test(l) || /^\s*for/.test(l)) return;
  consts.forEach(n => {
    const re = new RegExp('(^|[^\\w.$])' + esc(n) + '\\s*=(?!=)', 'g');
    if (re.test(l)) console.log('L' + (i + 1) + ':', n, '|', l.trim().slice(0, 90));
    const inc = new RegExp('(^|[^\\w.$])' + esc(n) + '\\s*(\\+\\+|--)', 'g');
    if (inc.test(l)) console.log('L' + (i + 1) + ' (inc):', n, '|', l.trim().slice(0, 90));
  });
});
console.log('done');
