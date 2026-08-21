# DeepSeek Harness 白话版深度解读

本文把 [`harness-learning-guide.md`](harness-learning-guide.md) 的路线重组为六个学习模块，先用生活中的物理模型建立直觉，再回到当前仓库的源码确认真实行为。

比喻只负责帮助记忆，不替代代码契约；当比喻和源码冲突时，以源码、类型、测试和 [`../../docs/architecture.zh.md`](../../docs/architecture.zh.md) 为准。

## 0. 先记住一张总图

可以把 Harness 想成一家“能自己完成软件工作的智能工作室”：命令行决定开哪家店，Cordis 负责把员工和设备装进工作室，Agent Loop 负责接单推进工作，Session 负责记账，LLM 负责思考，工具负责动手，Web、Headless、ACP 和 SDK 是不同的服务窗口。

```text
dsh 命令
  ↓
Profile + Bundle + Patch
  ↓
Cordis Loader
  ↓
Context：Services + Events + Effects
  ↓
Agent Loop：Turn + Step
  ↓
Session + Prompt + LLM + Tools
  ↓
Web / Headless / ACP / SDK
```

六个模块分别回答六个问题：系统怎么开起来，插件怎么互相找到，Agent 怎么推进一次任务，历史怎么保存和重建，工具为什么能替换和受策略控制，不同客户端怎样共享同一个核心。

## 1. 模块一：全局架构与启动流

### 1.1 白话模型：装修一间可换设备的工作室

Profile 像一张装修需求单，Bundle 像一套标准装修包，Patch 像用户在交付前提出的改动单，Cordis Loader 像项目经理，最终的插件树像装修完成的工作室。

因此，`dsh web` 并不是进入一个写死的 `main()`；它先决定要加载哪些配置行，再让插件根据依赖逐个激活。

Base Bundle 会装入所有模式共享的设备，例如 Session、LLM、Tools、Agent、持久化、权限和本地进程能力；Web Bundle 或 Headless Bundle 再加上各自的入口。用户 Patch 可以按 `id` 替换某一行的配置，也可以插入新的插件。

### 1.2 真实启动链

```text
命令行参数
  → 选择 profile / web / plugin / dump-config
  → 读取 profile 和 bundle patch
  → 叠加 profile patch、home patch、--patch overlay
  → boot 空的 profile 根
  → Loader 挂载插件
  → 插件通过 inject 等待服务
  → Web 或 Headless 入口开始工作
```

### 1.3 源码锚点：该看哪些文件和函数

| 阅读目标 | 文件 | 重点函数或位置 |
|---|---|---|
| 命令如何分流 | [`apps/cli/src/bin.ts`](../../apps/cli/src/bin.ts:27) | `parseDshArgs`、`switch (invocation.mode)`、动态 `import` |
| Patch 如何分层 | [`apps/cli/src/profile-boot.ts`](../../apps/cli/src/profile-boot.ts:121) | `allPatches`、`composeProfile` |
| Profile 如何启动 | [`apps/cli/src/profile-boot.ts`](../../apps/cli/src/profile-boot.ts:207) | `runProfile`、`boot` 调用、`provideCmdline` |
| Loader 如何建立配置树 | [`packages/boot/app-boot/src/index.ts`](../../packages/boot/app-boot/src/index.ts:757) | `boot` |
| Profile 如何加载 | [`packages/boot/app-boot/src/profile.ts`](../../packages/boot/app-boot/src/profile.ts:371) | `loadProfile`、`composeEntries` |
| 基础插件有哪些 | [`packages/bundle/base/cordis.patch.yml`](../../packages/bundle/base/cordis.patch.yml:15) | `insert` 下的插件行和每行的 `id` |
| Headless 如何接入 Agent | [`packages/bundle/headless/src/index.ts`](../../packages/bundle/headless/src/index.ts) | `run`、`apply` |

### 1.4 读代码时要问什么

- `bin.ts` 为什么只负责选择模式，而不自己创建 Agent？
- `profile-boot.ts` 为什么把命令行参数放进 `ctx.cmdlineArgs`？
- Bundle 的行顺序和服务激活顺序是不是一回事？
- Patch 替换一行时，配置是整行替换还是字段深合并？
- 如果一个插件依赖 `tools`，它在 `apply(ctx)` 执行时能否直接使用 `ctx.tools`？

