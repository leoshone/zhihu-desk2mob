# 回归测试

真机上的端到端测试。它们不是跑在 CI 里的单元测试，而是**驱动手机上的 Kiwi 浏览器**
（通过 adb + Chrome DevTools Protocol）去验证脚本的实际效果。

## 前置条件

| 项 | 说明 |
| --- | --- |
| 手机 | 已开启 USB 调试并 `adb devices` 可见 |
| 浏览器 | Kiwi（或其它支持 Chrome 扩展的安卓浏览器）+ 暴力猴（Violentmonkey） |
| 视口 | 手机端该站点需开启「桌面版网站」开关，否则脚本按设计不生效 |
| 本机 | Node 18+（用到全局 `WebSocket`），`adb` 在 PATH 中 |
| 脚本 | `zhihu-desk2mob.user.js` 已装进暴力猴（测 `--installed` 模式时必须） |

## 准备

```bash
adb forward tcp:9222 localabstract:chrome_devtools_remote
```

CDP 端口转发**每轮 shell 都会丢失**，所以 `cdp.js` 在加载时会自动重建一次；若你换用别的
终端手工调用，记得自己再跑一遍上面的命令。

## 运行

真机上先各开一个页面（测试会自行复制新标签页，但需要一个「样板标签页」来确定 URL）：

- 回答页 `www.zhihu.com/question/.../answer/...` —— 给 `test-comment-back.js`
- 专栏页 `zhuanlan.zhihu.com/p/...` —— 给 `test-idea-option.js`

```bash
node test-comment-back.js --installed    # 评论弹层：返回键关闭 + 溢出定位修正
node test-idea-option.js  --installed    # 发布框：隐藏「同时发布到想法」+ 发布按钮完整可见
node test-avatar.js       --installed    # 发布框：头像不被拉高、与评论列表头像同尺寸
node test-rightrail.js    --installed    # 首页右边缘：侧栏/页脚残留已清除（且正文列没被误伤）
node test-counterzoom.js  --installed    # 反缩放：内容恰好铺满、加载期无视觉跳变、不跟捏合抢
node test-modal-layout.js                # 弹层溢出定位修正（受控夹具，不依赖线上状态）
```

> 两条注意：
> - `test-counterzoom` 只在 `--installed` 下才有判别力（注入发生在加载之后，跑不到加载期的变化）；
> - 它会临时改写页面比例（CDP `Emulation.setPageScaleFactor`，仅本会话有效），结束会重载页面。
> 建议放在整套测试的**最后**跑。
>
> 另：`test-comment-back` 需要**回答页**才能测弹层（首页的「N 条评论」是内联展开、不开弹层）。
> 设备上没有回答页标签时它会**自动开一个**，不会再静默回退到首页 —— 静默回退会把环境问题
> 伪装成产品回归。

去掉 `--installed` 则改为「重载页面后注入 `../src/zhihu-desk2mob.user.js`」，
适合改动脚本后快速迭代。

测试会自己找目标页面：`test-comment-back` 用回答页；`test-idea-option` 与 `test-avatar`
优先用专栏页，找不到就退回当前任意知乎标签（发布框行为一致），并且会自己
「滚到位 → 聚焦输入框 → 必要时打开评论弹层」把发布框调出来 —— 不再依赖真机上开着哪个页面。

## 设计要点（都是踩坑后定下来的）

- **每个测试都自行开新标签页，跑完关掉**：同一标签页反复跑会在会话历史里累积条目，
  使 `history.state` 基线不可信，产生一堆难查的假失败。
- **不用 `history.length` 判断历史是否被压入**：`back()` 不会让它减少，而 `pushState`
  会截断前进项（length 可能不变）。权威判据是 `history.state` 上的标记。
- **知乎的答案列表是虚拟化的**：`N 条评论` 按钮随滚动增删，早先拿到的元素句柄可能已失效。
  所以选按钮前要「滚到位 → 重新查询 → 只选当前在视口内的候选」，并准备多个候选重试。
- **弹层高度取决于异步加载量**：溢出分支（卡片比容器大）线上时有时无，
  因此该分支另用**受控夹具**做确定性单元测试（见 `test-modal-layout.js`），
  真机只用于验证「实际命中」。
- **页面出现 `document.body` 为 null** = CDP 长会话把 renderer 挂死了。
  执行 `adb shell am force-stop com.kiwibrowser.browser` 重启 Kiwi 即可。

## 诊断探针（probe / shot）

不是回归测试，而是**排查时用的量具**：只读、可反复跑，用来回答「这个现象出自哪个容器／
这个按钮有没有越界／该隐藏哪一层」。改脚本前先跑探针定位，比盲改快得多。

| 脚本 | 用途 | 常不常用 |
| --- | --- | --- |
| `probe-rightrail.js` | 定位右边缘残留出自哪个容器（含「侧栏 vs 正文列」的结构对照） | 常用 |
| `probe-avatar.js` | 对比发布框头像与评论列表头像的尺寸分布 | 常用 |
| `probe-publishbtn.js` | 量「发布」按钮是否越界、被挤出屏幕 | 常用 |
| `probe-composer-fit.js` | 诊断发布框那一行的「内容宽 vs 可用宽」 | 常用 |
| `probe-composer.js` / `probe-composer2.js` | 早期：dump 发布框结构 / 确定选项的出现条件 | 历史探针 |
| `probe-comment.js` | 早期：环境 / 评论触发按钮 / 叠加层扫描 | 历史探针 |
| `shot-composer.js` / `shot-answer-comments.js` | 取证：抓发布框前后对照、回答评论弹层的真机截屏 | 常用 |

> **`probe-avatar.js` 与 `probe-publishbtn.js` 的 `--off` 有方法局限**：它们用
> `window.__z2mStop()` 当「关掉脚本」的基线，而那个钩子是**半清理**（只摘样式表、不断
> 内联样式），所以那组数据不是有效的无脚本对照。判断「某问题是否由某次改动引入」要用
> **同一轮内的改前/改后对照**。两个脚本头部都写了这条。

**通用的**两个探针不在这里，在技能目录（`skills/kiwi-violentmonkey-cdp/scripts/`）：
`probe-element.js`（按文案定位元素并 dump 结构）与 `inspect.js`（判定屏幕顶层叠加层、
切标签、可 `--out` 指定截图路径）。本目录**不再放它们的副本** —— 曾因副本漂移导致
「本地跑的是旧版」而白查一轮。

## 依赖

CDP 工具库本体在技能目录内：`../skills/kiwi-violentmonkey-cdp/scripts/cdp.js`。
本目录的 `cdp.js` 只是一行转发，以保证全仓库只有一份实现。
