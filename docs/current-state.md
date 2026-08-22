# 当前状态

## 项目

- 名称：`pi-agent-browser`
- 定位：为 `pi` 提供单一 `browser` 工具，通过 `agent-browser` CLI 控制无头 Chrome。

## 当前事实

- `extensions/index.ts` 注册 `browser` 工具，并直接安全调用 PATH 中的 `agent-browser` 可执行文件。
- Windows 下会解析 npm 生成的 `agent-browser.cmd`，直接启动其目标可执行文件，不让用户命令参数经过 `cmd.exe`。
- 默认不自动安装 npm 包、不下载浏览器、不启动 PinchTab 或 Obscura。
- `agent-browser` 本身负责 Chrome for Testing 的安装、无头启动、网络代理和浏览器会话生命周期。
- 截图会读取 agent-browser 生成的图片并作为 Pi inline image 返回；过大的文本输出会保存到临时文件并截断展示。
- `agent-browser` 缺失时只返回手动安装提示：`npm install -g agent-browser && agent-browser install`。

## 验证状态

- `agent-browser doctor`：本机 headless launch 通过。
- `agent-browser open https://www.baidu.com`：成功。
- `agent-browser open https://github.com/openai/codex/pull/37261` 后执行 `snapshot -i`：成功。
- `npm test`：CLI 解析测试通过。
- `pi -e ./extensions/index.ts --help`：扩展加载通过。

## 未完成事项

- 尚未发布新的 npm 版本；用户通过 Git 或本地路径安装时可直接使用当前实现。
- Obscura、PinchTab 相关历史诊断保留在 `docs/decisions.md`、`docs/pitfalls.md` 和 `docs/session-log.md`，不再参与当前运行时。
