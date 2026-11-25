// serve-nocache.js — 给真机安装用的静态服务器：强制 no-store，避免暴力猴/浏览器缓存旧脚本
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8099);
http.createServer((req, res) => {
  const name = decodeURIComponent((req.url || '/').split('?')[0].replace(/^\//, '')) || 'zhihu-desk2mob.user.js';
  const file = path.join(ROOT, name);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': name.endsWith('.user.js') ? 'text/javascript; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Content-Length': body.length,
  });
  res.end(body);
}).listen(PORT, '127.0.0.1', () => console.log('serving', ROOT, 'on', PORT));
