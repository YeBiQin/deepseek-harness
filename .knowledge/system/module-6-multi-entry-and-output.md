# 模块六：多入口复用与工程化沉淀

这是学习手册的第六个模块。前面五个模块已经回答了“系统里面有什么、插件怎样装上、一次 Agent Turn 怎样运行、Session 怎样重建、能力和工具怎样接入”。本模块继续回答两个问题：为什么 Web、Headless、ACP、SDK 看起来不同却能复用同一套核心，以及怎样把学习成果变成可验证、可复用、可贡献的工程产物。

## 1. 本模块的目标

学完后，你应该能做到四件事：

1. 从一个入口文件沿着输入、Agent、Session、输出四个节点追踪到底。
2. 解释 Web、Headless、ACP、SDK 各自增加了什么，哪些事情不应该重复实现。
3. 为一个源码问题选择合适的验证方式：单元测试、真实组合测试、Keyless Snapshot、Web 测试或真实 API 测试。
4. 把一次源码阅读整理成带文件锚点、运行证据和下一步练习的知识卡片。

可以把整个工程想成一家厨房：Agent Loop 是后厨的出餐流程，Session 是订单账本，Tools 和 Provider 是厨具与食材。Web 是堂食窗口，Headless 是外卖打包线，ACP 是给自动化机器人使用的传送带，SDK 是给远程程序调用的服务台。窗口可以不同，但不能各自再造一间后厨。

## 2. 先建立“共享核心、入口适配”的地图

```text
Web / Headless / ACP / SDK
        ↓ 输入格式、生命周期、输出投影
AgentRegistry → Agent Loop → ToolRuntime / LlmRuntime
        ↓                    ↓
      Session Log ← 能力 Provider / 工具策略
```

入口层负责把外部请求翻译成 Agent 能理解的消息，监听核心事件，再把结果投影成自己的协议或界面。核心层负责排队、Turn、模型请求、工具执行、Session 记录和清理。这个分工解释了一个重要判断：如果一个需求只和某种协议有关，它通常应留在入口适配层；如果所有入口都需要它，它才可能属于 Agent、Session、ToolRuntime 或能力 Provider。

阅读任何入口时，先填写这张四格表：

| 问题 | 你要寻找的代码证据 |
|---|---|
| 输入从哪里来 | CLI 参数、HTTP/RPC 请求、ACP prompt 或 SDK `session/prompt` |
| 谁创建 Agent | `ctx.agents.create()`、默认模型和 Session 选项 |
| 过程在哪里完成 | `followup()`、`whenIdle()`、`session/event` 和 Agent Loop |
| 外部看到了什么 | stdout、JSON-RPC notification、Host frame 或 UI projection |

## 3. Headless：一次任务的“外卖打包线”

先读 [`packages/bundle/headless/src/index.ts`](../../packages/bundle/headless/src/index.ts:1)。它不是另一套 Agent，而是一个一次性驱动器：接收一个任务，创建一个 Agent，等它安静下来，保存 Session，然后打印最终回答。

把 `run()`（见同文件第 96 行附近）拆成白话流程：

```text
等待 Loader 完成
  ↓
取得 agents、默认模型和 sessions
  ↓
agents.create(...)
  ↓
agent.followup(user message)
  ↓
await agent.whenIdle()
  ↓
await sessions.flush(agent.session)
  ↓
从 assistant/message 汇总文本，写 stdout，按结果返回退出码
```

这里有三个值得记住的细节：

- `inject = ['agentDefaultModel', 'agents', 'sessions']` 说明 Headless 依赖的是已经挂载好的能力，而不是自己组装 Agent 内部零件。
- `whenIdle()` 是“这次工作暂时没有继续任务”的等待点；`sessions.flush()` 是“账本已经写入持久层”的等待点。两者解决的不是同一个问题。
- `summarize()` 只从指定序号之后的 `assistant/message` 提取最终文本，并根据 `turn/end` 选择退出成功还是失败。它是在做输出投影，不是在重新运行 Agent。

