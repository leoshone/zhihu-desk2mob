# 项目约定（接手须知）

这份文档是**换机／换人接手时需要知道的项目决策**，不重复技能与 README 已写的内容：
环境与工具用法见 [`skills/kiwi-violentmonkey-cdp/SKILL.md`](../skills/kiwi-violentmonkey-cdp/SKILL.md)，
测试怎么跑见 [`scripts/README.md`](../scripts/README.md)，各版本根因见 [`docs/`](.)。

## 环境（实测）

| 项 | 值 |
| --- | --- |
| 真机 | Xiaomi 2211133C（codename `fuxi`），1080×2400，CSS 视口 393×873 |
| 浏览器 | Kiwi + 暴力猴（扩展 ID `fcickoepngcnapddnnmjpkmpekmfmpaa`） |
| 调试 | `adb` 在 PATH；CDP 转发 `tcp:9222`（**每轮 shell 会丢**，`scripts/cdp.js` 加载时自建） |
| 站点设置 | `zhihu.com` 必须开「桌面版网站」，否则脚本按设计**不生效**（`innerWidth ≤ 600` 时直接返回） |
| Node | 18+（用到全局 `WebSocket`） |

## 版本策略（重要，别踩）

- **以 v1.0.0 为基线**：`v1.0.1` / `v1.0.2` 是**另一条分支**，用户明确选择不包含它们：
  - 1.0.1：回答/问题区块宽度不一致、图片查看器居中（**1.0.0 下图片查看器会跑到屏幕外**）
  - 1.0.2：文字截断治理（box-sizing + max-width + overflow-x）、长 token 断行
  这两版的代码**只在 git 历史里，main 上已没有**。若日后要「1.0.2 的全部改进 + 这些修复」，
  需另开一版把两条线合并。
- 版本号写在 userscript 头部（`// @version`）；每次变更同步更新 `docs/` 与 Release。

## 发布流程

完整步骤见技能 SKILL.md 的「发布 Release」一节，这里只记**容易忘的硬性约定**：

- Release note 里写更新记录 + 安装地址 + **sha256**；**更新记录不写进 README**。
- tag 指向**该版本当时的提交**（不是 HEAD），附件是那个提交的 `zhihu-desk2mob.user.js`
  （`git show <commit>:zhihu-desk2mob.user.js`）。
- `gh release create --target` **必须给完整 40 位 SHA**（短 SHA 会 422）。
- 版本号回滚过、不打算再用时：**删掉它的 Release 与 tag**，免得下载列表里留着一份被撤回的代码
  （提交仍在历史里，可重建）。
- 脚本头部带 `@updateURL` / `@downloadURL` 指向 raw main（v1.0.6 起），
  所以**从 Release 附件安装的也会自动更新**。

## 验证（改脚本后必须全绿再发版）

6 个真机测试，见 [`scripts/README.md`](../scripts/README.md)。两条容易踩的：

- **`window.__z2mStop()` 是半清理**：只摘样式表、不断内联样式，**不能当「无脚本」基线**。
  判断「某问题是否由某次改动引入」要用**同一轮内的改前/改后对照**。
- 测试之间的**环境前提**要显式满足（如弹层测试需要回答页；没有时它会自动开一个）。
  **不要靠静默降级**——那会把环境问题伪装成产品回归。

## 调试顺序（省时间的顺序）

1. `scripts/probe-*.js` 定位「现象出自哪个容器／哪一层」，别先猜 CSS；
2. `scripts/inspect.js`（技能里）看屏幕顶层叠加层与关闭入口在不在屏幕内；
3. 改脚本 → `--installed` 跑对应测试 → 全套；
4. 涉及视觉的改动：`adb exec-out screencap -p` 抓真机屏（比 `Page.captureScreenshot` 抗造）。

**优先怀疑脚本自己的规则**：本项目两次「莫名其妙」的坏版式（头像被拉高、
「同时发布到想法」竖排、右边缘残留）根因都是**脚本自己无差别施加的通用规则**，
而不是知乎的问题。详见技能 SKILL.md 的「坑」一节。

## 已知未修（不要当成新 bug 去追）

1. 弹层原生「关闭」按钮仍在屏幕外（`right:-60px`），退出由返回手势承担。
2. 写「写想法」卡片里的**「同步到圈子」是竖排残留**（自 1.0.0 起）：它塌成 0 宽
   （`rect {x:298, w:0, h:95}`），所在行只有 49px 可用宽。它是**发到圈子的功能开关**，
   隐藏等于去掉功能 → 属产品取舍，尚未决定。
3. v1.0.1 / v1.0.2 的改进未包含（见上方「版本策略」）。
