# pi-agent-browser

为 `pi` 提供单一 `browser` 工具。后端支持 Obscura MCP 和 PinchTab HTTP；默认自动发现可用后端，并保留现有浏览器命令接口。

## 安装

```bash
pi install npm:pi-agent-browser
```

不安装到 pi 时，也可以直接加载：

```bash
pi -e npm:pi-agent-browser
```

不需要日常配置即可使用：`auto` 模式首次操作时先检查本机 PinchTab（默认 `http://127.0.0.1:9867`），再检查 PATH 或配置中的 Obscura。后端一旦选定，就会在当前会话中锁定。

### 后端准备

- **PinchTab**：由用户自行安装并启动 HTTP 服务。插件不会安装、启动或停止 PinchTab。
- **Obscura**：需要用户预先安装 [Obscura](https://github.com/h4ckf0r0day/obscura) 渲染版；Windows 可将目录加入 `PATH`，也可用 `PI_OBSCURA_PATH` 指定完整路径。

如果两个后端都不可用，工具会报告包含检查地址和安装提示的错误；不会自动改用 Playwright、Chrome 或其他浏览器工具。

## 使用

在 pi 中调用 `browser` 工具：

```text
browser open https://www.baidu.com
browser snapshot -i
browser click @e1
browser screenshot
browser close
```

常用命令：

| 命令 | 说明 |
| --- | --- |
| `open <url>` | 打开网页 |
| `snapshot [-i]` | 查看页面或可交互元素引用，如 `e1` |
| `click <@ref\|selector>` | 点击元素 |
| `fill <@ref\|selector> <text>` | 清空并填写输入框 |
| `type <@ref\|selector> <text>` | 在输入框中追加文本 |
| `select <@ref\|selector> <value>` | 选择下拉选项 |
| `press <key>` | 按键，如 `Enter`、`Tab` |
| `scroll <dir> [px]` | 滚动页面 |
| `get text\|url\|title\|html\|value\|attr` | 获取页面或元素信息 |
| `wait <@ref\|selector\|ms>` | 等待元素或指定时间 |
| `screenshot` | 获取当前视口截图并返回给模型 |
| `eval <javascript>` | 执行 JavaScript |
| `back\|forward\|reload` | 页面历史操作 |
| `tab ...` | 标签页操作 |
| `close` | 关闭当前浏览器会话 |

页面发生变化后，重新执行 `snapshot -i` 获取最新引用。

## 配置

配置文件是可选的。默认位置：

- Windows：`%APPDATA%/pi-agent-browser/config.json`
- Linux/macOS：`${XDG_CONFIG_HOME:-~/.config}/pi-agent-browser/config.json`
- 设置 `PI_BROWSER_CONFIG` 可指定其他路径。

示例：

```json
{
  "backend": "auto",
  "obscura": {
    "path": "C:/tools/obscura/obscura.exe",
    "stealth": false,
    "proxy": "",
    "userAgent": "",
    "allowPrivateNetwork": false
  },
  "pinchtab": {
    "server": "http://127.0.0.1:9867"
  }
}
```

配置优先级按字段计算：**命令/调用参数 > 环境变量 > 用户配置 > 默认值或自动发现**。当前后端通过 `backend` 或 `PI_BROWSER_BACKEND` 设置为：

- `auto`：先健康检查 PinchTab，再尝试 Obscura；会话锁定后不切换。
- `pinchtab`：只使用 PinchTab。
- `obscura`：只使用 Obscura。

环境变量：

| 环境变量 | 说明 |
| --- | --- |
| `PI_BROWSER_BACKEND=auto\|pinchtab\|obscura` | 后端模式 |
| `PI_PINCHTAB_URL` | PinchTab HTTP 地址 |
| `PINCHTAB_TOKEN` | PinchTab Bearer 凭据，仅从环境透传，不写入配置 |
| `PINCHTAB_SESSION` | 可选 PinchTab Session 凭据，仅从环境透传 |
| `PI_OBSCURA_PATH` | Obscura 可执行文件路径 |
| `PI_OBSCURA_STEALTH=1` | 启用隐身模式 |
| `PI_OBSCURA_PROXY` | HTTP/SOCKS5 代理 |
| `PI_OBSCURA_USER_AGENT` | 自定义 User-Agent |
| `PI_OBSCURA_ALLOW_PRIVATE_NETWORK=1` | 允许 Obscura 访问本机和私有网络 |

PinchTab 和 MCP 控制面应仅暴露在可信的本地环境中。页面内容应视为不可信数据；不要把令牌写入配置文件或提交到仓库。插件不负责 PinchTab 服务的生命周期管理。

### 查看运行时生效值

环境变量由启动 Pi 的 Node.js 进程继承。Windows PowerShell 中查看项目相关变量：

```powershell
Get-ChildItem Env: |
  Where-Object Name -match '^(PI_BROWSER|PI_OBSCURA|PI_PINCHTAB|PINCHTAB_)' |
  Sort-Object Name
```

查看项目合并配置文件、环境变量和默认值后的有效配置：

```powershell
node --input-type=module -e "import { resolveBrowserConfig } from './extensions/browser-client.js'; console.log(JSON.stringify(resolveBrowserConfig(), null, 2))"
```

修改环境变量后需要重启 Pi。`PINCHTAB_TOKEN` 和 `PINCHTAB_SESSION` 是敏感凭据，不要打印、提交或写入配置文件。

## 查看策略

插件默认先使用 `snapshot -i` 和 `get text` 读取页面结构与文字；只有需要查看布局、样式或图片时才使用 `screenshot`。

## 环境要求

- Node.js 20 或更高版本；
- 至少准备一个 Obscura 或 PinchTab 后端；
- 需要理解截图内容时，应使用支持视觉输入的模型。

## 开发验证

```bash
npm test
npm pack --dry-run
```

默认只运行本地单元测试，Obscura 和 PinchTab 真实集成测试会跳过。安装并启动对应后端后，可分别启用：

```bash
PI_OBSCURA_INTEGRATION=1 PI_OBSCURA_PATH=/path/to/obscura npm test
PI_PINCHTAB_INTEGRATION=1 PI_PINCHTAB_URL=http://127.0.0.1:9867 npm test
```

PowerShell：

```powershell
$env:PI_OBSCURA_INTEGRATION = "1"
$env:PI_OBSCURA_PATH = "C:\path\to\obscura.exe"
$env:PI_PINCHTAB_INTEGRATION = "1"
$env:PI_PINCHTAB_URL = "http://127.0.0.1:9867"
npm test
```

## 许可证

[MIT](./LICENSE)
