// cdp.js — 转发到技能目录里的 CDP 工具库本体。
//
// 为什么只放转发而不是复制一份：这份库是「通用能力」，随技能
// `.workbuddy/skills/kiwi-violentmonkey-cdp/` 一起分发（技能要能独立拿走使用）。
// 仓库里若再存一份副本，两边迟早不同步；所以这里只有一行转发，
// 保证全仓库只有**一份实现**。
//
// 本目录的测试都用 `require('./cdp')`，因此脚本可以整体拷走单独运行 ——
// 前提是 `../.workbuddy/skills/kiwi-violentmonkey-cdp/scripts/cdp.js` 存在。
'use strict';
module.exports = require('../.workbuddy/skills/kiwi-violentmonkey-cdp/scripts/cdp.js');
