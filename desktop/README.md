# 大肥鱼的真实 Linux 桌面

桌面 MCP 使用 [agent-sh/computer-use-linux](https://github.com/agent-sh/computer-use-linux)，运行在大肥鱼自己的 Linux GNOME 登录会话中。DSH 通过原生 MCP 配置注册服务器名 `cul`，因此模型看到的工具名为 `mcp__cul__…`。它操作该机器的真实桌面；桌面会话、MCP 进程和 DSH 服务的部署配置在仓库外管理，安装时应固定已验证的版本。

本次固定核心为 `0.7.37`（MIT），源码 commit `f6c367a9282c36c31010230c0d80667a7e30645c`；Linux x64 主程序 SHA256 为 `2c65a4d952043a703fbe22fa99b9a5c02342402b7d4dd5f41bb4223b08ef9135`。不安装另一套桌面，不使用 Xvfb。现有 GNOME Wayland 通过其 D-Bus、AT-SPI 和已启用的窗口扩展提供操作能力。

`launch.mjs` 从仓库外配置的 `desktop` 读取 `enabled`、`user`、`binary`。服务以 root 运行时仅用 `runuser` 启动该用户的 MCP，传入明确白名单的桌面环境，不传服务的模型密钥或配置内容；服务本身不切换用户。它动态发现真实 GNOME 会话，允许自动登录启动最多等待 45 秒。进程退出时仅清理自己拥有的 MCP 进程组。

原生 `@deepseek-ai/dsh-mcp-client` 使用服务器名 `cul`，通过 Node 执行本目录的 `launch.mjs`。桌面配置与 profile 中的这一行在服务器私有目录管理；`failOnStartupError:false` 保证桌面暂不可用时不使 QQ/B站宿主启动失败。该开关不代表桌面验收通过，仍需实际检查工具、截图和点击。

只注册工具本身，不往角色人设、系统提示词、聊天历史或记忆加入桌面使用说明，也不自动推送截图。平台 MCP 和已有专用工具继续承担日常操作；桌面能力由模型按需选择。本包不挂载桌面操作 skill 或额外的提示词插件。

原生 DSH MCP 客户端会自动拼接服务端发现或初始化的 `instructions`。`protocol.mjs` 在 stdio 握手时仅移除桌面 MCP 的该字段，同时支持现代 `server/discover` 和传统 `initialize`，保留服务器身份、能力、工具及所有操作结果；profile 同时用 `maxInstructionBytes:1` 防止意外重新注入指南。真实 GNOME 后台截图固定使用已验证的 `gnome-screenshot` 后端，避免每次调用出现截图门户对话框。

键盘固定使用本机 `ydotool` 后端，连接桌面用户私有运行目录中的 owner-only socket，避免 GNOME 输入门户没有弹窗却持续等待授权。鼠标继续使用真实桌面的绝对指针后端；不强制切换鼠标后端。`ydotool` 及用户服务在仓库外固定版本管理，不给 socket 或 `/dev/uinput` 开放全体用户权限。

`host/guard.mjs` 仅向 QQ 执行会话（`qq`，也是缺省模式）和 Bili 公开执行会话（`bili`）开放以下工具：

- 观察与诊断：`doctor`、`list_apps`、`list_windows`、`focused_window`、`get_app_state`、`screenshot`。
- 桌面交互：`click`、`drag`、`scroll`、`press_key`、`type_text`、`perform_action`、`set_value`。
- 窗口管理：`activate_window`、`move_window`、`resize_window`。

普通桌面操作直接经过执行会话的工具权限检查，不额外要求逐次管理员审批。Router 仍只有 `chopsticks_decide`；研究 Worker、开发 Worker、Bili 私信会话和未知模式均没有桌面权限。开发 Worker 原有的 `chopsticks_exec` 权限不变。`mcp__cul__run_shell`、任何 `setup_*` 和未列出的新工具不会自动开放；以后升级 MCP 也需单独评估工具权限。

工具可见性取当前 MCP 工具目录与允许列表的交集。MCP 延迟启动或重新注册工具后，guard 的 `tools/change` 订阅会刷新列表；移除的工具也会消失。工具执行同时经过独立的 guard 检查。

本目录只记录 DSH 侧的集成边界，不保存 GNOME 会话环境、访问凭据或运行数据。部署验收需检查真实 DSH 会话能列出桌面工具、取得真实 GNOME 截图并完成已授权的桌面交互；源码测试不代替这一验收，也不发送 QQ/Bili 测试消息。

本地验证：

```sh
node --test tests/desktop-guard.test.mjs tests/guard-lifecycle.test.mjs
npm test
```

测试实际安装 guard，检查发现与执行权限，并在 MCP 工具目录变化后检查新列表。它不读取生产桌面，也不执行实际点击。
