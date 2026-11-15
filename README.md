<p align="center">
  <img src="assets/deepseek.png" width="104" alt="DeepSeek logo">
</p>

<h1 align="center">dsh-turn-notifier</h1>

<p align="center">
  <a href="README.en.md">English</a> · 中文
</p>

<p align="center">
  仿照 Codex 的 <code>agent-turn-complete</code>：每轮结束时，把最终回复摘要送进 macOS 通知中心。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-black?logo=apple" alt="Platform: macOS">
  <img src="https://img.shields.io/badge/DeepSeek%20Harness-Host%20Plugin-4D6BFE" alt="DeepSeek Harness Host Plugin">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT">
  <a href="https://github.com/Xm-Coding/dsh-turn-notifier"><img src="https://img.shields.io/badge/GitHub-dsh--turn--notifier-181717?logo=github" alt="GitHub repository"></a>
</p>

一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 macOS Host 插件。本轮会话结束回复，你会收到带有最终回复摘要的系统通知。

> **仅支持 macOS。** 需要 DeepSeek Harness `0.2.1-rc.2` 至 `0.2.x`，以及 Node.js `>=24.9`；桌面端自带的运行时已满足。通知助手同时包含 Apple Silicon 与 Intel 可执行文件，无需安装 Xcode 或 `terminal-notifier`。

## 当前版本能力

- ✅ 每轮结束只通知一次，正文为最终助手回复摘要。
- ✅ 原生 DeepSeek 图标通知；原生 helper 使用 legacy `NSUserNotification`，AppleScript 应用作为回退。
- ✅ 原生 helper 在投递 10 秒后仍将通知保留在通知中心，不会主动删除；屏幕横幅停留时长由 macOS 通知设置控制。
- ✅ **打开会话路径已修复**：Host 记录通知对应的会话，Client 动态注入 `remote.turnNotifier` 后领取动作并调用 `uiWorkspace.openSession`。已在真实 headless GUI 中验证 `registerClient`/`claimAction`。

## ✨ 核心特性

- 🔔 **真正的本轮完成通知**：等待 Harness 提交 `turn/end`的终止后通知
- 💬 **通知里直接看回复**：正文取本轮最后一条助手消息中的文本，副标题显示完成状态与会话标题（没有标题时显示当前工作目录名称）。
- 🐋 **DeepSeek 图标**：通知使用随插件附带的原生 helper；插件管理器与通知图标保持一致。
- 🤫 **默认克制**：子代理、停止和出错默认不通知；需要时可以分别开启。
- 🔊 **声音与正文可调**：支持系统提示音、静音、正文长度限制，以及只显示完成状态而不显示回复内容。
- ⏱ **通知中心保留**：原生 helper 在 10 秒时做保留检查，不删除已投递通知；系统横幅何时收起由 macOS 决定。
- 🌐 **中英文文案**：通知状态、错误和停止文案来自 `locale/`，可通过 `locale: auto | zh | en` 切换。
- ♻️ **有界投递重试**：临时发送失败按 1/2/4 秒退避重试最多 3 次；助手缺失、平台不支持等确定性错误不重试。
- 🔒 **本地处理**：不发送网络请求、不做遥测、不记录通知正文。

## 🚀 安装

### 从 GitHub 安装（推荐）

**官方桌面端（`desktop` profile）：**

```bash
dsh plugin --profile desktop add github:Xm-Coding/dsh-turn-notifier
```

**普通 `dsh web`：**

```bash
dsh plugin --profile web add github:Xm-Coding/dsh-turn-notifier
```

**自定义 profile：**

```bash
dsh plugin --profile <profile> add github:Xm-Coding/dsh-turn-notifier
```

也可以在 DSH 的插件页添加 `github:Xm-Coding/dsh-turn-notifier`，或直接填入仓库地址。

> 安装时需要能够访问 GitHub。安装后如果尚未立即生效，完全退出并重新打开 Harness。

### 本地开发安装