### 1.5 最小验证

```sh
pnpm dsh --profile web --dump-config
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

第一个命令观察最终插件树，第二个命令观察本地插件如何插入已有 Profile；入门过程见 [`../../docs/user/develop/basic/index.zh.md`](../../docs/user/develop/basic/index.zh.md)。

## 2. 模块二：Cordis 插件与生命周期

### 2.1 白话模型：一栋有服务台和对讲机的办公楼

Context 像办公楼的公共服务台，Service 像服务台上已经安装的部门，插件像搬进办公楼的团队，Event 像楼内对讲机，Effect 像领用设备时签下的归还单。

`inject` 不是“我希望它大概存在”，而是“这个团队必须等这些部门就位后才能开门”。`ctx.on()` 是订阅对讲机，`ctx.effect()` 是登记一个在团队离开时必须执行的清理动作。

这套模型解决了两个实际问题：插件不必硬编码加载顺序，插件卸载或 HMR 重载时也不会把旧的工具、监听器和资源留在系统里。

### 2.2 Service、Event 和 Effect 的区别

可以用三个问题区分它们：

- 需要直接调用一个长期存在的能力时，用 Service，例如 `ctx.sessions.create()` 或 `ctx.llm.stream()`。
- 需要让多个插件观察、修改或阻止一次动作时，用 Event，例如 `tools/pre-execute`。
- 需要注册某个东西并在卸载时撤销时，用 Effect，例如工具注册、适配器注册和监听器注册。

Waterfall 事件像一根接力棒：监听器如果只是增加信息，就调用 `next()` 把接力棒交给下一个监听器；如果它返回而不调用 `next()`，就是明确接管了这次决定。

### 2.3 源码锚点：该看哪些文件和函数

| 阅读目标 | 文件 | 重点函数或位置 |
|---|---|---|
| Cordis 的概念和事件模式 | [`../../docs/cordis-primer.zh.md`](../../docs/cordis-primer.zh.md:7) | Service、`inject`、事件模式、`ctx.effect` |
| Session Service 的生命周期 | [`../../packages/core/session/src/index.ts`](../../packages/core/session/src/index.ts:793) | `SessionStore`、`constructor`、`create`、`enter`、`announce`、`flush` |
| Agent Service 的注册表 | [`../../packages/core/agent/src/index.ts`](../../packages/core/agent/src/index.ts:256) | `AgentRegistry`、Agent 的创建和销毁注册 |
| Tool Service 的注册和清理 | [`../../packages/core/tools/src/index.ts`](../../packages/core/tools/src/index.ts:787) | `ToolRuntime`、`register`、`restrict`、`guard` |
| 一个真实插件的依赖声明 | [`../../packages/llm/llm-deepseek/src/index.ts`](../../packages/llm/llm-deepseek/src/index.ts:43) | `inject = ['llm']`、`apply`、`registerAdapter` |
| 最小插件形态 | [`../../scratch-plugin/src/my-plugin.ts`](../../scratch-plugin/src/my-plugin.ts) | `name`、`apply`、`console` 和后续实验 |

### 2.4 一个插件从加载到卸载发生什么

```text
读取插件模块
  → 解析配置和依赖
  → 等待 inject 的 Service
  → 执行 apply(ctx, config)
  → 注册 Service / Event / Tool / Adapter
  → 插件正常工作
  → Fiber 卸载
  → 执行 Effect disposer
  → 撤销注册并释放外部资源
