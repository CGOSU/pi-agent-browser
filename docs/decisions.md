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