练习：打开 `run()`，给每一个 `await` 写一句“它等待的事实是什么”。如果把 `sessions.flush()` 删除，程序可能仍然打印正确答案，但会把什么持久化风险留给调用者？

## 4. ACP：给自动化客户端的“传送带”

ACP 是面向自动化的 Agent Client Protocol。读 [`packages/acp/acp/src/index.ts`](../../packages/acp/acp/src/index.ts:116) 的 `apply()`，再读 `newSession()`（约第 308 行）和 `prompt()`（约第 335 行）。ACP 的入口不是打印文本，而是把每个会话绑定到一个 Agent，并把已提交的助手内容按协议发送出去。

```text
session/new
  ↓ agents.create()
session/prompt
  ↓ admit prompt → createUserMessage → agent.followup()
session/event
  ↓ 只投影 committed assistant/message
session/prompt 结束
  ↓ 等待 Agent idle、输出队列和 turn/end
```

ACP 代码明确把“账本里的所有事实”和“自动化客户端需要的事实”分开：原始 chunk、推理、工具、计划、标题和重试标记不会全部发到 ACP 的自动化线；`assistant/message` 才会被转换成 `agent_message_chunk`。这和模块四的 Session 重建原则相同：日志可以比某个消费者的显示协议更丰富。

ACP 还展示了一个入口层独有的职责：`approval/request` 把内部审批事件翻译成一次性 allow/reject 选择。它不应该被写成 Agent Loop 的固定行为，因为 Web UI、ACP 客户端和其他入口的交互能力不同。

练习：读 `ctx.on('session/event', ...)`，标出“会被发送”和“会被忽略”的事件类型。然后回答：如果把原始 `assistant/chunk` 也逐个发送，自动化协议得到的只是更多信息，还是会改变顺序、完成条件和客户端实现负担？

## 5. SDK：给远程程序的“服务台”

SDK 由三层组成，建议按这个顺序读：

1. [`packages/sdk/protocol/src/types.ts`](../../packages/sdk/protocol/src/types.ts:33)：看线上的请求和通知名称，例如 `session/prompt`、`session.event`、`session.status`。
2. [`packages/sdk/protocol/src/transport.ts`](../../packages/sdk/protocol/src/transport.ts:58)：看 JSON-RPC over stdio 如何发送请求、通知和关闭连接。
3. [`packages/sdk/server/src/server.ts`](../../packages/sdk/server/src/server.ts:48)：看服务端如何把协议请求接到真实 Context 和 Agent。
4. [`packages/sdk/client/src/client.ts`](../../packages/sdk/client/src/client.ts:179) 与 [`packages/sdk/client/src/api.ts`](../../packages/sdk/client/src/api.ts:1)：看客户端如何启动子进程、订阅事件、等待结果和清理。

SDK 服务端的 `HarnessSdkJsonRpcServer` 很适合当作“入口适配层”样本：构造函数订阅 `session/event` 并转成 `session.event`，`handleRequest()` 把 `session/prompt` 分派到 `prompt()`，`prompt()` 通过 `getOrCreateSession()` 找到或创建 Agent，再调用 `followup()`。它没有复制 Agent Loop，也没有自己实现工具策略。

SDK 的一句话心智模型是：

```text
JSON-RPC request → typed server method → Agent.followup()
Session event    → JSON-RPC notification → remote client projection
```

读客户端时特别关注关闭路径。`HarnessClient.close()` 和 `disposeRuntimeProcess()` 说明“请求完成”与“子进程彻底退出”是不同的生命周期事实。远程入口必须把连接关闭、挂起请求、事件订阅和 Agent 清理一起考虑，否则会留下看似完成、实际仍在运行的任务。

## 6. Web：把事件投影成可交互界面

Web 入口的代码量较大，不建议一开始从 React 组件读。先读 Host 的事件契约 [`packages/host/apiproxy/src/api/events.ts`](../../packages/host/apiproxy/src/api/events.ts:1)，再读 Client 的会话服务 [`packages/client/runtime/src/client/sessions/service.ts`](../../packages/client/runtime/src/client/sessions/service.ts:1)。