```

初学者最容易犯的错误是把“包被 import 了”当成“能力已经安装了”。在 Harness 中，import 只是代码可见；是否存在可用能力，要看插件是否被 Loader 挂载、Service 是否已经注册、依赖是否激活。

### 2.5 最小练习

把 [`../../scratch-plugin/src/my-plugin.ts`](../../scratch-plugin/src/my-plugin.ts) 改成一个只依赖 `tools` 的插件，然后注册一个简单工具；重载配置后确认工具只出现一次，插件卸载后旧注册不会继续响应。

## 3. 模块三：Agent Turn 核心链路

### 3.1 白话模型：一个项目经理处理工作单

Agent 像项目经理，inbox 像待办队列，用户消息像新的工作单，Turn 像从接单到暂时收工的一整个工作周期，Step 像周期中的一次“思考—动手—检查”循环。

一个 Turn 可以只有一个 Step，也可以因为工具结果或后续输入而连续执行多个 Step；因此“收到一句话”不等于“只调用一次模型”。

三个输入方法可以这样记：

- `followup()`：提交一张新的普通工作单，通常开启新的 Turn。
- `steer()`：给当前工作周期追加下一步指示，模型下一次准备工作时读取。
- `inject()`：把额外上下文放进下一步，但不负责唤醒空闲 Agent。

### 3.2 一次 Turn 的真实顺序

```text
followup
  → send 到 inbox
  → wakeDriver
  → kick
  → turn：append turn/start
  → preStep：claim inbox、组装 Prompt、运行 agent/pre-step
  → append step/start 和 user/message
  → step：构造请求、调用 LLM、保存 assistant/chunk
  → 保存 assistant/message
  → 如果有 Tool Call，运行工具流水线
  → append tool/result 和 step/end
  → 没有后续工作时运行 agent/turn-stopping
  → append turn/end
```

### 3.3 源码锚点：该看哪些文件和函数

| 阅读目标 | 文件 | 重点函数或位置 |
|---|---|---|
| Agent 对外输入 | [`../../packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts) | `Agent.followup`、`steer`、`inject`、`cancel`、`whenIdle` |
| Agent 如何被唤醒 | [`../../packages/core/agent-loop/src/agent.ts`](../../packages/core/agent-loop/src/agent.ts:113) | `send`、`followup`、`steer`、`inject`、`cancel` |
| 运行状态如何切换 | [`../../packages/core/agent-loop/src/agent.ts`](../../packages/core/agent-loop/src/agent.ts:103) | `setPhase`、`wakeDriver`、`whenIdle` |
| Turn 如何开闭 | [`../../packages/core/agent-loop/src/agent.ts`](../../packages/core/agent-loop/src/agent.ts:210) | `kick`、`turn` |
| 一步如何准备 | [`../../packages/core/agent-loop/src/agent.ts`](../../packages/core/agent-loop/src/agent.ts:225) | `preStep`、`systemPrompt.assemble`、`agent/pre-step` |
| 一步如何请求模型 | [`../../packages/core/agent-loop/src/agent.ts`](../../packages/core/agent-loop/src/agent.ts:332) | `step`、`buildRequest`、`llm.stream` |
| 工具调用如何被驱动 | [`../../packages/core/agent-loop/src/tool-calls.ts`](../../packages/core/agent-loop/src/tool-calls.ts) | `executeToolCalls` 和调用顺序 |

### 3.4 读 `turn()` 时重点观察

`turn()` 先记录 `turn/start`，再反复准备 Step；如果第一批消息被拒绝或被改写为空，Turn 仍然可能记录关闭事件，但不会产生模型请求。

`step()` 先从 Session 派生历史，再构造请求；模型流中的每个 Chunk 先写入 `assistant/chunk`，最后由 `BlockAssembler` 组装成 `assistant/message`。

如果模型回复包含工具调用，`step()` 不会把工具当成 Agent Loop 之外的旁路；它会调用 `executeToolCalls()`，工具结束后把后续上下文放回下一步输入，再决定是否继续同一个 Turn。

### 3.5 最小验证

先阅读 [`../../packages/core/agent-loop/tests/loop.spec.ts`](../../packages/core/agent-loop/tests/loop.spec.ts)，再对照 [`../../packages/core/agent-loop/tests/cancel.spec.ts`](../../packages/core/agent-loop/tests/cancel.spec.ts) 和 [`../../packages/core/agent-loop/tests/tool-order.spec.ts`](../../packages/core/agent-loop/tests/tool-order.spec.ts)。这些测试比直接读所有并发和恢复代码更适合建立主线。

## 4. 模块四：Session 与上下文重建

### 4.1 白话模型：一本不能撕页的工作账本

Session 像一本追加式工作账本：每次收到输入、模型吐出一段内容、工具开始或结束、Turn 开始或结束，都在账本后面追加一条记录。

`deriveMessages()` 像会计根据账本重算“当前对话应该长什么样”；它不是单独维护一份容易和日志分叉的聊天数组。

