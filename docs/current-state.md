# 当前状态

## 项目

- 名称：`pi-agent-browser`
- 定位：为 pi 提供基于 Obscura MCP 的浏览器自动化工具。

## 当前目标

- 使用 Obscura MCP 替代原有的 `agent-browser` CLI + Chromium 调用链。
- 保留 `browser` 工具和常用命令接口，降低现有会话迁移成本。

## 已知状态

- `extensions/agent-browser.ts` 已通过 stdio MCP 调用 Obscura。
- `extensions/obscura-mcp-client.js` 负责进程生命周期、MCP 握手、请求串行化、超时和结果转换。
- `tests/obscura-integration.test.js` 提供可选的真实 Obscura 本地页面集成测试，需设置 `PI_OBSCURA_INTEGRATION=1`。
- 当前支持导航、快照、交互、表单、滚动、获取页面信息、截图、JavaScript、历史记录和标签页操作。
- 截图当前只支持视口截图，不支持 `screenshot --full`。
- Obscura 路径和运行参数通过 `PI_OBSCURA_*` 环境变量配置。
- 依赖 Obscura 渲染版可执行文件，不再自动安装 `agent-browser` 或 Chromium。

## 待处理

- 评估是否需要保留 Chromium/CDP 作为可选回退后端。

## 最近一次更新

- 2026-08-09：完成 Obscura MCP 后端初版及客户端测试。