克隆仓库后，用 `link:` 安装本地目录，修改源码即可立即参与调试：

```bash
git clone https://github.com/Xm-Coding/dsh-turn-notifier.git
cd dsh-turn-notifier
dsh plugin --profile desktop add link:/absolute/path/dsh-turn-notifier
```

> `link:` 表示链接安装：之后不要移动、重命名或删除源码目录。若希望安装一份独立拷贝，把 `link:` 改成 `file:`；拷贝安装后，源码更新不会自动同步。

### 允许系统通知

安装后如果尚未立即生效，完全退出并重新打开 DeepSeek Harness。

原生 helper 使用 legacy `NSUserNotification`，macOS 不一定会弹出权限请求。若没有看到通知，请打开 **系统设置 → 通知 → DeepSeek Notifier**，确认通知未被关闭，并按需要选择横幅或提醒、开启声音。AppleScript 回退应用也使用 **DeepSeek Notifier** 这个名称。

## 🔔 通知效果

一条典型通知的内容如下：

> **DeepSeek Harness**<br>
> **本轮已完成 · 安装通知插件**<br>
> 插件已安装，通知链路验证通过。现在每轮结束都会收到通知。

副标题中的会话标题来自 Harness 的会话标题，超过 60 个字符会截断；会话还没有标题，或设置了 `showSessionTitle: false` 时，改为显示当前工作目录的名称（会话中切换过目录时取切换后的目录）。

| 发生了什么 | 默认是否通知 |
| --- | --- |
| 本轮正常完成 | ✅，正文为最终助手回复摘要 |
| 达到本轮输出上限 | ✅，副标题显示“本轮已达输出上限” |
| 正在流式输出或调用工具 | 不通知，继续等待整轮结束 |
| 子代理完成 | 默认不通知，可用 `includeSubagents` 开启 |
| 本轮被手动、上级任务或钩子停止 | 默认不通知，可用 `notifyOnCancel` 开启；副标题区分停止原因，正文不显示停止前的中间回复 |
| 会话关闭、Harness 退出等导致的停止 | 不通知 |
| 本轮出错 | 默认不通知，可用 `notifyOnError` 开启；正文显示错误信息，而不是出错前的中间回复 |

默认正文最多保留 **240 个 Unicode 字符**，过长的回复会以 `…` 截断。

原生 helper 的通知在 **10 秒**后仍保留在通知中心，不会被插件主动删除；屏幕横幅的停留时长由 macOS 控制。打开会话使用 Client 动态注入的 `remote.turnNotifier`

## ⚙️ 配置

默认配置位于 [`cordis.patch.yml`](cordis.patch.yml)。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 是否启用通知 |
| `includeSubagents` | `false` | 是否同时通知子代理会话 |
| `includeMessage` | `true` | 是否在正文中包含最终助手文本或错误信息；设为 `false` 时所有通知都只显示状态 |
| `showSessionTitle` | `true` | 副标题是否显示会话标题；设为 `false` 时显示当前工作目录名称 |
| `notifyOnError` | `false` | 本轮出错时是否通知 |
| `notifyOnCancel` | `false` | 本轮被手动、上级任务或钩子停止时是否通知；会话关闭或 Harness 退出不通知 |
| `title` | `DeepSeek Harness` | 通知标题 |
| `soundName` | `Glass` | macOS 提示音名称；空字符串表示静音 |
| `maxCharacters` | `240` | 正文字符上限，允许 `40`–`2000` |
| `locale` | `auto` | 通知状态文案语言：`auto` 回落到中文，也可设为 `zh` 或 `en` |

要覆盖配置，请在当前 **profile** 的 `cordis.patch.yml` 中，为 `dsh-turn-notifier` 写入完整的 `config`。同名覆盖会替换整个配置对象，不要只写需要修改的单个字段。

例如：关闭提示音、允许出错通知，并隐藏回复正文：