因此，Session Log 同时服务于模型请求、UI 回放、会话恢复、分叉、持久化和测试快照。项目的关键原则是：模型可见内容必须能从日志重建。

### 4.2 Durable Event 和 Live Event

Durable Event 是写进 Session 的事实，例如：

- `turn/start`、`turn/end`；
- `step/start`、`step/end`；
- `user/message`；
- `request/header`、`request/context`；
- `assistant/chunk`、`assistant/message`；
- `tool/call`、`tool/result`。

Live Event 是运行时协作消息，例如 `agent/status`、`agent/pre-step`、`agent/request` 和 `tools/pre-execute`；它们可以影响当前工作，但不能自动替代需要恢复的持久化事实。

`session/event` 是把已经追加的 Session Event 广播给 UI、SDK、持久化和其他消费者的通知；它和 `agent/*` 的实时控制事件不是同一类东西。

### 4.3 源码锚点：该看哪些文件和函数

| 阅读目标 | 文件 | 重点函数或位置 |
|---|---|---|
| Session Event 类型 | [`../../packages/core/session/src/types.ts`](../../packages/core/session/src/types.ts:243) | `SessionEventMap`、Turn/Step、消息和工具事件 |
| 事件追加和冻结 | [`../../packages/core/session/src/index.ts`](../../packages/core/session/src/index.ts:604) | `Session.append`、序号、快照、事件通知 |
| 从日志派生模型历史 | [`../../packages/core/session/src/index.ts`](../../packages/core/session/src/index.ts:726) | `deriveMessages`、`deriveEventMessage` |
| 请求上下文重建 | [`../../packages/core/session/src/index.ts`](../../packages/core/session/src/index.ts:670) | `requestHeader`、`requestContext` |
| Session 注册和持久化边界 | [`../../packages/core/session/src/index.ts`](../../packages/core/session/src/index.ts:793) | `SessionStore.create`、`enter`、`announce`、`flush`、`fork` |
| 消息投影规则 | [`../../packages/core/session/src/surface.ts`](../../packages/core/session/src/surface.ts) | 事件如何转成模型消息和 UI 表面 |
| JSONL 后端 | [`../../packages/session/session-persistence-jsonl/src/index.ts`](../../packages/session/session-persistence-jsonl/src/index.ts) | JSONL 读写、恢复和 flush 相关实现 |

### 4.4 一个请求为什么要记录多个事件

不要把 `assistant/chunk` 和 `assistant/message` 当成重复数据：前者保留流式到达过程，后者保存已经组装完成的消息；UI 需要前者获得实时体验，模型历史通常需要后者获得稳定消息。

同样，`request/header` 记录的是本次模型请求的完整非历史配置，`request/context` 记录模型和上下文窗口等请求环境；恢复时，Agent 可以从日志重新知道当时请求使用的模型、系统提示和工具 Schema。

### 4.5 最小验证

```sh
pnpm exec vitest run packages/core/session/tests/session.spec.ts
pnpm exec vitest run packages/core/session/tests/repair.spec.ts
```

阅读测试时重点找“追加后能否恢复”“坏事件如何被拒绝”“Turn/Step 是否保持嵌套关系”，不要只关注字符串是否匹配。

## 5. 模块五：能力缝隙与工具扩展

### 5.1 白话模型：标准插座、不同电器

能力缝隙可以理解成标准插座：Service Definition 规定插孔的形状，Provider 是接入插座的电源或设备，Consumer 是使用电力完成工作的电器。

只要三者遵守同一接口，换 Provider 时就不必重写 Consumer。例如把本地文件系统换成 E2B 文件系统，上层的 `read`、`write`、`edit` 工具和 Agent Loop 仍然可以保持不变。

### 5.2 文件系统的三层结构

```text
FileSystem 抽象服务
  → fs-local / fs-sandbox / fs-e2b Provider
  → tool-fs 的 read / write / edit Consumer
  → fs/* 事件上的观察、版本和权限策略
```

`FileSystem` 负责稳定的路径、读取和原子修改能力；Provider 决定这些动作发生在本机、沙箱还是远程执行世界；`tool-fs` 负责模型看到的参数 Schema、窗口限制、结果格式和工具注册。

### 5.3 工具策略流水线

