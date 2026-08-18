# 设计决策

本文件记录已经确认且会影响后续实现的决定。临时想法和普通操作不写入此处。

## 记录格式

每项决策应包含日期、决定、原因和约束。如果后续改变决定，应注明被替代条目，而不是删除历史。

## 已确认决策

### 2026-08-09：浏览器后端改用 Obscura MCP

- 决定：保留 pi 的 `browser` 工具和命令接口，内部改为启动 `obscura mcp` 并通过 stdio MCP 调用。
- 原因：绕过 Obscura CDP 的 `Input.insertText` 等兼容差异，减少 Chromium 和 agent-browser CLI 依赖，并让截图以 MCP 图片内容直接返回。
- 约束：Obscura 必须由用户预先安装；首版不实现 Chromium 回退，也不支持完整视口截图。
- 实现：MCP 客户端使用 Node 内置 `child_process`，不新增 MCP SDK 依赖；浏览器调用按顺序串行化。

### 2026-08-18：增加 PinchTab HTTP 后端和跨平台用户配置

- 决定：保留单一 `browser` 工具，通过后端协调器支持 Obscura MCP 与 PinchTab HTTP；PinchTab 默认地址为 `http://127.0.0.1:9867`。
- 原因：提供无需额外 MCP 进程的本地 HTTP 后端，同时不改变 pi 工具接口。
- 约束：只使用 Node.js 内置模块；不自动安装、启动或停止 PinchTab；凭据只从 `PINCHTAB_TOKEN`/`PINCHTAB_SESSION` 等环境变量透传，不写入用户配置。
- 配置：用户配置位于 Windows `%APPDATA%/pi-agent-browser/config.json` 或其他平台 `${XDG_CONFIG_HOME:-~/.config}/pi-agent-browser/config.json`，`PI_BROWSER_CONFIG` 可覆盖路径；环境变量按字段覆盖配置文件。

### 2026-08-18：自动后端选择在会话内锁定且禁止重放

- 决定：`auto` 首次操作前先健康检查 PinchTab，再尝试 Obscura；成功后锁定实际后端。
- 原因：允许冷启动时自动发现可用后端，同时避免同一用户操作被不同浏览器重复执行。
- 约束：只有首次健康检查或初始化失败可切换；任意 HTTP 请求或 MCP `tools/call` 发出后，失败必须原样报告，不得回退或重放；失败时不自行使用 Playwright 或 Chrome。
