# pi-agent-browser

为 `pi` 提供浏览器自动化工具。通过 Obscura MCP 访问网页、读取内容、操作元素和获取截图。

## 安装

```bash
pi install npm:pi-agent-browser
```

不安装到 pi 时，也可以直接加载：

```bash
pi -e npm:pi-agent-browser
```

另外需要安装 [Obscura](https://github.com/h4ckf0r0day/obscura)：

- Windows：下载 `obscura-x86_64-windows.zip`，解压并将目录加入 `PATH`；
- Linux/macOS：下载对应平台的渲染版压缩包并将 `obscura` 加入 `PATH`。

也可以通过 `PI_OBSCURA_PATH` 指定可执行文件的完整路径。

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
| `close` | 关闭浏览器 |

页面发生变化后，重新执行 `snapshot -i` 获取最新引用。

## 配置

| 环境变量 | 说明 |
| --- | --- |
| `PI_OBSCURA_PATH` | Obscura 可执行文件路径 |
| `PI_OBSCURA_STEALTH=1` | 启用隐身模式 |
| `PI_OBSCURA_PROXY` | HTTP/SOCKS5 代理 |
| `PI_OBSCURA_USER_AGENT` | 自定义 User-Agent |
| `PI_OBSCURA_ALLOW_PRIVATE_NETWORK=1` | 允许访问本机和私有网络 |

## 查看策略

插件默认先使用 `snapshot -i` 和 `get text` 读取页面结构与文字；只有需要查看布局、样式或图片时才使用 `screenshot`。

## 环境要求

- Node.js 20 或更高版本；
- Obscura 渲染版；
- 需要理解截图内容时，应使用支持视觉输入的模型。

## 开发验证

```bash
npm test
npm pack --dry-run
```

默认只运行本地测试。安装 Obscura 后，可运行真实 MCP 集成测试：

```bash
PI_OBSCURA_INTEGRATION=1 PI_OBSCURA_PATH=/path/to/obscura npm test
```

PowerShell：

```powershell
$env:PI_OBSCURA_INTEGRATION = "1"
$env:PI_OBSCURA_PATH = "C:\\path\\to\\obscura.exe"
npm test
```

## 许可证

[MIT](./LICENSE)