工具调用像机场过检：

- `tools/pre-execute` 是安检和准入，负责拒绝、询问授权或补充策略信息；
- `tools/execute` 是真正登机和飞行的过程，适合包裹超时、取消、指标和执行生命周期；
- `tools/post-execute` 是落地后的结果整理，适合改变结果或补充上下文；
- `tools/result` 是把最终结果广播给观察者，适合审计、统计和 UI 更新。

安检监听器如果判定不允许，可以不调用 `next()`；只做观察或包装的监听器必须调用 `next()`，否则会意外截断整个流水线。

### 5.4 源码锚点：该看哪些文件和函数

| 阅读目标 | 文件 | 重点函数或位置 |
|---|---|---|
| 工具事件和类型 | [`../../packages/core/tools/src/index.ts`](../../packages/core/tools/src/index.ts:152) | `tools/pre-execute`、`tools/execute`、`tools/post-execute`、`tools/result` |
| 工具注册和 Schema | [`../../packages/core/tools/src/index.ts`](../../packages/core/tools/src/index.ts:1037) | `ToolRuntime.register`、`schemas`、`get` |
| 工具执行主入口 | [`../../packages/core/tools/src/index.ts`](../../packages/core/tools/src/index.ts:1342) | `execute`、`prepareExecution`、`dispatchToolBody`、`postExecute` |
| 文件系统服务契约 | [`../../packages/fs/fs/src/index.ts`](../../packages/fs/fs/src/index.ts:86) | `FileSystem`、`resolve`、`readText`、`writeText`、`editText` |
| 文件工具 Consumer | [`../../packages/fs/tool-fs/src/index.ts`](../../packages/fs/tool-fs/src/index.ts:54) | `apply`、`applyReadTool`、`applyWriteTool`、`applyEditTool` |
| Shell 服务契约 | [`../../packages/shell/shell/src/index.ts`](../../packages/shell/shell/src/index.ts:66) | `ShellExecutor`、`resolve`、`run`、`start` |
| Bash 工具 Consumer | [`../../packages/shell/tool-bash/src/index.ts`](../../packages/shell/tool-bash/src/index.ts:190) | `apply`、`defineTool`、沙箱和审批处理 |
| LLM 服务注册和流 | [`../../packages/llm/llm/src/index.ts`](../../packages/llm/llm/src/index.ts:913) | `registerAdapter`、`prepareCall`、`stream`、`llm/stream` |
| DeepSeek Provider | [`../../packages/llm/llm-deepseek/src/index.ts`](../../packages/llm/llm-deepseek/src/index.ts:226) | `apply`、`registerAdapter`、凭证和配置解析 |
| DeepSeek 具体适配器 | [`../../packages/llm/llm-deepseek/src/adapter.ts`](../../packages/llm/llm-deepseek/src/adapter.ts:171) | `resolveModel`、`stream`、错误归一化 |

### 5.5 从工具定义追到模型请求

一个工具不是只有一个 `execute()` 函数，它至少有四个面：模型可见的名称和描述、参数 Schema、实际执行逻辑、结果和 UI 展示方式。

工具注册后，`ToolRuntime.schemas()` 把 Schema 提供给 Prompt 组装；模型返回 Tool Call 后，Agent Loop 根据工具名找到定义；`ToolRuntime.execute()` 进入策略流水线；最后结果被规范化并写回 Session。

模型工具的基础教程见 [`../../docs/user/develop/basic/tool.zh.md`](../../docs/user/develop/basic/tool.zh.md)，完整扩展参考见 [`../../docs/cookbook/adding-a-tool.zh.md`](../../docs/cookbook/adding-a-tool.zh.md)。

### 5.6 最小验证

```sh
pnpm exec vitest run packages/core/tools/tests/tools.spec.ts
pnpm exec vitest run packages/core/agent-loop/tests/tool-calls.spec.ts
pnpm exec vitest run packages/fs/tool-fs/tests/tools.spec.ts
```

先让一个纯计算工具跑通，再加入文件写入、审批和沙箱；这样每次只引入一个新概念。

## 6. 模块六：不同入口共享同一个核心

### 6.1 白话模型：同一家厨房的多个窗口

