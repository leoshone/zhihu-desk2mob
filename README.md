# zhihu-desk2mob

知乎桌面版 · 手机单列适配油猴脚本。

在 Kiwi / Chrome 等浏览器开启「桌面版网站」后，把知乎**桌面版**网页重排为手机单列、以正常字号显示，保留桌面版比移动版网页多得多的功能。已在真机（1080×2400 Android）逐页验证。

## 适配范围

- 首页（`www.zhihu.com`）信息流
- 问答页（`/question/...`）问题与回答、评论
- 专栏（`zhuanlan.zhihu.com/p/...`）文章

评论点「N 条评论」展开、再点「收起评论」关闭，均已验证可用。回答里点「N 条评论」会打开评论弹层，**用系统返回手势即可关闭并回到问答页**。

## 版本

**更新记录写在 [Releases](../../releases) 里** —— 每个版本的变更说明在对应的 Release note，
脚本本体也作为 Release 附件随版本发布（想固定某个版本就用附件，想跟着更新用下面的 raw 地址）。

- 最新版：<https://github.com/leoshone/zhihu-desk2mob/releases/latest>
- 全部版本：<https://github.com/leoshone/zhihu-desk2mob/releases>

> **关于版本号**：1.0.1 / 1.0.2 与 1.0.3 起是两条**独立分支**。1.0.3 往后以 1.0.0 为基线，
> **不含** 1.0.1 / 1.0.2 的改动（文字截断治理、图片查看器居中、区块宽度一致性），
> 因此这两版没有 Release。若需要「1.0.2 的全部改进 + 后续修复」，需另开一版把两条线合并。

## 已知问题

- 评论弹层自带的「关闭」按钮由知乎放在卡片**右外侧**（`right:-60px`），桌面坐标下本就在屏幕外，
  搬进屏幕内会压住「默认/最新」标签页，故未强改；退出请用返回手势。

## 原理（简述）

Kiwi 桌面模式把布局视口锁死在远比屏幕宽的值（本机实测 1430px）、整体缩到约 0.25 倍，内容再窄字号也小。脚本用 `html.style.zoom = 1 / visualViewport.scale` 反向放大，数学上净字号恒等于原字号，并在内容列应用单列重排与侧栏隐藏。

注意：反缩放会让页面同时存在两套坐标 —— `getBoundingClientRect` 与 CSS px 同坐标，而 `elementFromPoint` 用的是布局坐标（≈ `rect × zoom`）。做命中测试时容易因此误判。

## 安装

脚本可直接从本仓库的 raw 地址安装／更新（暴力猴会自动识别为同一个脚本）：

```
https://raw.githubusercontent.com/leoshone/zhihu-desk2mob/main/zhihu-desk2mob.user.js
```

手工安装：浏览器装 Tampermonkey / 暴力猴（Kiwi 可直接装 Chrome 扩展）→ 新建脚本 →
粘贴 `zhihu-desk2mob.user.js` 内容并保存。

想固定某个版本，就从 [Releases](../../releases) 下载该版本的附件再手工装入
（用附件装不会自动更新，跟着更新请用上面的 raw 地址）。

**务必在打开知乎之前开启该站点的「桌面版网站」开关**，否则脚本按设计不生效（避免破坏移动版页面）。

## 文件

| 路径 | 说明 |
| --- | --- |
| `zhihu-desk2mob.user.js` | 脚本本体（单文件，无构建） |
| `docs/` | 各版本的修复方案文档：根因分析、实测数据、方案取舍 |
| `scripts/` | 真机回归测试（见 [scripts/README.md](scripts/README.md)） |
| `skills/kiwi-violentmonkey-cdp/` | 配套技能：用 CDP 驱动真机 Kiwi + 暴力猴（装／更新脚本、注入、取证） |

`scripts/` 里的测试要驱动真机，依赖技能目录中的 CDP 工具库
（`skills/kiwi-violentmonkey-cdp/scripts/cdp.js`，本仓库只存一份实现）。
技能本身可以单独拿走使用，不依赖本脚本。
