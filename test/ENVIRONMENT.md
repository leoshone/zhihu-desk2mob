# 测试环境搭建（AVD / 模拟器 / 真机通用手册）

从零把一台「裸」的安卓模拟器/设备变成能跑本项目回归测试的环境，需要**五步**，
任何一步缺了，症状都像「脚本坏了」，实际是环境没就绪。本文按实际踩坑顺序写，
每步给出**就绪判据**——先验证判据再进下一步，别跳。

> 环境定位与三种环境的适用场景对照（Turbo 快速迭代 / 模拟器中间验证 / 真机最终裁决）
> 见 [README.md](README.md)「测试环境」一节；本文只讲**搭建与排障**。

## 五步总览

| 步骤 | 就绪判据 | 不就绪的典型症状 |
| --- | --- | --- |
| ① CDP 可达 | `curl http://127.0.0.1:9222/json/version` 返回浏览器信息 | 安装脚本、一切测试全挂 |
| ② 暴力猴已安装且**启用** | extensions 页 shadow DOM 里 `enabled: true` | `.user.js` 页不弹 confirm、变下载 |
| ③ 脚本已装进暴力猴 | 目标页存在 `#z2m-style` | 页面无适配效果、测试第一条就 FAIL |
| ④ 桌面模式已开启 | 目标页 `innerWidth > 600`（AVD 实测 891） | `innerWidth≈412`，脚本守卫退出 |
| ⑤ 知乎登录态 | 目标页 `location.href` 不被 302 到 `/signin` | 桌面版所有页面被强跳登录页 |

## ① CDP 可达

```bash
adb forward tcp:9222 localabstract:chrome_devtools_remote
curl -s --noproxy "*" http://127.0.0.1:9222/json/version
```

- forward/reverse **每轮 shell 都会丢**，`test/lib/cdp.js` 加载时自建；手工调用要自己重跑。
- **端口冲突**：9222 可能被宿主机桌面浏览器（Turbo）占用。两者并存时 AVD 改走
  `forward tcp:9223`，9222 留给桌面端；项目回归测试硬编码 9222，跑之前用
  `curl /json/version` 看返回的 `Android-Package` 字段确认连的是谁。
- 桌面 Turbo 起调试端口：`turbo.exe --remote-debugging-port=9222`。**从 CLI/工具会话里
  Start-Process 起的浏览器会随会话结束被杀**——用计划任务（或双击快捷方式）脱离会话启动，
  与 AVD 启动同理（见 skills 仓库 `avd-boot`）。

## ② 暴力猴已安装且启用

