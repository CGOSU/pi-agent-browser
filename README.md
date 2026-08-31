# pi-agent-browser

为 `pi` 提供单一 `browser` 工具，通过 `agent-browser` 控制无头 Chrome。

## 安装

```bash
pi install npm:pi-agent-browser
```

不安装到 pi 时，也可以直接加载：

```bash
pi -e npm:pi-agent-browser
```

首次使用前安装 `agent-browser` 和 Chrome for Testing：

```bash
npm install -g agent-browser
agent-browser install
```

插件不会自动安装 npm 包、下载浏览器或启动其他浏览器服务。

## 使用

```text
browser persist on work
browser open https://www.baidu.com
browser snapshot -i
browser click @e1
browser screenshot
browser qr
browser close
```

常用命令：

| 命令 | 说明 |
| --- | --- |
| `open <url>` | 打开网页 |
| `snapshot -i` | 查看可交互元素及其引用，如 `@e1` |
| `click <@ref>` | 点击元素 |
| `fill <@ref> <text>` | 清空并填写输入框 |
| `type <@ref> <text>` | 追加输入文本 |
| `select <@ref> <value>` | 选择下拉选项 |
| `press <key>` | 按键，如 `Enter`、`Tab` |
| `scroll <dir> [px]` | 滚动页面 |
| `get text\|url\|title [@ref]` | 获取页面或元素信息 |
| `wait <@ref\|ms>` | 等待元素或毫秒数 |
| `screenshot [--full]` | 获取截图并返回给模型 |
| `qr [--full]` | 截取当前页面并以内嵌图片返回，扫码登录时直接扫描 |
| `persist on <name>` | 启用指定命名 Profile 的持久化登录状态 |
| `persist off` | 停用命名 Profile；不删除已有数据 |
| `persist status` | 查看当前持久化来源，不显示 Profile 路径 |
| `close` | 关闭浏览器 |

页面发生变化后，重新执行 `snapshot -i` 获取最新引用。

扫码登录时执行 `browser qr`；二维码会以内嵌图片返回，无需到截图文件夹查找。二维码在长页面中时可使用 `browser qr --full`。

### 持久化登录与安全隔离

默认浏览器会话不持久化。需要保存登录状态时，先选择一个信任边界明确的命名 Profile：

```text
browser persist on work
browser persist status
```

同一个 Profile 可以保存多个网站的 Cookie、LocalStorage、IndexedDB 和 Service Worker 状态，但只应放入同一信任边界的网站。不同账号、不同用途或不同 Agent 请使用不同名称，禁止共享 Profile 或复用日常 Chrome Profile。

Profile 位于当前操作系统用户的本地数据目录，配置文件只保存当前 Profile 名称，不保存 Cookie 或 Token。切换或执行 `persist off` 后，要先关闭当前浏览器；设置会在下一次浏览器启动时生效。`persist off` 不会删除旧数据，重新执行 `persist on <name>` 可恢复使用。

若需要彻底退出某个网站或清除 Profile，先执行 `browser persist off` 并关闭浏览器，再由用户手动删除对应的本地 Profile 目录；网站主动让会话失效、Cookie 过期或要求设备验证时，仍需重新登录。长期使用时 Profile 数据和缓存会增长，但同时只打开一个 Profile 通常不会造成明显额外开销。

`AGENT_BROWSER_PROFILE` 是 agent-browser 的原生覆盖项，设置后优先于插件的命名 Profile。不要把该变量指向日常 Chrome Profile。

## 配置

默认使用无头 Chrome；需要显示浏览器窗口时，直接使用 agent-browser 的配置或环境变量：

```powershell
$env:AGENT_BROWSER_HEADED = "1"
```

`agent-browser` CLI 需要位于 PATH 中。Windows npm 全局安装通常会放在 `%APPDATA%/npm`；如果当前终端找不到它，请把该目录加入 PATH，或重启终端。`AGENT_BROWSER_EXECUTABLE_PATH` 是 agent-browser 用来指定 Chrome 路径的变量，不是 CLI 路径。

网络请求使用标准 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量。

## 故障排查

如果提示找不到 `agent-browser`：

```bash
npm install -g agent-browser
agent-browser install
agent-browser doctor
```

插件不会自动回退到 Playwright、Obscura、PinchTab 或其他浏览器工具。

## 开发验证

```bash
npm test
pi -e ./extensions/index.ts --help
```

真实浏览器集成验证示例：

```bash
agent-browser open https://example.com
agent-browser snapshot -i
agent-browser close
```

## 许可证

[MIT](./LICENSE)
