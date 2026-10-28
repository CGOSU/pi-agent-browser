# 会话记录

本文件按时间追加每次工作的完成内容、实际验证和遗留问题，不记录敏感信息或未经验证的结果。

## 记录格式

每次记录应包含日期、完成内容、实际验证及遗留问题。

## 会话

### 2026-10-28（扫码登录截图区域约束）

- 完成：在项目协作规范和 browser 工具描述中增加扫码截图约束：仅返回二维码及少量留白；无法裁剪时明确报告，不展示整页。记录当前 `browser qr` 尚为未裁剪截图别名。
- 验证：`git diff --check` 通过。
- 遗留：尚未实现二维码定位和裁剪，因此当前 `browser qr` 不可用于返回扫码登录截图。

### 2026-09-07（缺失 agent-browser 的可见提示）

- 完成：browser 工具在执行前检查 PATH；找不到 `agent-browser` 时，有 UI 的 Pi 会话会显示错误通知，工具结果也返回安装指引；无 UI 时仍返回可读错误。每次调用重新检查，不自动安装。
- 验证：新增缺失 CLI 提示、UI/无 UI 错误返回和安装后重试的针对性测试通过（1 项）；`git diff --check` 通过。完整运行 `node --test tests/agent-browser-cli.test.js` 时 9 项通过、1 项失败：Windows npm shim 路径用例在 macOS 上未通过。
- 遗留：Windows npm shim 路径用例在当前 macOS 环境失败，未在本次修改；完整测试结果不全通过。

### 2026-09-01（二维码 TUI 降级提示）

- 完成：确认 `browser qr` 实际返回 `text,image`，并在文本结果中附带 PNG 保存路径；但 Pi TUI 仅在 Kitty/iTerm2 图像协议终端中绘制图片；不支持图片的终端此前错误地提示“scan the image below”。现在显示 PNG 保存路径和明确的降级原因；Pi 设置关闭图片显示时单独提示。
- 验证：`npm test`（8 项通过）；`node --check extensions/agent-browser-cli.js`；`pi -ne -e ./extensions/index.ts --mode json --no-session "reply with OK"`；`git diff --check`。
- 遗留：Windows Terminal、VS Code 集成终端等仍不能在 TUI 内直接绘制二维码；需打开保存的 PNG 或改用支持 Kitty/iTerm2 的终端。

### 2026-08-31（命名 Profile 持久化）

- 完成：新增用户级命名 Profile 配置与安全名称校验；接入 `browser persist on <name>|off|status`，统一为 browser 命令和 session shutdown close 注入 Profile；切换在 close 后生效；补充多站点、安全和性能文档。
- 验证：`npm test`（6 项通过）；`node --test tests/agent-browser-cli.test.js tests/persistence.test.js`（12 项通过）；`pi -e ./extensions/index.ts --help`；`git diff --check` 均通过。
- 遗留：网站主动注销、Cookie 过期或设备风控时仍需重新登录；尚未发布新的 npm 版本。

### 2026-08-31（扫码登录二维码）

- 完成：增加 `browser qr [--full]` 命令别名，调用 agent-browser 截图并以内嵌图片返回；更新 README、当前状态和设计决策。
- 验证：`npm test`（4 项通过）；`node --check extensions/agent-browser-cli.js`；`pi -e ./extensions/index.ts --help`；`git diff --check` 均通过。
- 遗留：二维码识别不自动化，需要在扫码登录页面显式调用 `browser qr`。

### 2026-08-07

- 完成：初始化 Git 仓库，设置 `main` 分支及 `origin` 远程地址。
- 验证：`git remote -v` 已显示目标地址；待提交并推送。
- 遗留：无。

### 2026-08-07（README）

- 完成：将 README 重写为中文，保留安装、使用、命令、环境要求和许可证说明，删除项目无关的功能宣传与示例内容。
- 验证：检查 `git diff -- README.md`；文档变更已确认。
- 遗留：工作区已有未跟踪文件 `actual-bilibili-clean.png`，未处理。

### 2026-08-07（查看方式）

