// cdp.js — 转发到 test/lib/cdp.js（CDP 工具库本体）。
//
// 历史说明：本库原先随 `.workbuddy/skills/kiwi-violentmonkey-cdp/` 技能分发，
// 2026-11 该技能已迁移到独立仓库 leoshone/skills（github.com/leoshone/skills，
// 含 avd-boot / avd-install-apk / browser-extension-install /
// violentmonkey-script-install 四个 skill），项目内技能目录随之删除。
// 脚本测试仍依赖这份 Node 实现，故实现本体落回
// `test/lib/cdp.js`（项目内），方法论/流程文档看 Skills 仓库的 skill。
//
// 本目录的测试都用 `require('./cdp')`，因此脚本可以整体拷走单独运行 ——
// 前提是 `./lib/cdp.js` 存在。
'use strict';
module.exports = require('./lib/cdp.js');