Web、Headless、ACP 和 SDK 像同一家厨房的不同窗口：Web 负责交互界面，Headless 负责一次性任务，ACP 负责自动化协议，SDK 负责让另一个进程调用能力；它们不应该各自复制一套 Agent Loop。

这些入口的共同点是：创建或获取 Agent，把输入送进 Agent，把 Session Event 或最终结果投影成自己的输出格式。

### 6.2 源码锚点

| 入口 | 文件 | 阅读重点 |
|---|---|---|
| Headless | [`../../packages/bundle/headless/src/index.ts`](../../packages/bundle/headless/src/index.ts) | `run` 如何创建 Agent、`followup`、等待 `whenIdle`、汇总结果 |
| ACP | [`../../packages/acp/acp/src/index.ts`](../../packages/acp/acp/src/index.ts) | 协议请求如何映射到 Agent 和 Session |
| ACP 示例 | [`../../examples/acp-agent/README.zh.md`](../../examples/acp-agent/README.zh.md) | stdout 协议纯净性、权限和 Session 配置 |
| Web 客户端 | [`../../packages/client`](../../packages/client) | 如何从 `session/event` 渲染界面并驱动输入 |
| Web 服务端 | [`../../packages/host`](../../packages/host) | 如何把服务和事件暴露给浏览器 |
| JSON-RPC / SDK | [`../../packages/sdk`](../../packages/sdk) 与 [`../../examples/jsonrpc-agent`](../../examples/jsonrpc-agent) | 进程外调用、传输和生命周期 |

### 6.3 读不同入口时的判断标准

如果一个入口重复实现“排队、请求模型、执行工具、保存 Session”，说明阅读方向错了；这些职责属于 Core 和 Capability，入口只负责协议、交互和结果投影。

## 7. 把六个模块串成一条源码阅读路线

第一次阅读按下面顺序推进：

1. 运行 `pnpm dsh --profile web --dump-config`，先看实际插件树。
2. 阅读 [`../../apps/cli/src/bin.ts`](../../apps/cli/src/bin.ts) 和 [`../../apps/cli/src/profile-boot.ts`](../../apps/cli/src/profile-boot.ts)，确认启动入口。
3. 阅读 [`../../docs/cordis-primer.zh.md`](../../docs/cordis-primer.zh.md)，掌握 `inject`、Service、Event 和 Effect。
4. 阅读 [`../../packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)，先看公开契约，不要直接跳实现细节。
5. 阅读 [`../../packages/core/agent-loop/src/agent.ts`](../../packages/core/agent-loop/src/agent.ts)，只追 `followup → wakeDriver → kick → turn → preStep → step`。
6. 阅读 [`../../packages/core/session/src/types.ts`](../../packages/core/session/src/types.ts) 和 `Session.append()`，记录每个持久化事件。
7. 阅读 [`../../packages/core/tools/src/index.ts`](../../packages/core/tools/src/index.ts)，追一个 Tool Call 的 `pre → execute → post → result`。
8. 选择文件系统或 LLM，按 Definition → Provider → Consumer 读完一个能力缝隙。
9. 最后阅读 Headless、ACP 或 Web，确认外部入口如何复用 Agent 和 Session。
10. 用对应的包测试验证自己的理解；测试结果与理解不一致时，回到类型和事件契约。

## 8. 一张长期使用的源码卡片

每次读一个 Service、函数或事件，都填写下面的卡片：

```text
它解决什么问题：
它的拥有者是谁：
输入和输出是什么：
读取哪些 ctx Service：
发出哪些实时 Event：
追加哪些 Session Event：
失败、取消、重试和卸载如何处理：
对应哪个 example 和 test：
```

当一张卡片无法填写“拥有者、持久化和失败语义”时，说明当前只看到了控制流，还没有真正理解这个模块。

## 9. 最后压缩成五句话

Profile 决定哪些插件上场，Bundle 提供可复用的组合，Patch 提供用户覆盖；Cordis 负责让插件在正确的 Service 可用时激活，并在卸载时清理注册；Agent Loop 负责把 inbox 中的输入推进成一个或多个 Turn/Step；Session Log 记录可恢复的事实，并重新构建模型上下文；能力缝隙让 LLM、文件系统、Shell、沙箱和工具可以替换，而不同入口只负责把同一套核心能力呈现给不同调用者。