- 完成：为 `browser` 工具增加查看策略：优先使用 `snapshot -i` 和 `get text`，仅在需要视觉信息时使用截图。
- 验证：执行 `git diff --check`，通过。
- 遗留：未提交。

### 2026-08-07（优化）

- 完成：修复截图路径解析、支持带引号参数、缓存依赖检查、校验空命令，并更新 npm 仓库元数据与 README 查看策略。
- 验证：通过参数解析 4 个用例、截图路径解析 2 个用例、`npm pack --dry-run` 和 `git diff --check`。
- 遗留：未提交。

### 2026-08-09（Obscura MCP）

- 完成：将浏览器执行后端改为 Obscura MCP；新增 stdio JSON-RPC 客户端，支持启动、握手、串行调用、取消、超时、进程清理和 MCP 图片转换；保留常用 `browser` 命令接口。
- 完成：增加 Node 内置测试，覆盖命令映射、Windows 可执行文件选择、MCP 握手、并发串行化和图片结果转换。
- 验证：通过 `npm test`、真实 Obscura smoke test、`npm pack --dry-run` 和 `git diff --check`。
- 遗留：暂不支持完整页面截图和 Chromium 回退。

### 2026-08-09（真实集成测试）

- 完成：新增 `tests/obscura-integration.test.js`，默认跳过，设置 `PI_OBSCURA_INTEGRATION=1` 后使用本地 Obscura 和本地 HTTP 页面验证导航、交互引用、中文填写、JavaScript 取值和 PNG 截图。
- 验证：默认 `npm test` 为 5 项通过、1 项跳过；使用 Obscura v0.2.0 Windows x64 渲染版运行集成测试，6 项全部通过。
- 遗留：暂不支持完整页面截图和 Chromium 回退。

### 2026-08-10（可用性检查）

- 完成：检查当前环境中的测试、打包和浏览器启动条件。
- 验证：`npm test` 通过 5 项、跳过 1 项；`npm pack --dry-run` 和 `git diff --check` 通过。当前环境未找到 `obscura`、`obscura.exe` 或 `PI_OBSCURA_PATH`，实际 `browser open https://example.com` 无法启动。
- 遗留：安装 Obscura 渲染版并加入 PATH，或设置 `PI_OBSCURA_PATH` 后，才能进行真实浏览器验证。

### 2026-08-10（Obscura 路径复核）

- 完成：确认 Obscura 0.2.0 已安装于 `D:\tools\obscura\obscura.exe`。
- 验证：设置 `PI_OBSCURA_INTEGRATION=1 PI_OBSCURA_PATH='D:\tools\obscura\obscura.exe'` 后运行 `npm test`，6 项全部通过。
- 遗留：当前 Pi 进程环境仍未继承该路径，因此内置 `browser` 调用仍需重启 Pi，或在启动 Pi 前配置 `PI_OBSCURA_PATH`。

### 2026-08-10（Vite 开发页复核）

- 完成：使用 `browser open http://127.0.0.1:5173` 复核本地 Vite 页面。
- 验证：私网访问已通过，但 Obscura 0.2.0 退出 code 101；直接捕获 stderr 确认为处理 `/@vite/client` 时的 `Module already evaluated` 断言。静态本地页面集成测试仍通过。
- 遗留：当前需使用生产构建/静态预览，或等待 Obscura 修复 Vite HMR 模块兼容性。

### 2026-08-18（PinchTab 双后端）

- 完成：增加跨平台用户配置、PinchTab HTTP 客户端、自动后端健康选择与会话锁；保留 Obscura MCP，并在工具描述中明确失败时不改用 Playwright/Chrome。增加 PinchTab 默认跳过的真实本地页面集成测试。
- 验证：`npm test`：21 项中 19 项通过、2 项明确跳过；`npm pack --dry-run`：通过；`git diff --check`：通过；`node --check extensions/browser-client.js && node --check extensions/pinchtab-client.js && node --check extensions/obscura-mcp-client.js`：通过。
- 遗留：本次未启用 `PI_PINCHTAB_INTEGRATION=1`，因此未执行真实 PinchTab 服务测试。

