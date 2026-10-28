# 当前状态

## 项目

- 名称：`pi-agent-browser`
- 定位：为 `pi` 提供单一 `browser` 工具，通过 `agent-browser` CLI 控制无头 Chrome。

## 当前事实

- `extensions/index.ts` 注册 `browser` 工具，并直接安全调用 PATH 中的 `agent-browser` 可执行文件。
- Windows 下会解析 npm 生成的 `agent-browser.cmd`，直接启动其目标可执行文件，不让用户命令参数经过 `cmd.exe`。
- 默认不自动安装 npm 包、不下载浏览器、不启动 PinchTab 或 Obscura。
- `agent-browser` 本身负责 Chrome for Testing 的安装、无头启动、网络代理和浏览器会话生命周期。
- 截图会读取 agent-browser 生成的图片并作为 Pi inline image 返回，同时在文本结果中附带 PNG 保存路径；`browser qr` 当前仍是截图别名，尚未自动定位或裁剪二维码。不支持 Kitty/iTerm2 图像协议的终端只显示截图保存路径；过大的文本输出会保存到临时文件并截断展示。扫码截图约束及待办见 `docs/decisions.md`。
- `browser persist on <name>|off|status` 管理用户级命名 Chrome Profile；默认关闭，配置只保存名称，Profile 数据保存在本地用户数据目录。
- 默认使用命名 Profile `default` 持久化登录状态；`browser persist on <name>|off|status` 可切换、停用或查看状态。Profile 在浏览器会话内锁定，切换或停用在 close 后的下一次启动生效；原生 `AGENT_BROWSER_PROFILE` 优先，状态输出不包含 Profile 路径。
- `agent-browser` 不在 PATH 时，browser 工具立即返回错误和手动安装指引 `npm install -g agent-browser && agent-browser install`；有 UI 的 Pi 会话还会显示错误通知。插件不会自动安装，每次 browser 命令都会重新检查。

## 验证状态

- `agent-browser doctor`：本机 headless launch 通过。
- `agent-browser open https://www.baidu.com`：成功。
- `agent-browser open https://github.com/openai/codex/pull/37261` 后执行 `snapshot -i`：成功。
- `npm test`：6 项通过。
- `node --test tests/agent-browser-cli.test.js tests/persistence.test.js`：12 项通过。
- `pi -e ./extensions/index.ts --help`：扩展加载通过。

## 未完成事项

- `browser qr` 尚未实现二维码定位和单独裁剪；在此能力可用前，扫码登录不得把整页截图作为二维码图返回，具体约束见 `docs/decisions.md`。
- 尚未发布新的 npm 版本；用户通过 Git 或本地路径安装时可直接使用当前实现。
- Obscura、PinchTab 相关历史诊断保留在 `docs/decisions.md`、`docs/pitfalls.md` 和 `docs/session-log.md`，不再参与当前运行时。
