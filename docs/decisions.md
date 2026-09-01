# 设计决策

本文件记录已经确认且会影响后续实现的决定。临时想法和普通操作不写入此处。

## 记录格式

每项决策应包含日期、决定、原因和约束。如果后续改变决定，应注明被替代条目，而不是删除历史。

## 已确认决策

### 2026-09-01：二维码截图在不支持图片协议的终端显示保存路径

- 决定：`browser qr` 继续返回标准 Pi image content；当 TUI/终端不支持 inline image 或用户关闭图片显示时，结果改为显示 PNG 保存路径和降级提示。
- 原因：Pi TUI 只会在支持 Kitty/iTerm2 图像协议的终端绘制图片；Windows Terminal、VS Code 集成终端、普通 PowerShell/ConHost、tmux 等环境不能通过扩展强行获得图片能力。
- 约束：不伪造 Kitty 控制序列，也不自动启动外部图片查看器；用户可在支持的终端中使用 inline image，或打开结果中的保存文件。

### 2026-08-31：命名 Profile 持久化并按信任边界隔离

- 决定：提供 `browser persist on <name>|off|status`，由用户显式选择命名 Profile；Profile 放在用户本地数据目录，默认不启用。
- 原因：Chrome 原生按网站 origin 保存多个网站的 Cookie、LocalStorage、IndexedDB 和 Service Worker，同时通过不同 Profile 隔离不同账号、用途和 Agent 的登录态。
- 约束：Profile 名称只允许安全标识符；配置只保存当前名称，不保存认证数据；不复用日常 Chrome Profile；浏览器会话期间锁定 Profile，切换需 close 后再启动；`AGENT_BROWSER_PROFILE` 优先于插件配置；`off` 不删除旧 Profile。
- 风险：同一命名 Profile 内的网站共享同一信任边界；网站过期、风控或主动注销仍会要求重新登录，Profile 数据也需要用户自行保护和清理。

### 2026-08-31：增加扫码登录截图别名

- 决定：增加 `browser qr [--full]` 命令，将其映射为 agent-browser 的截图命令，并把生成图片以内嵌 image content 返回。
- 原因：用户扫码登录时可直接在 Pi 中扫描二维码，不需要手动定位截图文件。
- 约束：不自动判断页面是否包含二维码；需要扫码时由模型或用户显式调用 `qr`，仍使用当前页面截图。

### 2026-08-22：恢复 agent-browser CLI 为默认后端

- 决定：`browser` 只调用 PATH 中的 `agent-browser` CLI，默认使用其无头 Chrome；不再在运行时启动、下载或配置 PinchTab/Obscura。
- 原因：实际使用中 PinchTab 的 token、Chrome 路径、IDPI 域名白名单和服务生命周期增加了与“打开网页”无关的配置成本；agent-browser 已在本机成功打开百度和 GitHub PR 页面。
- 约束：缺少 CLI 时只给出 `npm install -g agent-browser && agent-browser install` 提示；Windows 解析 npm `.cmd` shim 后直接启动目标程序，避免将命令参数交给 `cmd.exe`；旧的 PinchTab/Obscura 默认后端决策由本条替代，但历史记录保留。

### 2026-08-09：浏览器后端改用 Obscura MCP

- 决定：保留 pi 的 `browser` 工具和命令接口，内部改为启动 `obscura mcp` 并通过 stdio MCP 调用。
- 原因：绕过 Obscura CDP 的 `Input.insertText` 等兼容差异，减少 Chromium 和 agent-browser CLI 依赖，并让截图以 MCP 图片内容直接返回。
- 约束：Obscura 必须由用户预先安装；首版不实现 Chromium 回退，也不支持完整视口截图。
- 实现：MCP 客户端使用 Node 内置 `child_process`，不新增 MCP SDK 依赖；浏览器调用按顺序串行化。

### 2026-08-22：首次调用自动启动 PinchTab

- 决定：默认 PinchTab 后端首次健康检查遇到连接失败时，先查找本地可执行文件并启动 `pinchtab server`；默认 `installPolicy=prompt` 不静默下载，只有 `always` 才从固定版本的官方 Release 下载并校验当前平台二进制，`never` 完全禁止下载。Pi 退出时只停止由本插件启动的进程。
- 原因：保留零窗口启动便利性，同时避免运行时未经确认改变本机软件供应链。
- 约束：只访问固定官方 GitHub Release 并校验固定 SHA-256；已有外部服务不启动第二份；远程 PinchTab 仅通过 HTTP 使用；下载使用跨进程锁；缺少二进制或自动下载失败时，错误提供官方资产地址，推荐用户通过 `PI_PINCHTAB_PATH` 手动安装。

### 2026-08-18：增加 PinchTab HTTP 后端和跨平台用户配置

- 决定：保留单一 `browser` 工具，通过后端协调器支持 Obscura MCP 与 PinchTab HTTP；PinchTab 默认地址为 `http://127.0.0.1:9867`。
- 原因：提供无需额外 MCP 进程的本地 HTTP 后端，同时不改变 pi 工具接口。
- 约束：只使用 Node.js 内置模块；不自动安装、启动或停止 PinchTab；凭据只从 `PINCHTAB_TOKEN`/`PINCHTAB_SESSION` 等环境变量透传，不写入用户配置。
- 配置：用户配置位于 Windows `%APPDATA%/pi-agent-browser/config.json` 或其他平台 `${XDG_CONFIG_HOME:-~/.config}/pi-agent-browser/config.json`，`PI_BROWSER_CONFIG` 可覆盖路径；环境变量按字段覆盖配置文件。

### 2026-08-22：默认使用 PinchTab 驱动 Chrome

- 决定：默认后端从 `auto` 改为 `pinchtab`；PinchTab 不可用时默认直接报错，不自动切换到 Obscura。Obscura 仍可通过 `PI_BROWSER_BACKEND=obscura` 或配置文件显式启用。
- 原因：当前 Obscura main 在 GitHub 复杂页面仍会触发 Windows stack overflow；PinchTab/Chrome 作为默认路径更稳定。
- 约束：不改变现有命令接口、PinchTab 地址或后端会话锁定行为；待 Obscura 稳定后再显式改回默认值。

### 2026-08-18：自动后端选择在会话内锁定且禁止重放

- 决定：`auto` 首次操作前先健康检查 PinchTab，再尝试 Obscura；成功后锁定实际后端。
- 原因：允许冷启动时自动发现可用后端，同时避免同一用户操作被不同浏览器重复执行。
- 约束：只有首次健康检查或初始化失败可切换；任意 HTTP 请求或 MCP `tools/call` 发出后，失败必须原样报告，不得回退或重放；失败时不自行使用 Playwright 或 Chrome。