Host 的 `EventsApi` 把实时事实组织成两个逻辑流，并在 `MuxFrame` 中承载 `session/event`、审批、问题、队列、任务和 projection 等不同帧。Client 的 SessionRuntime 再把这些帧整理成会话列表、当前会话、工具调用树、待处理交互和对话显示。

```text
Session Log / Agent 事件
        ↓ Host API frame
Client SessionRuntime / projection store
        ↓
侧栏、对话、工具卡片、审批 UI
```

因此 Web 不是 Session 的第二个真相源。它是一个可刷新、可重建的显示投影；如果 UI 状态只能存在浏览器内存，刷新后无法从 Host frame 和 Session projection 恢复，就说明事实放错了位置。

练习：任选一个 UI 状态，例如“会话正在运行”或“工具等待审批”，追踪它的四个位置：Host 发出的帧、Client 的存储字段、React/界面读取点、Session Log 是否记录了足够事实。不要试图一次读完整个 `packages/client`。

## 7. 四种入口的对照表

| 入口 | 输入 | 输出 | 生命周期重点 | 适合的验证 |
|---|---|---|---|---|
| Headless | CLI/一次任务 | stdout、stderr、退出码 | `whenIdle` 后 flush 并退出 | Headless 组合测试、Snapshot |
| ACP | JSON-RPC `session/new`/`prompt` | ACP session update 和 stop reason | 一个连接管理多个会话与审批 | ACP bridge/turn 测试 |
| SDK | JSON-RPC `session/prompt` | `session.event`/`session.status` | 子进程、订阅、shutdown | protocol/server/client 测试、SDK Snapshot |
| Web | Host RPC 与事件流 | UI projection 和交互请求 | 实时流、刷新、选择和待处理交互 | Web 测试、浏览器验收 |

它们的差异集中在“如何接入、如何等待、如何显示、如何退出”。它们不应分别拥有一套“模型请求循环、工具执行循环、Session 追加规则”。看到入口代码直接手写这些核心逻辑时，要先检查是不是已有扩展点可复用。

## 8. 用测试层级证明你的理解

不要用“我读懂了”作为完成标准。为每个结论配一个最小证据。项目的 [`docs/testing.zh.md`](../../docs/testing.zh.md:1) 已经给出了测试地图，可以按成本从低到高使用：

| 你要证明的事情 | 优先查看或运行 |
|---|---|
| 一个纯函数或局部状态转移 | 对应包的 Vitest 单元测试 |
| 插件真的通过 Loader 组合起来 | 真实 composition 测试，而不是只 mock Context |
| 模型/协议/用户可见文本没有意外变化 | Keyless Snapshot，通过可运行 example 回放 |
| Provider 与外部服务真的能工作 | `test:e2e`，有凭证时才运行 |
| Web 的事件、交互和布局真的可用 | `test:web` 或真实浏览器验收 |

对于本模块，建议先运行入口相关的窄测试：

```sh
pnpm vitest run packages/acp/acp/tests/turns.spec.ts packages/acp/acp/tests/bridge.spec.ts packages/sdk/protocol/tests/transport.spec.ts packages/sdk/client/tests/sdk-client.spec.ts
```

再按需要阅读 [`packages/sdk/server`](../../packages/sdk/server) 的测试和 [`examples/jsonrpc-agent/tests`](../../examples/jsonrpc-agent/tests) 的 Snapshot。测试命令不是背诵任务；运行前先写一句预测，运行后记录“哪个预测被证实、哪个被推翻”。

## 9. 把源码阅读沉淀成知识卡片

每次只围绕一个问题写一张卡片，不要把目录树抄成百科。推荐使用下面的模板：

```md
# 问题：为什么某入口要等待 whenIdle 之后再 flush？

## 一句话答案

## 代码锚点
- 文件：函数或类型：行号

## 调用链
入口 → Agent → Session → 输出

## 运行证据
- 命令：
- 结果：

## 我的误解

## 一个最小练习

## 仍然不确定的问题
```

