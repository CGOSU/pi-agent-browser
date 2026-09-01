# 开发踩坑记录

本文件记录容易复发且不直观的问题。一次性报错、普通开发流水和未经验证的猜测不写入此处。

## 记录格式

每条记录包含：

- 日期：发现或最后验证日期；
- 现象：可观察到的错误或异常行为；
- 根因：经过确认的直接原因；
- 修复：已验证有效的处理方法；
- 验证：复现、测试或检查命令及结果。

## 已知问题

### 2026-09-01：不支持图片协议的终端无法在 Pi TUI 显示二维码

- 现象：`browser qr` 返回成功，但 TUI 中没有二维码。
- 根因：Pi TUI 的 `Image` 组件只在 Kitty/iTerm2 图像协议终端中输出图片控制序列；Windows Terminal、VS Code 集成终端、普通 PowerShell/ConHost、tmux 等环境会返回 `images: null`。
- 处理：扩展保留 image content，同时在不支持 inline image 时显示 PNG 保存路径；不要仅设置 `PI_IMAGE_PROTOCOL`，除非外层终端确实实现了对应协议。
- 验证：`agent-browser open https://example.com` 后执行 `agent-browser screenshot` 成功生成 PNG；Pi JSON 工具结果包含 `text,image`；回归测试覆盖无图片终端提示。

### 2026-08-22：Obscura main 打开 GitHub PR 页面触发 Windows stack overflow

- 现象：`browser open https://github.com/openai/codex/pull/37261` 返回 `Obscura exited before completing the request (code=3221225725, signal=none)`。
- 根因：`3221225725 = 0xC00000FD = STATUS_STACK_OVERFLOW`。当前自行编译的 Obscura main（HEAD `39fe4d2`，Cargo 版本字符串为 `0.1.0`）仍可见 `thread 'main' has overflowed its stack`；复现时 stderr 大量落在 CSS selector matching/render 阶段。此前的 ES module 重复求值缺陷（issue #591，修复 commit `4f6d256`）已包含在该源码中，因此不能再把当前崩溃简单归因于旧模块修复。
- 处理：默认改用 PinchTab 驱动 Chrome。设置 `OBSCURA_SCRIPT_DEADLINE_MS=1` 可验证跳过页面脚本后导航成功，但不是正常使用的修复。
- 验证：`D:/tools/obscura/obscura.exe --version` 为 `0.1.0`；源码仓库 HEAD 为 `39fe4d2` 且包含 `4f6d256`；原始 MCP 导航仍复现 `0xc00000fd`。

### 2026-08-10：Obscura 0.2.0 打开 Vite 开发页会崩溃

- 现象：访问包含 Vite HMR 注入脚本的页面时，Obscura 退出并返回 code 101。
- 根因：Obscura 0.2.0 在处理 `/@vite/client` 等模块时触发 Deno 的 `Module already evaluated` 断言；不是私网权限错误。
- 修复：优先使用生产构建或不注入 HMR 的静态预览；等待 Obscura 修复后再恢复开发服务器直连。
- 验证：`http://127.0.0.1:5173` 返回 `/@vite/client` 和 `/@react-refresh`，带 `--allow-private-network` 直接调用 MCP 可复现崩溃；静态本地页面集成测试仍通过。
