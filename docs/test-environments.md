# 测试环境总览：三种测试方法

脚本适配的目标是「桌面版网站」模式下的知乎页面。同一个脚本可以在三种环境里验证，
各有适用场景与陷阱。**公共前提**：目标浏览器装好暴力猴，且站点开启「桌面版网站」开关
（或 URL 带 `?z2m-force=1` 强制生效，见下）。

## 三种环境对照表

| | ① 桌面浏览器（Turbo） | ② 安卓模拟器（MuMu → Kiwi） | ③ 真机（小米13 → Quetta） |
| --- | --- | --- | --- |
| **定位** | **快速迭代**：改完立即看效果 | 中间验证：接近真机的安卓内核 | **最终裁决**：真实用户环境 |
| 浏览器 | Turbo（`D:\Software\Turbo\turbo.exe`，Chrome 156） | Kiwi（Chrome 137） | Quetta（Chrome 148） |
| 暴力猴 | 2.50，扩展 ID `jinjaccalgkegednnccohejagnlnfdag` | 已装（同 Kiwi profile） | 已装 |
| CDP 接入 | **直连宿主机**：`127.0.0.1:9222`（启动参数 `--remote-debugging-port=9222`），不经 adb | MuMu：`adb connect 127.0.0.1:16384` → `adb forward tcp:9222 localabstract:chrome_devtools_remote`（**每轮 shell 会丢**，`cdp.js` 加载时自建） | USB 调试 → `adb forward tcp:9222 localabstract:chrome_devtools_remote`（同左） |
| 视口 | DevTools 模拟：`Emulation.setDeviceMetricsOverride`（393×873 dpr3 mobile）+ 窗口缩成手机尺寸 | Kiwi 开「桌面版网站」，视口 891 由浏览器缩放 | 真机桌面模式，视口 891 |
| 脚本生效 | 需 URL 带 **`?z2m-force=1`**（模拟视口命中 `innerWidth≤600` 守卫） | 「桌面版网站」开关即触发（真移动视口不命中守卫） | 同左 |
| 已知陷阱 | ① `@run-at document-start` 注入失效（Chrome156+暴力猴2.50），须 `document-body`；② Emulation 随 CDP 断开自动清除，肉眼验证需常驻连接；③ 表情/输入组件接口在模拟网络下「加载失败」（非脚本问题） | Chrome 137 与真机 148 有内核差异（如滚动条机制），「模拟器正常、真机异常」优先怀疑内核差异；新内核 `Page.addScriptToEvaluateOnNewDocument` 不生效，注入须在 navigate 后 `Runtime.evaluate` | 最真实；`test-counterzoom` 等「模拟捏合」类测试的 FAIL 只在真机可信 |
| 速度 | 秒级往返（截图/注入/重载都快） | 中（经 adb，受限模拟器性能） | 慢（USB 往返） |

**推荐流程**：改动 → ① Turbo 快速迭代确认布局 → ② MuMu Kiwi 过一遍安卓内核 → ③ 真机抽验关键页。
小改动不必三级全跑（见 test/README.md「跑几套」一节）。

## 各环境操作要点

### ① Turbo（桌面快速迭代）

1. 启动带调试参数（首次配置，之后正常启动也带）：`turbo.exe --remote-debugging-port=9222`
2. 暴力猴装脚本：options 页「地址安装」→ 填 `http://127.0.0.1:8899/zhihu-desk2mob.user.js`
   （本地 `python -m http.server 8899` 起服务；GitHub raw 在部分网络环境拉不到）
3. 看效果：导航到 `https://www.zhihu.com/?z2m-force=1`（参数是关键，否则脚本自守卫退出）
4. 肉眼验证窗口效果时注意：`Emulation` 参数随 CDP 断开消失，需常驻连接；或直接把窗口缩窄
5. 自动化装机脚本：`_tmp-shots/turbo-setup.js`（本地服务 + 地址安装 + confirm 自动点击一条龙）

### ② MuMu 模拟器（Kiwi）

1. `adb connect 127.0.0.1:16384`（MuMu 端口；真机则 USB）
2. `adb forward tcp:9222 localabstract:chrome_devtools_remote`（`cdp.js` 会自建）
3. 走查：`node test/audit-real.js`（8 页断言+截图，暴力猴已装模式）
4. 坑：
   - Kiwi 内核旧（137），「模拟器正常」不等于真机正常（内核差异案例见 conventions 文档）
   - 多 display 陷阱：`am stack list` 看 displayId，`input -d <id> tap` 必须带 `-d`
   - 截图用窗口抓图（PrintWindow），全屏 `screencap` 在有遮挡时误导

### ③ 真机（小米13 / Quetta）

1. USB 调试 + `adb forward tcp:9222 localabstract:chrome_devtools_remote`
2. 最终裁决环境：`test-counterzoom` 等捏合类测试**只信真机结果**（模拟捏合在 CDP 下不可靠，
   见 test/README.md counterzoom 注）
3. 长会话后 `Page.captureScreenshot` 可能不可靠，改用 `adb exec-out screencap -p`
4. renderer 挂死（`document.body` 为 null）：`adb shell am force-stop <浏览器包名>` 重启

## 通用工具

- CDP 工具库：`test/lib/cdp.js`（零依赖，Node 18+ 内置 WebSocket）
- 注入体检：`node test/check-injected.js "zhihu.com"`（改完 CSS 第一件事）
- 8 页走查：`node test/audit-real.js`（真机/模拟器通用，暴力猴已装模式）
- 全部测试与探针清单见 [test/README.md](README.md)

## 历史踩坑记录

详细案例（bfcache 恢复 DOM 属性、端口冲突、browser ws 需 GUID 等）见
[`AGENTS.md`](../AGENTS.md) 的「已知陷阱」一节。
