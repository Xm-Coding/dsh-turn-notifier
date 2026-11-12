# 通知交互实施状态

按 [实施说明](notification-interaction-plan.zh-CN.md) 第 13 节模板记录。**任务进度、待决策、待验证和下一步任务以实施说明 [第 0 节](notification-interaction-plan.zh-CN.md#progress) 为准**；本文件记录证据、实现细节和变更经过。未验证项写“未验证”。

- 最近更新：2026-10-26
- 插件 commit／版本：`1.1.0`，基线 commit `9c50e3d9bab23d72d8c15c84f5ddaba7d39e6619`；以下改动全部在 `main` 分支工作区中，**尚未提交**，`docs/` 也未纳入 git
- Harness 版本／源码 SHA／固定链接：本机桌面版 `0.2.1-rc.3`；已核对源码 `master` `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`（`package.json` 版本同为 `0.2.1-rc.3`）
- macOS／CPU／Node：macOS 27.0.1，arm64；shell Node `v24.19.0`，桌面运行时 Node `24.21.0`。本轮原生助手使用 AppleScript，不需要 Swift 编译器
- profile／模式：`desktop`，本机桌面版
- 当前里程碑：M1 进行中，D-1 已选“Harness 构建链”。A4 已完成；A2 完成 1–4 条；A0 已完成生成器、Host Remote、真实临时 Web Host 的 Client bundle 装载与 `/api/turnNotifier/ping` RPC；A1 已完成登记表主体（deployment/锁/记录/清理）；A3 已完成 Client Remote 注册/领取/回执、ActionRouter 与真实临时 Web Host RPC；B1 已实现 legacy NSUserNotification helper、Host 文件桥接、Client open 路径，真实 helper 投递和 Host 启动通过；通知内回复已按要求移除；真实浏览器点击仍未验证；D1-1、D2 Host 侧、X2、X3 已完成，X1 代码完成但实际点击待验证；B3/B4 仍待实现

## 已核实接口

以下链接固定到 `22ddee3`。

- **投影注册／读取**：`register()` 返回可调用的 thenable，`await` 后得到 handle，用 `handle.stateOf(session)` 读取；registry 级 `stateOf(session, key)` 已弃用，首次读取会打一次弃用警告。见 [session-projection README](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/session/session-projection/README.md#deprecated-plugin-compatibility)、[升级指南 v0.2.1-rc.2](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/upgrade-guide/v0.2.1-rc.2/session-projection-handles/guide.md)。
- **投影缓存**：`write(session)` 用当前全部投影的 checkpoint 整体替换该会话的缓存记录；读取时 `ver` 不匹配的行被丢弃。见 [session-projection-cache `write`](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/session/session-projection-cache/src/index.ts#L257-L271)。
- **消息按序号读取**：`Session.eventAt()`、`snapshotEvents()`、`ownEvents()` 对新代码禁用（[Agent Note 2026-09-09](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md)）。改用异步的 `ctx.sessionQuery.readEvent({ sessionId, seq }, signal)`（[源码](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/session-query/session-query/src/index.ts#L355-L394)）；运行中的会话从内存快照读取，只克隆目标事件。基础组合包挂载了该服务（[base bundle](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/bundle/base/cordis.patch.yml#L150)）。
- **会话展示**：`ctx.sessionTitle.get(session)` 返回最新标题快照（[源码](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/session/session-title/src/index.ts#L395)）；`ctx.workingDirectory.get(session)` 返回当前工作目录（[源码](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/session/working-directory/src/index.ts#L122)）。插件按可选服务读取：`ctx.get(name)` 在服务未提供时返回 `undefined`（[Cordis `get`](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/vendor/cordis/src/reflect.ts#L225-L235)）。
- **轮次结束原因**：`TurnEndReasonMap` 与 `AgentCancelCause`（`user`／`parent`／`hook`／`disposed`，导入记录另有 `legacy`）见 [types.ts](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/session/src/types.ts#L193-L238)；`disposed` 在 Agent 销毁时使用（[agent-loop](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/agent-loop/src/index.ts#L518)）；`interrupted` 只在恢复崩溃会话时补写，`forked` 只出现在 fork seed 中。
- **`session/event` 语义**：提交后同步调用监听器，每个监听器的异常被单独隔离（[core/session](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/session/src/index.ts#L66-L76)）。
- **root 判断**：`ctx.agents.roots()` 返回没有归属 Agent 的运行时顶层 Agent（[core/agent](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/agent/src/index.ts#L621)）。
- **Cordis effect 生命周期**：`ctx.effect(() => cleanup)` 的返回值函数会在 fiber 卸载时执行；已核实安装包内 `@deepseek-ai/cordis/lib/index.js` 的 `_execute` 对函数返回值执行 `runner.collect(effect)`；其在线源码路径未逐一核对。
- **Client 装配**：包在 `package.json` 声明 `dsh.client`（`platform: 'web'`）并导出 `./client` bundle；仓库外构建的包须输出相同格式（[client-modules README](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/modules/README.zh.md)）。仓库外构建的 bundle 能否实际加载：未验证（V3）。
- **插件自定义 Host↔Client 通道**：自定义 `ctx.remote` 端点需要 typert 构建生成 `lib/typert.remote-client.*`；Client 拒绝挂载缺少严格 codec 的 SRC 描述符（[API Gateway 参考“SRC 开发回退”](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/api-gateway.zh.md)、[新增 Remote API 第 3 步](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/cookbook/adding-a-remote-api.zh.md)）。2026-10-26 已决定采用 Harness 构建链：插件增加 TypeScript Remote 服务、typert 生成产物和 `dsh.client` bundle；Client 通过公开 `ctx.remote.$mount()` 挂载自己的贡献。
- **精确导航**：`uiWorkspace.openSession(target: SessionTarget): void`（[navigation.ts](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-workspace/src/client/navigation.ts#L45)），返回 `void`，不表示视图已打开。
- **窗口唤起**：桌面版只处理 `dsh://open`／`dsh://open/`，效果是聚焦主窗口（[main.ts](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/apps/desktop/src/main.ts#L1265-L1268)）；没有指定会话的深链。
- **prompt 准入**：Client 通过 `ctx.remote.session.prompt(request)` 提交（命名空间 `session`，[源码](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/api/session-controller/src/index.ts#L451)）；`SessionPromptRequest` 为 `{ requestId, sessionId, mode: 'queue' | 'steer', content, clientTimeZone? }`，回执 `{ accepted: true }`（[types.ts](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/api/session-controller/src/types.ts#L315-L328)）。接收查询（`lookupPromptReceipt`）：未核对。
- **Client 会话状态**：`ctx.uiSession.sessionStatus` 提供 `running`、`pendingInteraction`、`completionUnread`，其中 `completionUnread` 已排除主视图中的会话（[ui-session](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-session/src/client/index.ts#L298)）。
- **桌面渲染进程权限**：除 `media` 外的权限请求均放行（[microphone-permissions.ts](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/apps/desktop/src/microphone-permissions.ts#L16-L28)），即渲染进程可以使用 Web `Notification`：仅源码推断，未实测。
- **Harness 自身的通知能力**：Harness 只在桌面版“强制更新已就绪”时使用 Electron `Notification`（[update-attention.ts](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/apps/desktop/src/update-attention.ts)）；没有轮次完成通知。
- **版本兼容声明**：`engines.dsh` 存在时单独决定兼容范围，忽略 DSH peer 依赖；范围支持 prerelease。见 [app-boot README](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/boot/app-boot/README.md#L52)。

## 当前代码结构与数据流

1. `index.js`：`inject = ['sessionProjections', 'agents']`；async `apply` 规范化配置，非 macOS 时警告并返回，否则注册 `TurnNotifierActions` 并 `await startTurnNotifier(...)`。
2. `lib/turn-notifier.js` 的 `startTurnNotifier`：
   - 创建 `lib/delivery-queue.js` 的串行队列，最多 128 个待投递，重试间隔 1/2/4 秒（最多 3 次重试）；通过 `ctx.effect` 在插件卸载时 `dispose()`。
   - 先挂 `session/event` 监听，再 `await registerTurnProjection(ctx.sessionProjections)`；注册完成前结束的 `turn/end` 存入最多 32 个的缓存，注册完成后处理；注册失败时丢弃缓存并 reject。
   - 监听器对每个 `turn/end` 依次：过滤非 root 会话（除非 `includeSubagents`）→ `turnStatus(reason, settings)`，为 `null` 则返回 → 按 `${sessionId}:${turn}:${seq}` 去重（最多保留 512 个键）→ **同步**读取投影状态 `{ turn, hasMessage, messageSeq }` 与 `readSessionPresentation`（标题、当前目录）→ 异步 `deliver`。
   - `deliver`：只有在 `includeMessage` 为真、状态允许显示回复、且投影状态属于本轮时，才调用 `readAssistantTextAt` 读取文本；读取失败记一条只含错误类别的警告，并退回状态文案。随后 `buildTurnNotification` 生成通知，交给投递队列。
   - 通知失败时：确定性错误（`HELPER_MISSING`、`UNSUPPORTED_PLATFORM`、非数字错误码）只尝试一次；超时或非零退出码按 1/2/4 秒退避，最多再重试 3 次。最终失败只记录错误类别和尝试次数。
3. `lib/delivery-queue.js`：串行执行、待投递上限、重试分类、dispose 取消退避计时器；同一个 key 不重复入队。
3a. `lib/notification-registry.js`：deploymentId、profile 数据目录、实例锁、原子写入、route、过期、容量、坏文件隔离和 `resolve()`；记录不含正文。
4. `lib/projection.js`：投影 `dshTurnNotifier`，`stateVersion` 2，状态 `{ turn, hasMessage, messageSeq }`，不含文本；`registerTurnProjection` 做 handle／旧 API 检测。
5. `lib/harness-adapter.js`：`readAssistantTextAt(ctx, sessionId, { turn, messageSeq })` 经 `ctx.sessionQuery.readEvent` 读取，超时 5 秒，校验类型、轮次和序号；`readSessionPresentation(ctx, session)` 读取标题与当前目录，失败时静默退回。
6. `lib/notification.js`：`normalizeSettings`、`turnStatus`（状态文案和允许显示的预览来源：`reply`／`error`／`none`）、`buildTurnNotification`（正文截断到 `maxCharacters`；副标题为“状态 · 会话标题”，标题最多 60 个字符，否则显示目录名）；状态文案从 `lib/i18n.js` 读取。
7. `lib/i18n.js`：从 `locale/zh.json`、`locale/en.json` 的 `copy` 加载文案；`locale: auto` 确定性回落到中文，支持 `zh`／`en`、`zh-CN`／`en-US` 形式。
8. `lib/macos-notifier.js`：`execFile` 调用 applet，四个位置参数；自身错误带 `code`（`UNSUPPORTED_PLATFORM`、`HELPER_MISSING`）。
9. `lib/diagnostics.js`：`describeError` 只输出 `timeout`、`exit-code=<n>`、`code=<常量>`、`signal=<常量>` 或 `error=<类名>`。
10. `native/src/notifier.applescript`：参数不足 5 个（可执行文件本身 + 4 个内容参数）时执行 `open location "dsh://open"` 后退出，避免点击历史通知触发 AppleScript 错误；有参数时显示通知。
11. `src/remote.ts`：A0 的 `TurnNotifierActions` 仅提供 `turnNotifier/ping`；生成产物 `lib/typert.host.js`、`lib/typert.remote-client.js` 已提交。
12. `client/index.ts`：挂载生成的 Remote 贡献；`client/client.js` 是已打包的 `window.__ModuleLoader__` 模块。
13. `scripts/build-client.mjs`、`scripts/build-typert.mjs`：分别构建 Client bundle 和在固定 Harness 源码 checkout 上重新生成 Typert 契约。

## 完成内容

| 任务 | 内容 | 文件 |
| --- | --- | --- |
| A4-1、A4-2（F4、F7） | 关闭预览后所有原因只显示状态；出错显示错误信息或固定文案，停止显示固定文案，都不取先前的助手文本 | `lib/notification.js` |
| A4-3 | 停止按 `user`／`parent`／`hook` 区分，`legacy`、缺失与未知原因用通用文案，`disposed` 不通知 | `lib/notification.js` |
| A4-4～A4-6（F6） | 投影瘦身为消息位置；文本在通知时按序号异步读取并校验 | `lib/projection.js`、`lib/harness-adapter.js`、`lib/turn-notifier.js` |
| A4-7 | 依赖 Harness 的缓存替换行为，插件不改写 `session_projcache`；README 说明旧会话的残留 | `README.md` |
| A4-8（F5） | 日志只记录白名单字段 | `lib/diagnostics.js`、`lib/macos-notifier.js`、`lib/turn-notifier.js` |
| A4-9 | README 隐私说明区分原始会话日志、插件投影缓存、旧缓存和系统通知存储 | `README.md` |
| A2-1～A2-4（F8） | 副标题显示会话标题或当前目录名；新增 `showSessionTitle` | `lib/harness-adapter.js`、`lib/notification.js`、`cordis.patch.yml`、`README.md` |
| 投影 handle 迁移（F14 部分） | `await register()` 后用 handle 读取，保留旧 API；注册期间的事件缓存 | `lib/projection.js`、`lib/turn-notifier.js`、`index.js` |
| A0-1 | 建立本文件；在实施说明中加入第 0 节进度与接手指南 | `docs/implementation-status.md`、`docs/notification-interaction-plan.zh-CN.md` |
| D2 Host 侧（F9 部分） | 串行有界投递队列，1/2/4 秒退避，最多 3 次重试；确定性错误不重试；卸载取消计时器和队列；重复 key 不入队 | `lib/delivery-queue.js`、`lib/turn-notifier.js` |
| D1-1 国际化（F12） | 状态、错误、停止文案移入 `locale/zh.json`／`locale/en.json`，新增 `locale` 配置 | `lib/i18n.js`、`lib/notification.js`、`locale/*.json`、`cordis.patch.yml` |
| X2 版本兼容声明 | `engines.node >=24.9.0`、`engines.dsh >=0.2.1-rc.2 <0.3.0`；README 写明范围 | `package.json`、`README.md` |
| X1 applet 无参数启动 | 参数不足时不索引越界，改为尝试打开 `dsh://open`；重新构建并通过无参数启动测试 | `native/src/notifier.applescript`、`native/AppleScriptNotifier.app` |
| X3 Info.plist 清理 | 删除 osacompile 默认 `NS*UsageDescription`，设置 `LSMinimumSystemVersion=10.10`，删除旧架构最低版本键 | `native/build-macos-notifier.sh`、`native/AppleScriptNotifier.app/Contents/Info.plist` |
| B1/B2 原生桥接 | legacy `NSUserNotification` helper、Host 临时请求/动作文件桥接、Client open 路径、10 秒后通知中心保留检查；真实 helper 投递、Host 启动及 Host 端到端 open claim 通过；实际点击未验证 | `native/src/DSHNativeNotifier.m`、`native/DSHNativeNotifier.app`、`lib/native-helper.js`、`client/index.ts` |
| A3 动作路由 | Client Remote 注册/领取/回执、ActionRouter 租约/generation、真实临时 Web Host 的 `registerClient`/空 `claimAction` 通过 | `lib/action-router.js`、`src/remote.ts`、`client/index.ts`、`lib/typert.*` |
| A1 登记表 | deploymentId、实例锁、原子保存、route、过期、容量、坏文件隔离；可选 notificationId 随通知参数传给 helper；真实 desktop profile 已创建 deployment 与锁 | `lib/notification-registry.js`、`lib/turn-notifier.js`、`index.js` |
| A0 构建链原型 | 固定源码 `22ddee3` 生成 Host/Client Typert 契约；Host `ping` 服务可实例化；临时 Web profile 的启动图包含 `dsh-turn-notifier/client.js` 并成功取到 bundle；POST `/api/turnNotifier/ping` 返回 `{"ok":true,"value":{"pong":true}}`；真实浏览器执行仍未经观察 | `src/remote.ts`、`src/types.ts`、`client/index.ts`、`client/client.js`、`lib/typert.*`、`scripts/*.mjs` |

## 自动测试

`npm test`（Node 内置测试运行器）共 **89 项**，2026-10-26 在本机 macOS / Node `v24.19.0` 上全部通过；`index.js` 与 `lib/*.js` 均通过 `node --check`。所有测试使用 mock 上下文、临时脚本或真实 applet 调用，**不是**真实 Harness 轮次集成测试。

| 文件 | 数量 | 覆盖内容 |
| --- | --- | --- |
| `test/notification.test.js` | 19 | 各结束原因的文案与开关、关闭预览（含哨兵）、出错／停止不取助手文本、停止原因、`disposed` 与 `blocked`／`interrupted`／`forked` 不通知、副标题的标题与目录、码点截断、配置边界 |
| `test/turn-notifier.test.js` | 15 | 按序号读取并加标题、下一轮已开始时不串轮、不需要时不读取文本、读取失败退回状态文案、注册期间缓存、注册失败、旧 API 路径、投递失败日志无正文、监听器异常日志无正文、子代理开关、重复事件只通知一次、投递队列注册到插件 fiber |
| `test/projection.test.js` | 8 | 只取 text 块、记录最终消息位置、状态不含文本、不复用旧轮次、状态 schema（含旧版字段被丢弃）、handle 与旧 API 注册、注册失败 |
| `test/delivery-queue.test.js` | 6 | 1/2/4 秒退避、重试耗尽、确定性错误不重试、dispose 取消退避、队列上限、重复 key |
| `test/i18n.test.js` | 4 | `auto` 回落中文、语言代码归一化、英文完成／上限／错误／停止文案、英文无文本兜底 |
| `test/macos-notifier.test.js` | 8 | 参数只作数据传递、可选 notificationId、非 macOS 报错、真实子进程的退出码／超时／无法执行／助手缺失（用临时脚本代替 applet） |
| `test/harness-adapter.test.js` | 6 | 按序号读取、类型／轮次／序号不符时拒绝、`sessionQuery` 缺失、查询失败透传、标题与当前目录、各种退路 |
| `test/diagnostics.test.js` | 3 | 消息、命令行、输出不进入摘要；已知字段组合；自由文本退回类名 |
| `test/notification-registry.test.js` | 8 | deployment 稳定性/实例锁/记录路由/身份不符/过期/容量/坏文件隔离 |
| `test/native-helper.test.js` | 3 | pid 握手、临时请求文件、动作文件消费、部署不匹配 |
| `test/action-router.test.js` | 7 | Client 注册/generation/租约/动作去重/会话优先领取/回执/过期清理 |
| `test/client-mount.test.js` | 2 | Client bundle factory、`$mount()`、dispose、注册和 open 导航 |

## 本轮 macOS 验证

- `native/build-macos-notifier.sh` 成功；`lipo -info` 显示 applet 为 `x86_64 arm64` 通用二进制。
- `codesign --verify --deep --strict` 通过。
- `Info.plist` 中已无 `NS*UsageDescription`；`LSMinimumSystemVersion` 为 `10.10`。
- 直接执行与通过 LaunchServices（`open -W -n`）无参数启动 applet：退出码均为 0，没有 AppleScript 错误，并尝试打开 `dsh://open`；通过 LaunchServices 带四个参数启动也退出 0。
- 通过 `lib/macos-notifier.js` 发送测试通知成功。
- 用 mock Host 上下文 + 真实 applet 跑通 `turn/end → 投影状态 → 英文文案 → 通知`，无警告；这是集成冒烟，不是真实 Harness 会话。
- 在临时 `DSH_HOME` 的真实 `web` profile 中验证：启动图含 Client entry、`/plugins` 返回 Client bundle、正式 RPC envelope 调用 `turnNotifier/ping` 返回 `pong`。临时 profile 已清理。
- 真实 Host + legacy helper 端到端：`helper-actions` 的 open 动作经 ActionRouter、`registerClient`/`claimAction` 返回；动作文件被清空。临时 profile 已清理。
- 原生 helper 10 秒保留：真实请求投递后日志出现 `delivered`，10 秒后出现 `retained`；通知不再被主动删除，保留在通知中心。
- **未验证**：真实浏览器中执行 Client bundle 与调用 `$mount()`、真实 Harness 有标题会话的 V1、从通知中心点击历史条目的 V5 人工观察、精确会话跳转。

## 实施中做出的取舍

以下取舍在实施时做出，用户未逐项确认；如需改变，修改对应文件并同步 README：

- `aborted` 的 `disposed` 一律不通知；停止与出错的正文不使用助手文本；钩子停止时不显示钩子给出的原因。
- 副标题中的会话标题最多 60 个字符；`showSessionTitle` 默认开启，关闭后显示目录名（沿用 1.1.0 已显示目录名的行为）。
- 文本读取超时 5 秒；读取失败时仍然发通知，正文退回状态文案。
- 注册期间最多缓存 32 个 `turn/end`；去重集合最多 512 个键。
- 投递队列串行、待投递上限 128；重试 3 次（1/2/4 秒），队列满时丢弃新条目并记录 `reason=queue-full`；最终失败保留去重键，避免重复弹出。
- `locale: auto` 没有可用的 Host 语言服务，按计划确定性回落到中文；英文需显式 `locale: en`。
- D3-1 配置 schema：已核对 schemastery 的 `Config` 机制；它要求额外的 `@deepseek-ai/schemastery` 运行时依赖；插件已经采用 Typert 构建链，但为避免再为配置 UI 增加依赖，仍**暂不导出 `Config`**，继续使用 `normalizeSettings` 做容错与边界处理。等配置 UI 或默认值收集成为实际需求时再引入依赖并补 schema。
- 不主动清理 Harness 投影缓存中 1.1.0 写入的旧行。

## 仍待完成

见实施说明 [0.2](notification-interaction-plan.zh-CN.md#progress)、[0.7](notification-interaction-plan.zh-CN.md#next-tasks)。概要：

- D-1 已选择 Harness 构建链；A1（部署身份与登记）、A3（本机桥接与 Client 选择）、B（原生 action／导航）现在可继续；C（通知内回复）已按用户要求移除。
- D2 的系统投递状态、unknown 回执与 helper 生命周期仍需原生助手；当前只有 Host 侧队列。
- D3 的配置 schema 本次调研后暂缓，理由见上；诊断入口、测试通知仍待主链路确定。
- X1 的实际通知点击行为（V5）仍需人工确认。

## 待验证

见实施说明 [0.6](notification-interaction-plan.zh-CN.md#verification-queue)（V1–V6）。

- V1：真实 Harness 轮次、标题、关闭预览与错误／停止开关的通知表现——未验证。
- V2：安装版与源码 `22ddee3` 差异——部分核对（版本均为 `0.2.1-rc.3`），未逐符号检查。
- V3：仓库外构建 Client bundle——未验证。
- V4：Swift 原生原型——未开始（当前 applet 不是 action 原型）。
- V5：从通知中心点击历史条目的实际行为——代码已修复无参数路径，人工点击未验证。
- V6：`dsh://open` 行为——无参数 applet 已调用成功，未单独记录窗口焦点结果。

## 协议和迁移

- 协议版本：未定义（A1、A3 未开始）。
- 投影迁移：`stateVersion` 1 → 2；Harness 丢弃旧版本行，并在下次写缓存时替换会话记录；升级后未再打开的会话保留 1.1.0 的旧行。
- 配置：新增 `showSessionTitle`（默认 `true`）和 `locale`（默认 `auto`，回落到中文）；其他字段名称与默认值不变。
- 版本范围：`engines.dsh >=0.2.1-rc.2 <0.3.0`，`engines.node >=24.9.0`。
- bundle ID／签名／通知权限升级：applet bundle ID 仍为 `ai.deepseek.harness.turn-notifier.applescript`；重新签名后沿用既有通知权限归属。升级测试未做。
- 未知状态与故障恢复限制：D2 的 helper 状态查询未实现；当前只能区分确定失败与重试耗尽，不能查询系统是否已显示。

## 变更记录

- **2026-10-25（第一轮）**：修复关闭预览时显示错误信息（F4）、出错时显示中间回复（F7）、停止原因不分、日志泄露正文（F5）；投影改用 handle API 并保留旧 API；测试 15 → 40 项。
- **2026-10-25（第二轮）**：A0 源码层核对；A4 剩余部分（F6：投影瘦身、经 `sessionQuery` 按序号读取、README 隐私说明）；A2-1～A2-4（会话标题、当前目录、`showSessionTitle`）；建立本文件；测试 40 → 54 项。发现 Host↔Client 通道不可用，提出决策 D-1。
- **2026-10-26（第一轮）**：在实施说明中加入第 0 节（进度、问题状态、计划修正、决策、待验证、可接手任务、接手步骤），在各步骤标题下标注进度，并在被推翻的原文处加注；本文件补充数据流、测试清单与取舍记录。未改动代码。
- **2026-10-26（第二轮）**：D2 Host 侧有界重试与队列、D1-1 中英文 locale、X2 `engines` 版本声明、X1 applet 无参数保护、X3 Info.plist 清理；在真实 macOS 上重建、签名、无参数启动和测试通知通过；测试 54 → 65 项；D3-1 调研后暂缓。未提交、未推送。
- **2026-10-26（第三轮）**：D-1 选择 Harness 构建链；固定源码 `22ddee3` 生成 Typert Host/Client 契约，新增 `src/remote.ts`、`client/index.ts` 和构建脚本；Host `ping`、Client `$mount()` 离线冒烟及临时 `web` profile 的 boot graph／bundle／`/api` RPC 验证通过；测试 65 → 66 项；真实浏览器执行与交互仍未验证。
- **2026-10-26（第四轮）**：A1 登记表（deploymentId、实例锁、原子写、route、过期、容量、坏文件隔离）接入 `turn/end`，真实 desktop profile 已生成 deployment 与锁；测试 66 → 78 项。
- **2026-10-26（第五轮）**：A3 Client Remote 注册/领取/回执、ActionRouter、Client 轮询与当前会话上报；真实临时 Web Host 的 `registerClient`/`claimAction` 通过；测试 78 → 85 项。
- **2026-10-26（第六轮）**：B1 原生可行性试验；ad-hoc UN helper 被 macOS 拒绝，legacy NSUserNotification 成功投递并支持内联回复字段。仅 `/tmp` 原型，尚未接入 Host。
- **2026-10-26（第七轮）**：实现 legacy native helper、Host 临时文件桥接、Client open 路径；真实 Host 启动 helper、helper 投递和 ActionRouter 单元链路通过；测试 85 → 89 项；真实 Host 的 helper 动作文件 open claim 也通过。
- **2026-10-29（第八轮）**：原生通知增加 10 秒后通知中心保留检查；真实 helper 投递后 10 秒日志出现 `withdrawn`。
