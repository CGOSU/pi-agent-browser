# 当前状态

## 项目

- 名称：`pi-agent-browser`
- 定位：为 pi 提供单一 `browser` 工具，支持 Obscura MCP 和 PinchTab HTTP 浏览器后端。

## 当前事实

- `extensions/index.ts`（原 `extensions/agent-browser.ts`）注册名为 `browser` 的工具，并通过 `BrowserClient` 统一调度后端；pi 对 index 入口折叠显示，加载名即为包名。
- 默认使用 `http://127.0.0.1:9867` 的 PinchTab（由 PinchTab 控制 Chrome）；只有显式设置 `backend=auto` 或 `PI_BROWSER_BACKEND=auto` 才会在 PinchTab 不可用时尝试 Obscura。
- 配置文件为可选项：Windows 默认 `%APPDATA%/pi-agent-browser/config.json`，其他平台默认 `${XDG_CONFIG_HOME:-~/.config}/pi-agent-browser/config.json`；`PI_BROWSER_CONFIG` 可覆盖路径。
- 环境变量逐字段覆盖用户配置；保留 `PI_OBSCURA_*`，并支持 `PI_BROWSER_BACKEND`、`PI_PINCHTAB_URL`、`PINCHTAB_TOKEN` 和 `PINCHTAB_SESSION`。
- PinchTab 通过 Node 内置 `fetch` 调用 HTTP API；插件不安装、启动、停止服务，也不落盘 PinchTab 凭据。
- Obscura 通过 stdio MCP 调用，启动探测有有限超时；缺少后端时报告诊断错误，不自动切换到 Playwright 或 Chrome。
- 支持导航、快照、交互、表单、滚动、页面信息、截图、JavaScript、历史和标签页操作；截图可返回 Pi inline image。
- 真实 Obscura/PinchTab 集成测试默认跳过，分别由 `PI_OBSCURA_INTEGRATION=1` 和 `PI_PINCHTAB_INTEGRATION=1` 启用。
- 本机自行编译的 Obscura main（HEAD `39fe4d2`，Cargo 版本字符串仍为 `0.1.0`）打开 GitHub PR 页面仍可能以 Windows `0xC00000FD`（stack overflow）退出；当前复现日志落在 CSS selector matching/render 阶段，不能再归因于已包含修复的 ES module 重复求值缺陷。

## 未完成事项

- Obscura main 的 GitHub 复杂页面栈溢出仍需上游进一步定位/修复；默认已切换到 PinchTab，真实后端集成测试是否执行取决于本机是否主动提供对应服务。