高质量笔记至少有三种证据：源代码锚点、运行结果、自己的可 falsify 预测。例如不要只写“ACP 支持流式输出”，而要写“ACP 的 `session/event` 只把 `assistant/message` 转成 `agent_message_chunk`；我通过阅读第 218–245 行和对应测试确认原始 chunk 不在线上发送”。

`.knowledge/system/` 适合放跨模块的当前架构、学习路线和源码导读；`.knowledge/features/` 适合未来针对一个功能的局部行为说明。事实只保留一个家，其他笔记通过链接引用，避免同一规则在多处逐渐漂移。

## 10. 四个递进式动手项目

### 项目一：入口链路卡片

选择 Headless 或 SDK，画出“输入 → `agents.create` → `followup` → Session event → 输出”的时序图，并给每个箭头附上文件和函数。完成标准是别人能沿着你的链接复现这条链。

### 项目二：事件观察插件

在现有插件机制中增加一个最小观察器，只记录 `session/event` 的类型和序号，不改变 Agent 行为。用真实组合测试确认插件能加载、卸载后不再收到事件，并说明为什么观察器不能成为第二个 Session 存储。

### 项目三：Provider 替换实验

沿用模块五的 Definition → Provider → Consumer 方法，把文件系统或 LLM Provider 替换成另一个已有实现。记录哪些 Consumer 文件完全不用改，哪些配置或能力事实改变了。这是理解“能力缝隙”最有效的练习。

### 项目四：新增一个 Keyless Snapshot

从 [`examples/jsonrpc-agent/tests`](../../examples/jsonrpc-agent/tests) 或 [`examples/headless-agent/tests`](../../examples/headless-agent/tests) 选择真实可运行入口，为一个可观察行为增加回放断言。先确认行为属于模型/协议/产品输出，再按照 `docs/testing.zh.md` 的要求更新对应 TypeScript 和 Python 预期面。

## 11. 如何参与贡献

第一次贡献不必从“大功能”开始。先选一个能被证据闭环的小问题：补一条缺失的测试、修一个错误的文档入口、为一个公开导出补完整 JSDoc，或把一个模糊的错误信息改成可行动的诊断。

贡献前先读根目录 [`AGENTS.md`](../../AGENTS.md)、相关包的 `README.md` 和测试策略；修改后只运行覆盖当前 diff 的最小检查，最后查看 `git diff --check`。如果改动影响模型输出、Session 事件、协议或产品可见行为，要把 Snapshot 和相关 SDK 预期一起纳入范围。

提交 Pull Request 时，用三句话说明：改了什么、为什么由这个扩展点承载、用什么运行证据证明它。不要把整段探索过程塞进代码注释；探索过程留在个人笔记或 PR 描述中，代码和文档只保留当前有效的行为、契约和使用方式。

## 12. 总复盘：把六个模块串起来

现在请尝试不用查目录，口头讲出下面这条故事：

```text
dsh 启动一个 Profile
  ↓ Loader 装载一组 Cordis Plugins
  ↓ Service / Provider / Consumer 形成能力
  ↓ Agent 收到 followup，启动一个 Turn
  ↓ Session 追加可重建事件
  ↓ ToolRuntime 和 LlmRuntime 完成模型/工具交互
  ↓ Web、Headless、ACP 或 SDK 选择自己的输出投影
  ↓ Fiber、Agent、Session 和入口资源按生命周期清理
```

如果某个箭头只能说“框架会处理”，就回到对应模块的源码卡片，补上一个真实文件、函数和测试。完整知识体系不是记住所有文件，而是能在新问题出现时快速定位：它属于启动、插件生命周期、Turn、Session、能力/工具，还是入口投影。

## 13. 综合自测与参考答案

可以用自己的话思考：如果要让 Web 和 Headless 都支持“工具执行前需要审批”，应该把统一策略放在哪里？

参考答案：统一的准入决定应放在 `tools/pre-execute`、Guard 等核心策略扩展点；Web 或其他可交互入口负责提供审批交互，Headless 没有交互能力时按既有策略返回拒绝或失败。这样策略语义不会在不同入口中分叉。

完成本模块后，可以选择前面的任意动手项目，按文件、命令和验收结果自行推进。
