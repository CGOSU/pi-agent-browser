# 当前状态

## 项目

- 名称：`pi-agent-browser`
- 定位：为 pi 提供单一 `browser` 工具，支持 Obscura MCP 和 PinchTab HTTP 浏览器后端。

## 当前事实

- `extensions/index.ts`（原 `extensions/agent-browser.ts`）注册名为 `browser` 的工具，并通过 `BrowserClient` 统一调度后端；pi 对 index 入口折叠显示，加载名即为包名。
- 默认 `auto` 模式首次操作时先健康检查 `http://127.0.0.1:9867` 的 PinchTab，再尝试 Obscura；选定后端后会话内锁定，不重放已发送操作。
- 配置文件为可选项：Windows 默认 `%APPDATA%/pi-agent-browser/config.json`，其他平台默认 `${XDG_CONFIG_HOME:-~/.config}/pi-agent-browser/config.json`；`PI_BROWSER_CONFIG` 可覆盖路径。
- 环境变量逐字段覆盖用户配置；保留 `PI_OBSCURA_*`，并支持 `PI_BROWSER_BACKEND`、`PI_PINCHTAB_URL`、`PINCHTAB_TOKEN` 和 `PINCHTAB_SESSION`。
- PinchTab 通过 Node 内置 `fetch` 调用 HTTP API；插件不安装、启动、停止服务，也不落盘 PinchTab 凭据。
- Obscura 通过 stdio MCP 调用，启动探测有有限超时；缺少后端时报告诊断错误，不自动切换到 Playwright 或 Chrome。
- 支持导航、快照、交互、表单、滚动、页面信息、截图、JavaScript、历史和标签页操作；截图可返回 Pi inline image。
- 真实 Obscura/PinchTab 集成测试默认跳过，分别由 `PI_OBSCURA_INTEGRATION=1` 和 `PI_PINCHTAB_INTEGRATION=1` 启用。

## 未完成事项

- 无。真实后端集成测试是否执行取决于本机是否主动提供对应服务。
