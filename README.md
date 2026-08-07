# pi-agent-browser

为 `pi` 提供浏览器自动化工具。通过 `agent-browser` 控制真实浏览器，支持访问网页、读取页面内容、操作元素和获取
## 安装

```bash
pi install npm:pi-agent-browser
```

不安装到 pi 时，也可以直接加载：

```bash
pi -e npm:pi-agent-browser
```

首次使用时，如果未安装 `agent-browser`，插件会提示安装，并下载 Chromium。

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
| `snapshot -i` | 查看页面中的可交互元素及其引用，如 `@e1` |
| `click <@ref>` | 点击元素 |
| `fill <@ref> <text>` | 清空并填写输入框 |
| `type <@ref> <text>` | 在输入框中追加文本 |
| `select <@ref> <value>` | 选择下拉选项 |
| `press <key>` | 按键，如 `Enter`、`Tab` |
| `scroll <dir> [px]` | 滚动页面 |
| `get text\|url\|title [@ref]` | 获取页面或元素信息 |
| `wait <@ref\|ms>` | 等待元素或指定毫秒数 |
| `screenshot [--full]` | 获取截图并返回给模型 |
| `close` | 关闭浏览器 |

页面发生变化后，重新执行 `snapshot -i` 获取最新的元素引用。

## 环境要求

- Node.js 20 或更高版本
- 需要理解截图内容时，应使用支持视觉输入的模型

手动安装依赖：

```bash
npm install -g agent-browser
agent-browser install
```
