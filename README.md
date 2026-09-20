# zhihu-desk2mob

知乎桌面版 · 手机单列适配油猴脚本。

在 Kiwi / Chrome 等浏览器开启「桌面版网站」后，把知乎**桌面版**网页重排为手机单列、以正常字号显示，保留桌面版比移动版网页多得多的功能。已在真机（1080×2400 Android）逐页验证。

## 适配范围

- 首页（`www.zhihu.com`）信息流
- 问答页（`/question/...`）问题与回答、评论
- 专栏（`zhuanlan.zhihu.com/p/...`）文章

评论点「N 条评论」展开、再点「收起评论」关闭，均已验证可用。

## 原理（简述）

Kiwi 桌面模式把布局视口锁死在约 980px、整体缩到约 0.4 倍，内容再窄字号也小。脚本用 `html.style.zoom = 1 / visualViewport.scale` 反向放大，数学上净字号恒等于原字号，并在内容列应用单列重排与侧栏隐藏。

## 安装

1. 浏览器安装 Tampermonkey（Kiwi 可直接装 Chrome 扩展）。
2. 打开知乎任意页面前，开启该站点的「桌面版网站」开关（否则脚本自动不生效，避免破坏移动版页面）。
3. Tampermonkey → 添加新脚本 → 粘贴 `zhihu-desk2mob.user.js` 内容 → 保存。

## 文件

- `zhihu-desk2mob.user.js` —— 脚本本体
