# AGENTS.md — 项目规范（Agent / 接手须知）

zhihu-desk2mob：把知乎桌面版网页重排为手机单列的油猴脚本。
单文件交付（`zhihu-desk2mob.user.js`）、零依赖、无构建。仓库内一切工具与文档都为它服务。


## 新环境准备

换电脑 / 新会话接手时，AI 必须先将下面4个skill安装到项目级；

| Skill | 用途（本项目何时用到） |
| --- | --- |
| [avd-boot](https://github.com/leoshone/skills/tree/main/avd-boot) | 启动 AVD 模拟器（中间验证环境）。**必须按它的方法用计划任务脱离会话启动**，直接从 CLI 启动会被连带杀死 |
| [avd-install-apk](https://github.com/leoshone/skills/tree/main/avd-install-apk) | AVD 上装 Kiwi 等浏览器 APK（搭环境时） |
| [browser-extension-install](https://github.com/leoshone/skills/tree/main/browser-extension-install) | 给 Chromium 系浏览器装暴力猴等扩展（搭环境时） |
| [violentmonkey-script-install](https://github.com/leoshone/skills/tree/main/violentmonkey-script-install) | CDP 自动安装/更新用户脚本（装/更新本项目脚本到各环境浏览器，日常高频） |

## 项目结构

```
zhihu-desk2mob.user.js      脚本本体（唯一交付物）
docs/design-decisions.md    ADR 设计决策汇编（17 份历史方案合并，按功能域 13 章）
test/                       CDP 真机/模拟器测试与诊断探针（见 test/README.md）
  └ README.md               测试说明
  └ ENVIRONMENT.md          环境搭建。
  └ lib/cdp.js              CDP 工具库（唯一实现）
```

## 环境（实测）

| 项 | 值 |
| --- | --- |
| 真机 | Xiaomi 2211133C（`fuxi`），1080×2400，CSS 视口 393×873  + Quetta（Chrome 148）+ 暴力猴|
| 模拟器 | AVD TestPhone（`emulator-5554`）+ Kiwi（Chrome 137）+ 暴力猴（`fcickoepngcnapddnnmjpkmpekmfmpaa`）；MuMu（`adb connect 127.0.0.1:16384`，本机启动渲染器超时不可依赖） |
| 桌面调试 | Turbo 浏览器（`D:\Software\Turbo\turbo.exe`，Chrome 156，`--remote-debugging-port=9222` 直连，**不经 adb**）；暴力猴 2.50（`jinjaccalgkegednnccohejagnlnfdag`） |
| CDP | Turbo 占 `tcp:9222` 直连；真机/AVD 走 adb forward（AVD 用 **9223** 避免冲突），每轮 shell 会丢、`test/lib/cdp.js` 自建 |
| 站点设置 | `zhihu.com` 必须开「桌面版网站」，否则脚本按设计不生效（`innerWidth ≤ 600` 直接返回）；**桌面版匿名访问被知乎强跳登录页（2026-11 起策略），模拟器需复制登录态** |
| Node | 18+（用到内置全局 `WebSocket`）；**项目零依赖**，无需 npm install |

环境**搭建/排障**（五步就绪判据、暴力猴启用恢复、登录态复制）在
[test/ENVIRONMENT.md](test/ENVIRONMENT.md)；三种环境的接入差异与陷阱在
[test/README.md](test/README.md)「测试环境」一节。浏览器/AVD 这类**长驻进程从 CLI
会话里启动会被连带杀死**——统一按 `avd-boot` skill 的计划任务方式启动。

## 工作流（改脚本必经）

1. **改完 CSS 第一件事**：`node test/check-injected.js`——整套 CSS 在脚本的 JS 模板串里，
   注释混进反引号会提前闭合使样式全失效，而 `node --check` 可能照样通过（已踩三次）。
2. 验证范围按**改动波及面**定：只动一处 CSS/文案 ⇒ 跑受影响的那套测试；动公共层
   （zoom、`--z2m-w`、全局扫描 pass）或发版终验 ⇒ 跑全套。小改动不必全套（用户明确要求）。
3. 视觉改动：截图给用户确认后再提交推送（**不要不验证就交差**）。
4. 发布：`check-injected` 体检 → commit push → Release（note 写变更 + raw 地址 + sha256；
   `gh release create --target` 必须给完整 40 位 SHA）。变更记录**不写进 README**。
5. 提交信息用中文、说清「为什么」；push 后确认 GitHub raw 已同步（暴力猴从 raw 更新）。

## 核心契约（改代码前必读）

### 反缩放

- `html{zoom} = visW / SW`（visW = visualViewport.width），目标是内容恰好铺满（fitRatio=1），
  **不是** `1/scale`。细节见 [docs/design-decisions.md §4](docs/design-decisions.md)。
- 捏合：放大不干预；缩小夹在「恰好铺满」下限（`CFG.limitZoomOut`）。
- **屏上大小 = 名义字号 × (屏幕可用宽 ÷ 列宽)**：唯一的旋钮是列宽，不能只调 zoom
  （会让列宽于屏幕、右侧被裁）。`CFG.textScale` 是换算因子（当前 1.0 = 名义字号 16px）；
  要调字号改这一个数，别动 font-size。
- ⚠️ 别在 `applyZoom()` 里调用依赖 `let` 声明的函数——撞 TDZ 会让整个 IIFE 抛错、脚本全失效，
  症状像「暴力猴没注入」。判活看 `#z2m-style` 是否存在。

### 视口守卫

- 脚本开头 `innerWidth ≤ 600` 直接 return（Kiwi 真机不开桌面模式时页面本来就是手机版）。
- 桌面浏览器模拟手机视口会命中守卫 → URL 加 **`?z2m-force=1`** 绕过（v1.7.0）。

### 留白

- 全站统一 16px（`normalizePadding()`，PAD 常量）；块间竖缝来自卡片自身 margin-bottom，只动横向。
- 块的呼吸感来自块自己的内边距，不要补。

### 加载期闪烁

- 凡「加载期需要隐藏/矫正元素」的 pass，必须**同步挂在 MutationObserver 回调里**
  （只挂去抖的 tick 会先显示未处理形态再跳变）。每个 pass 要有廉价前置判断（防拖慢主线程）。

### 外部依赖契约

- **知乎 css-in-js 类名每次构建随机化**（实测 `css-1y3l2hj` → `css-1rd8uzu`）——
  CSS 规则按类名选择会静默失效。要稳定定位只能按**结构关系**（如 `.PageHeader` 的
  positioned 祖先）+ JS 每拍幂等重写（知乎重渲染会清内联样式）。
- **`test/lib/cdp.js` 是全仓库唯一 CDP 实现**，`test/cdp.js` 只是一行转发。
  skills 仓库里还有一份通用版 `cdp.js`（多了代理环境变量清理，跨项目用）——
  两者**不互相同步**，各自演进；本项目测试只用项目内这份。

## 调试顺序

1. 判断是否回归：是 → `git log -S "<规则原文>"` 定位，别猜。
2. `test/probe-*.js` 定位现象出自哪个容器，别先猜 CSS。
3. 改脚本 → `--installed` 跑对应测试。
4. 视觉改动抓屏确认。
- **优先怀疑脚本自己的通用规则误伤**（历史上「莫名其妙」的坏版式全是脚本造成的，不是知乎）。
- 「模拟器正常、真机异常」优先怀疑内核版本差异。

## 已知陷阱（高频，别重踩）

- **`node --check` 查不出模板串被反引号提前闭合**——改 CSS 必跑 check-injected。
- **`__z2mStop()` 是半清理**（只摘样式表不撤内联样式），不能当「无脚本基线」；
  判断回归要用同一轮内的改前/改后对照。
- **测试前置要显式满足**：缺回答页/专栏页标签时会退到别的页面报前置失败，不是自动补开；
  测试还会「吃掉」别的标签（findTab 退到第一个标签并导航走）——跑前把所需页面各开好。
- **`test-counterzoom` 的 ②③ 稳定失败**（模拟捏合方式的问题，`--installed` 跑旧版同样失败）
  ——不要靠重跑判断；①② 加载期也会间歇失败，先重跑一次再判断。它会残留页面比例，
  中断后补救：`setPageScaleFactor` 设回健康值（本机 0.40111）。
- **`document-start` 在 Chrome156+暴力猴 2.50 上注入失效**（测试脚本对照实证）——
  主脚本用 `document-body`。Kiwi 旧内核不受影响。
- **bfcache 会连 DOM 的 JS 自定义属性一起恢复**——`__z2mMoved` 类标记会残留导致「只搬一次」
  逻辑失效；改按「当前位置是否正确」判断（幂等）。
- **写想法卡片的输入组件在桌面模拟环境「加载失败」**（知乎接口问题，非脚本）——
  该卡片的布局改动要在 Kiwi 真机验证（v1.7.1/1.7.2 两次失败已回退，教训记录）。
- **Node 全局 WebSocket 读代理环境变量走代理**，对 `127.0.0.1` 的 CDP ws 握手会失败
  （实测 "non-101 status code"）——本机 v2rayN 等代理环境必踩；skills 仓库通用版 cdp.js
  已内置清理，排查连接问题时先查代理变量。
- **PowerShell `Start-Process` 会因 `https_proxy`/`HTTPS_PROXY` 大小写重复键直接抛异常**
  （环境字典冲突）——启动外部进程用计划任务或 cmd `start` 绕开。

## 已知未修（不要当成新 bug 去追）

1. 弹层原生「关闭」按钮仍在屏幕外（`right:-60px`），退出由返回手势承担。
2. 专栏页比问答页多一层常驻 62px 吸顶文章头，可能压住「滚到顶部对齐」的内容（截图复现不稳，未动手）。
3. `test-idea-option` 的「调出发布框」不稳（固定偏移扫滚动 + focus 判据有缺陷）——已如实报错，
   要恢复判别力需改定位方式。与列宽无关。
4. `test-counterzoom` 的 ②③ 稳定失败、①② 间歇失败（均为既有问题、与版本无关，判据见上）。
5. 顶部导航右侧热榜词条/搜索框被裁一截（横滑容器初始位置，可滑到）——可接受，不修。