```yaml
- id: dsh-turn-notifier
  name: 'dsh-turn-notifier'
  config:
    enabled: true
    includeSubagents: false
    includeMessage: false
    showSessionTitle: true
    notifyOnError: true
    notifyOnCancel: false
    title: DeepSeek Harness
    soundName: ''
    maxCharacters: 240
    locale: auto
```

修改后按 Harness 的热加载结果继续使用；若未生效，重启一次即可。

## 🔒 隐私与安全

- 插件在本轮结束时，按记录的序号从 Harness 会话历史读取本轮最终助手消息的文本，只在内存中截断并交给本机通知助手。
- 原生 helper 通过 profile 私有临时请求文件接收正文，文件在投递后删除；动作文件在 Host 读取后清空。AppleScript 回退通过进程参数传递，**不会拼接进 AppleScript 源码**。
- 插件自己不保存通知正文：它在 Harness 投影缓存（`session_projcache`）里只存本轮序号、是否有消息和消息序号，不存文本。
- 通知发送失败时，Host 日志只记录错误类别（如 `exit-code=1`、`timeout signal=SIGTERM`、`code=HELPER_MISSING`），不记录正文、命令行或通知助手的输出。
- macOS 可能在锁定屏幕或通知中心保留通知预览。涉及敏感回复时，请设置 `includeMessage: false`，或调整系统的通知预览选项。会话标题也可能包含敏感内容，可另设 `showSessionTitle: false`；两者都关闭后仍会显示状态和工作目录名称，这不是完全匿名的模式。
- 插件不联网、不上传会话，也没有第三方分析服务。

## ❓ 常见问题

<details>
<summary><strong>装好了，为什么没有收到通知？</strong></summary>

1. 确认安装到了当前正在使用的 profile：桌面端通常是 `desktop`，普通 `dsh web` 通常是 `web`。
2. 完全退出并重新打开 Harness，排除 Host 插件尚未热加载的情况。
3. 打开 **系统设置 → 通知 → DeepSeek Notifier**，确认通知没有被关闭，并按需要开启横幅或提醒、声音。
4. 检查专注模式是否屏蔽了通知。
5. 查看 Harness 的 Host 日志中是否出现 `[dsh-turn-notifier] notification failed`。若末尾是 `code=HELPER_MISSING`，重新生成原生助手：
   ```bash
   npm run build:native
   ```
   AppleScript 回退助手缺失时，运行 `native/build-macos-notifier.sh`。
</details>

<details>
<summary><strong>点击通知后为什么没有打开会话？</strong></summary>

请确认：

1. 已重启 Harness 加载当前 Client bundle；
2. Harness Client 正在运行，并且插件已在当前 profile 加载；
3. 通知对应的会话仍然存在且未过期；
4. Client 已经注册到当前 Host。

如果动作已过期、Client 未运行或会话不存在，点击不会打开目标会话。
</details>

<details>
<summary><strong>如何只提醒完成，不在通知里显示回复？</strong></summary>

把 `includeMessage` 设为 `false`。此时正文只显示“本轮已完成”等状态，出错时也不显示错误详情，适合锁定屏幕或共享电脑场景。
</details>

<details>
<summary><strong>修改源码后没有变化？</strong></summary>

`link:` 安装会直接使用源码目录，但 Host JavaScript 更新仍可能需要重启 Harness。若移动了源码目录，请先卸载，再从新路径重新执行 `add link:<新路径>`。`file:` 拷贝安装则需要重新安装才能同步修改。原生 helper 的二进制更新后也需要重启 Harness 才会加载。
</details>

## 📦 更新与卸载

`link:` 安装更新源码后，重启 Harness 以重新加载 Host 代码和原生 helper。`file:` 安装请重新执行安装命令。

卸载时，把 `<profile>` 换成实际使用的 profile：

```bash
dsh plugin --profile <profile> remove dsh-turn-notifier
```

卸载不会删除你的本地源码目录。

## 📄 许可证

[MIT](LICENSE)