### 2026-08-19（运行时环境变量）

- 完成：在 README 增加 Windows PowerShell 查看项目环境变量和解析后有效配置的命令，并提醒重启 Pi 及保护 PinchTab 凭据。
- 验证：`git diff --check` 通过。
- 遗留：无。

### 2026-08-19（扩展入口改名）

- 完成：将扩展入口从 `extensions/agent-browser.ts` 迁移为 `extensions/index.ts`，并更新 `package.json` 的 `pi.extensions` 指向；pi 对 index 入口折叠显示，加载名即为包名，不再出现 `:agent-browser.ts`。
- 验证：`npm test` 21 项中 19 项通过、2 项集成测试跳过；`npm pack --dry-run` 已包含 `extensions/index.ts`。
- 遗留：若需更优雅的加载前缀，再调整 `package.json` 的 `name` 并同步 README 安装命令。

### 2026-08-22（Obscura GitHub 页面崩溃诊断与默认后端调整）

- 完成：确认 `code=3221225725` 是 Windows `0xC00000FD` stack overflow；本机自行编译的 Obscura main（HEAD `39fe4d2`，Cargo 版本 `0.1.0`）在 GitHub PR #37261 仍退出。
- 修正：该源码已包含 `4f6d256` 的 ES module 修复；本次日志更接近 CSS selector matching/render 阶段，因此不再将当前崩溃归因于旧模块缺陷。
- 完成：默认后端改为 PinchTab（Chrome）；Obscura 仅在显式选择 `obscura` 或 `auto` 时使用。
- 验证：`npm test`；`D:/tools/obscura/obscura.exe --version`；原始 MCP 导航复现 `0xc00000fd`。
- 遗留：Obscura 的复杂 GitHub 页面 stack overflow 仍需上游定位；稳定后再考虑恢复默认。

### 2026-08-22（PinchTab 调用时自动启动）

- 完成：PinchTab 首次健康检查连接失败时，自动启动配置或 PATH 中的 `pinchtab server`；默认 `prompt` 不下载，`always` 才从固定版本官方 Release 下载并校验当前平台二进制，轮询 `/health`，并在 Pi 关闭时清理由插件启动的进程。
- 约束：`never|prompt|always` 控制下载策略；外部已运行的服务不会被接管或停止；远程服务不会触发下载；下载使用跨进程锁。
- 验证：`npm test`（22 项通过、2 项集成测试跳过）；`git diff --check` 通过。

### 2026-08-22（PinchTab 手动安装指引）

- 完成：固定官方 PinchTab 资产地址；缺少本地二进制或自动下载失败时，错误现在提供官方 Release 地址和 `PI_PINCHTAB_PATH` 配置指引。README 增加 Windows x64 手动下载、临时和永久环境变量设置示例。
- 验证：`npm test`（24 项通过、2 项集成测试跳过）；`git diff --check` 通过。
- 遗留：本机未完成真实 PinchTab + Chrome 集成验证。

### 2026-08-22（恢复 agent-browser CLI 默认后端）

- 完成：移除 PinchTab/Obscura 运行时代码和测试，恢复 `agent-browser` CLI 适配器；默认使用无头 Chrome，不自动安装依赖或下载浏览器。Windows npm shim 解析后直接启动目标可执行文件。
- 验证：`agent-browser doctor`（headless launch 通过）；`agent-browser open https://www.baidu.com`（成功）；`agent-browser open https://github.com/openai/codex/pull/37261` + `snapshot -i`（成功）；`npm test`；`pi -e ./extensions/index.ts --help`。
- 遗留：尚未发布新的 npm 版本。

### 2026-09-06（默认持久化 Profile）

- 完成：无持久化配置时默认使用命名 Profile `default`；保留 `persist off` 的显式停用语义，并补充默认路由测试。
- 验证：`npm test`（9 项通过）；`node --test tests/persistence.test.js`（7 项通过）；`git diff --check` 通过。
- 遗留：未使用真实账号验证第三方网站的长期会话策略；网站过期、主动注销或设备风控仍可能要求重新登录。