安装/启用/预检的完整方法已沉淀到独立仓库（含可复用脚本）：
**[leoshone/Skills → violentmonkey-script-install](https://github.com/leoshone/Skills/tree/main/violentmonkey-script-install)**。
`install-userjs.js` 已内置预检：暴力猴未装/被禁用时快速失败（退出码 2）并打印恢复步骤。

本项目环境踩过的两个坑速记：

- **暴力猴被禁用（权限提升）**：Chrome 自动关闭后 `.user.js` 页直接变下载，
  confirm 页永远不弹。恢复需要真实用户手势：CDP `Input.dispatchMouseEvent` 点
  `chrome://extensions` 里的启用开关 → 弹「需要新权限」框 → 截图换算坐标 adb tap 点 OK。
  纯 CDP API（`chrome.management.setEnabled`）会被手势校验挡住，不可行。
- **扩展 ID 各环境不同**：AVD Kiwi 实测 `fcickoepngcnapddnnmjpkmpekmfmpaa`，
  桌面 Turbo 是 `jinjaccalgkegednnccohejagnlnfdag`。按扩展**名字**匹配，别写死 ID。

## ③ 脚本已装进暴力猴

```bash
# 起本地脚本源（独立后台跑，别让安装脚本托管它的生命周期——它失败退出会连坐服务）
python -m http.server 8899   # 在仓库根目录

# AVD/模拟器：reverse 映射后走安装脚本（预检+confirm 自动点击一条龙）
adb reverse tcp:8899 tcp:8899
node <skills 仓库>/violentmonkey-script-install/scripts/install-userjs.js zhihu-desk2mob.user.js
```

- 更新已装脚本 = 同一条命令（confirm 页按钮是「重装」/`Reinstall…`）。
- 安装后判活：目标页 `!!document.getElementById('z2m-style')` 为 true。

## ④ 桌面模式已开启

Kiwi 的「桌面版网站」是**每站点开关**，新环境/新站点默认关。检查与开启：

```js
// 检查（CDP）
JSON.stringify({ innerWidth: window.innerWidth })   // 891 = 桌面模式；412 = 移动视口（脚本守卫退出）
```

开启方法（无 CDP 入口可做，纯 UI 操作）：Kiwi 三点菜单 → 勾选「Desktop site」。
自动化时注意：

- 开关触发**整页 reload**，当前页面状态（展开的评论区等）会丢；
- 菜单项没有 DOM，只能截图定位 + adb tap；**截图横纵缩放系数不同**
  （如 514×1080 截图对 1080×2400 屏幕，x×2.101、y×2.222），分别换算，否则点偏；
- 点完重查 `innerWidth` 确认生效（菜单也可能弹出无关对话框——「添加到主屏幕」等，
  坐标错了会点到，先截图看清再点 OK/Cancel）。

## ⑤ 知乎登录态（2026-11 起必配）

**知乎桌面版匿名访问已被强制重定向登录页**（近期策略；移动版页面仍可匿名浏览）。
模拟器/新设备不登录，测试页根本打不开。登录态获取的可行与不可行路线：

| 路线 | 结论 |
| --- | --- |
| ❌ 解密 Chrome cookie 库 | Chrome v20 app-bound 加密，DPAPI 用户层解不开，GCM 校验全败，弃 |
| ❌ MuMu 自带登录态 | 本机 MuMu 15 渲染器启动反复超时（`is_android_started` 恒 false），不可依赖 |
| ✅ **从带 CDP 的桌面浏览器复制** | 首选。Turbo 带登录态，CDP 直接读明文 cookie，无需解密 |

复制操作（Turbo 已按 ① 起在 9222，AVD 走 9223）：

```js
// 1) Turbo 侧读 cookie（先把 Turbo 导航到 zhihu.com 一次，确保 cookie 在上下文里）
const ck = await turboApi.send('Network.getCookies',
  { urls: ['https://www.zhihu.com/', 'https://zhuanlan.zhihu.com/'] }, sid);
// 过滤噪音统计 cookie（Hm_*、HMACCOUNT、BEC）后逐条写入 AVD：
await avdApi.send('Network.setCookie', {
  name, value, domain, path, secure, httpOnly,
  expires: c.expires > 0 ? c.expires : undefined, sameSite,   // 原样带过去
}, sid);
```

- 注入后直接导航目标页验证：`location.href` 不再跳 `/signin` 即成功（实测 7 条
  核心 cookie 就够，`d_c0`/`SESSIONID`/`q_c1` 等是关键）。
- cookie 有时效，失效后重跑一遍复制即可（脚本化两分钟）。

## 稳定性备忘（跑测试前后）

- **标签页清理**：每轮测试残留的目标页标签会让下次 attach 到冻结标签时 Node 无报错挂死。
  跑测试前把设备上知乎标签清到 1 个样板（测试自己会开新标签、跑完关掉）。
- **JS 经 bash 传输的转义陷阱**：CDP evaluate 的表达式里 `\d` 会被 bash 吃成字面 `d`
  （正则静默失配，极难察觉）——用 `new RegExp('[0-9]+ ...')` + Unicode 转义写正则；
  长脚本一律写文件再 `node` 执行，不走命令行内联。
- **知乎按钮文案**：以 U+200B（零宽空格）开头，且评论数实时增长（119→120→...）——
  匹配前先去零宽字符，用「N 条评论」通配，不硬编码数字。
- 长会话 evaluate 全超时 = renderer 挂死，`adb shell am force-stop <浏览器包名>` 重启。
