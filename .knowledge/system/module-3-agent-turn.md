# 模块三：Agent Turn 核心链路

这是 DeepSeek Harness 深度学习的第三个模块，专门追踪一张工作单如何从进入 Agent，到产生模型请求、执行工具，再决定结束或进入下一步。

本模块以前两个模块为前置知识：你已经知道 Agent 是 Cordis 插件树中的能力，也知道 Service、Event 和 Effect 如何提供运行时协作。本轮先看主流程，Session 的完整重建规则放到后续模块专门拆解。

## 1. 学完本模块要得到什么

完成本模块后，你应该能区分 `Turn` 和 `Step`，解释 `followup()`、`steer()`、`inject()` 的差别，并能沿着真实源码定位一次模型请求从哪里开始、工具结果如何回到下一步。

你不需要现在记住所有取消竞争和并发调度细节；先建立一条能从日志和断点验证的主干，再把异常分支挂回这条主干。

## 2. 先用“项目经理处理工作单”建立直觉

把 Agent 想成项目经理，把 Inbox 想成两层待办盘，把 Turn 想成一张从接单到收工的工作单，把 Step 想成处理这张工作单时的一轮“思考—动手—检查”。

如果模型只返回文字，一个 Turn 可能只有一个 Step；如果模型要求调用工具，工具结果会成为下一轮模型输入，同一个 Turn 就会继续产生第二个或更多 Step。

```text
工作单 Turn
  ├─ Step 1：读输入 → 请求模型 → 模型要求工具
  ├─ 工具：执行动作 → 产生结果
  └─ Step 2：带着工具结果再次请求模型 → 得到最终答复
```

所以，“用户发来一句话”不等于“只调用一次模型”；一次 Turn 是更大的工作周期，Step 才是一次模型请求及其工具后处理的基本单元。

## 3. 三种输入方法：送到哪里，是否唤醒

| 方法 | 放入的位置 | 是否唤醒 Driver | 白话理解 |
|---|---|---|---|
| `followup(message)` | `next-turn` | 是 | 新开一张普通工作单 |
| `steer(message)` | `next-step` | 是 | 给当前工作单追加方向 |
| `inject(message)` | `next-step` | 否 | 准备一段模型可见上下文，但不负责叫醒空闲 Agent |

这三个方法最终都经过 [`../../packages/core/agent-loop/src/agent.ts`](../../packages/core/agent-loop/src/agent.ts:113) 的 `send()`；区别在于目标 Inbox 和 `wakeup` 参数。

### 3.1 `followup()`：新的普通工作单

`followup()` 把消息放进 `next-turn`，并唤醒 Driver。当前 Turn 结束后，如果 Inbox 还有普通工作单，Driver 会开启新的 `turn/start`。

### 3.2 `steer()`：最近一步的方向盘

`steer()` 把消息放进 `next-step` 并唤醒 Driver。正在运行的 Agent 会在下一个 Step 边界领取它；空闲 Agent 收到它时也会启动一个 Turn，但它仍然属于最近的 Step 边界语义。

### 3.3 `inject()`：只准备上下文，不主动叫醒

`inject()` 适合插件把外部观察结果送给模型，例如“文件刚刚发生变化”。它不会因为自己被调用就启动空闲 Agent；如果没有后续的 `followup()` 或 `steer()`，这段上下文会留在 Inbox 中。

这三个入口都不是把数据塞进一个临时数组就结束。`Inbox.splice()` 会先向 Session 追加 `agent/inbox/spliced`，再更新内存投影，因此待处理工作也能在恢复时重新得到。

## 4. 一次 Turn 的主链路

先把整条链路背成一张“路线图”，再逐段打开代码。

```text
followup / steer
  ↓
send → Inbox.splice → agent/inbox/spliced
  ↓
wakeDriver → kick
  ↓
turn → turn/start
  ↓
preStep → claim Inbox → 组装 Prompt → agent/pre-step
  ↓
step → step/start → user/message
  ↓
buildRequest → agent/request → llm.prepareCall / llm.stream
  ↓
assistant/chunk → assistant/message
  ↓
有 Tool Call？
  ├─ 否：step/end → turn-stopping → turn/end
  └─ 是：tool/call → 工具策略流水线 → tool/result → next-step
                                      ↓
                              再进入下一个 Step
```

这张图中，Session 事件名是“可观察的里程碑”，不是另一套平行控制流。后面读 Session 时，你会看到这些事件如何被重建成模型历史；本模块先用它们确认 Agent Loop 走到了哪一步。

## 5. Driver：谁负责把 Agent 从睡眠中叫醒

打开 [`../../packages/core/agent-loop/src/agent.ts`](../../packages/core/agent-loop/src/agent.ts:64) 的 `ReactLoopAgent`。它持有 `inbox`、当前 `phase`、Agent 作用域和 Session；这说明 Agent Loop 不是一个无状态的“调用模型函数”，而是一个拥有队列、取消信号和生命周期的驱动器。

### 5.1 `wakeDriver()`：领取一次运行权

阅读 [`wakeDriver()`](../../packages/core/agent-loop/src/agent.ts:172)，重点看它如何区分空闲、运行中、维护中和已取消的状态。空闲时它创建新的运行阶段并调用 `kick()`；如果当前活动尚未收敛，新的唤醒会被暂存或合并，而不是并行启动第二个 Turn。

初学时只记住一个原则：同一个 Agent 的工作由一个 Driver 串起来。后续输入进入 Inbox，Driver 在安全的边界领取，而不是每条输入各自开一个模型请求。

### 5.2 `kick()`：连续消化可运行的 Turn

阅读 [`kick()`](../../packages/core/agent-loop/src/agent.ts:210)。它循环调用 `turn()`，直到没有待处理工作；最后把状态切回 `idle`，并处理在当前活动期间到达的唤醒请求。

`agent/status` 是观察 Agent 是否正在工作的实时事件；测试通常等待它变为 `idle`，而不是靠固定时间睡眠猜测模型调用结束。

## 6. `turn()`：打开和关闭工作单

阅读 [`turn()`](../../packages/core/agent-loop/src/agent.ts:246)，按下面四个动作标记代码。

1. 生成新的 Turn 编号并追加 `turn/start`。
2. 循环准备 Step，必要时追加 `step/start`、`user/message` 和 `step/end`。
3. 如果没有新 Step 可运行，触发 `agent/turn-stopping`，给插件一个最后观察或追加 Steering 的机会。
4. 无论正常完成、取消还是失败，都追加带原因的 `turn/end`。

`turn()` 返回布尔值，告诉 `kick()` 是否还有待处理工作。这样，多个连续的 `followup()` 可以在同一个 Driver 中排队处理，但每个普通工作单仍然拥有自己的 Turn 边界。

一个很重要的阅读习惯是先看边界事件，再看模型调用。你先确认 `turn/start → step/start → step/end → turn/end`，再进入请求和工具细节，就不会把一个 Step 误读成完整 Turn。

## 7. `preStep()`：模型请求前的准备台

阅读 [`preStep()`](../../packages/core/agent-loop/src/agent.ts:225)。它做了四件事：从 Inbox 领取这一边界应该处理的消息，组装系统提示，投影运行时上下文，然后 dispatch `agent/pre-step`。

`agent/pre-step` 是 waterfall 事件。监听器可以把 Step 标记为 `reject`，也可以替换进入本步的消息；如果只是观察或补充信息，就应当调用 `next()`，遵守模块二学过的协作规则。

这里的 `assembly` 还会携带工具 Schema。它说明工具不是模型调用之后才突然出现的：模型在请求发出前就通过 Prompt 组装看到了当前可用工具的名称、描述和参数格式。

## 8. `step()`：一次模型请求和工具循环

阅读 [`step()`](../../packages/core/agent-loop/src/agent.ts:332)，先忽略异常分支，只观察正常路径。

### 8.1 先构造请求

`step()` 调用 `buildRequest()`，把当前 Turn/Step、系统提示、工具 Schema 和 `session.deriveMessages()` 得到的历史组合成一次模型请求。

在 [`buildRequest()`](../../packages/core/agent-loop/src/agent.ts:426) 中，`agent/request` waterfall 可以替换模型调用配置；然后通过 `ctx.llm.prepareCall()` 找到具体适配器，记录 `request/header` 和 `request/context`，最后构造冻结的请求对象。

初学者可以把 `agent/request` 理解成“项目经理在发工单前的配置审核台”：它能改供应商、模型或请求配置，但不能偷偷修改没有写入 Session 的模型可见消息。

### 8.2 流式接收模型输出

模型输出不是一次性字符串，而是一个个流式 Chunk。`step()` 对每个 Chunk 追加 `assistant/chunk`，同时交给 `BlockAssembler`；流结束后再追加完整的 `assistant/message`。

这样做有两个直接好处：界面可以实时显示输出，恢复和回放又能从持久化事件重建已经收到的内容。详细的事件字段留到 Session 模块再看。

### 8.3 没有工具调用时结束本步

如果聚合后的 Assistant Message 中没有 `tool-call`，`step()` 返回 `completed`；`turn()` 追加 `step/end`，随后检查是否还有 Steering 或其他待处理输入，最后关闭 Turn。

如果模型因为输出上限结束，Step 会返回 `max-tokens`；这个原因也会参与 Turn 结束判断，不应简单当成普通文本完成。

## 9. 有工具调用时：为什么会进入下一个 Step

当 Assistant Message 中出现一个或多个 Tool Call，`step()` 调用 [`executeToolCalls()`](../../packages/core/agent-loop/src/tool-calls.ts:59)，并把工具产生的上下文交给 Inbox 的 `next-step`。

工具执行结束后，当前 Step 的结果会写入 `tool/result`；下一轮 `preStep()` 会领取这些上下文，`buildRequest()` 再从 Session 派生包含工具调用和结果的历史，于是模型能看到“我刚才叫了什么工具、工具返回了什么”。

工具调度不是简单的 `for...of await`。阅读 [`runGroup()`](../../packages/core/agent-loop/src/tool-calls.ts:121) 时，先只掌握三点：工具可以按执行模式串行或并行；结果最终按模型给出的调用顺序提交；取消时，已启动的调用要排空，未启动的调用要留下可回放的结果。

工具调用和结果的持久化位置见 [`appendToolCall()` 和 `appendToolResult()`](../../packages/core/agent-loop/src/tool-calls.ts:261)。它们把一次工具动作变成 Session 中可追踪的 `tool/call` 与 `tool/result`，而不是只留在内存 Promise 里。

## 10. 取消、失败和重试：先挂回主链路

### 10.1 取消

`cancel()` 会清理或保留 Inbox 中的待处理输入，并让当前 AbortSignal 失效；`step()` 在流式读取和工具阶段不断检查这个信号。取消不是把 Promise 粗暴丢掉，而是让 Turn 以 `aborted` 原因收口，并尽量保留能被恢复的事件事实。

可以先阅读 [`../../packages/core/agent-loop/tests/cancel.spec.ts`](../../packages/core/agent-loop/tests/cancel.spec.ts:57)，观察 `keepInbox` 如何决定待处理工作是丢弃还是留给下次唤醒。

### 10.2 模型失败和重试

模型流结束为错误时，`step()` dispatch `agent/request-error` waterfall；监听器返回 `{ kind: 'retry' }` 才会重新尝试，否则错误会变成当前 Step/Turn 的终止原因。

这个扩展点体现了模块二的原则：Agent Loop 提供稳定的失败时刻，重试策略插件决定是否接管；不要在每个 Provider Consumer 里各自复制一套重试循环。

### 10.3 工具失败

工具返回错误通常仍然会形成 `tool/result`，让模型知道工具没有成功；只有调度器本身发生无法安全提交的内部失败，才会沿着 Turn 错误边界退出。学习时先区分“工具业务失败”和“Loop 无法维持事件顺序”这两类问题。

## 11. 源码阅读顺序和断点位置

按下面顺序阅读，不要一开始钻进所有 Provider 或并发细节：

1. 阅读 [`../../packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts:63)，先认识 Agent 对外接口和事件定义。
2. 阅读 [`../../packages/core/agent/src/inbox.ts`](../../packages/core/agent/src/inbox.ts:25)，确认输入如何进入两个 Inbox 列表，以及何时追加 `agent/inbox/spliced`。
3. 阅读 [`ReactLoopAgent.send()`](../../packages/core/agent-loop/src/agent.ts:113) 和 [`wakeDriver()`](../../packages/core/agent-loop/src/agent.ts:172)，理解输入如何唤醒 Driver。
4. 阅读 [`turn()`](../../packages/core/agent-loop/src/agent.ts:246) 和 [`preStep()`](../../packages/core/agent-loop/src/agent.ts:225)，先画出 Turn/Step 边界。
5. 阅读 [`step()`](../../packages/core/agent-loop/src/agent.ts:332) 和 [`buildRequest()`](../../packages/core/agent-loop/src/agent.ts:426)，追到 `ctx.llm.stream()`。
6. 阅读 [`executeToolCalls()`](../../packages/core/agent-loop/src/tool-calls.ts:59)，只追“Tool Call → Tool Result → next-step”闭环。

调试时优先在 `send()`、`wakeDriver()`、`turn()`、`preStep()`、`buildRequest()`、`executeToolCalls()` 和 `session.append()` 设置断点；先观察 `turn`、`step`、Inbox target、事件类型和 Agent status，再看具体文本内容。

## 12. 最小验证：用测试观察一条主线

先运行或阅读 [`../../packages/core/agent-loop/tests/loop.spec.ts`](../../packages/core/agent-loop/tests/loop.spec.ts:166)，确认纯文本 Turn 的边界顺序和最终 `assistant/message`；再看该文件中工具调用场景的 [`工具测试位置`](../../packages/core/agent-loop/tests/loop.spec.ts:214)，确认第二个模型请求能看到 `tool/result`。

然后阅读 [`../../packages/core/agent-loop/tests/tool-order.spec.ts`](../../packages/core/agent-loop/tests/tool-order.spec.ts:67)，理解工具注册顺序不应直接泄漏为模型看到的顺序；最后阅读 [`../../packages/core/agent-loop/tests/loop.spec.ts`](../../packages/core/agent-loop/tests/loop.spec.ts:640)，观察 idle 状态下 `inject()` 只持久化上下文而不立即打开 Turn。

如果只想跑最小范围，可以使用：

```sh
pnpm vitest run packages/core/agent-loop/tests/loop.spec.ts
```

仓库的 Agent 生命周期总览见 [`../../docs/agent-lifecycle.zh.md`](../../docs/agent-lifecycle.zh.md)，但阅读时仍以当前源码和测试为准；这份模块文档的目标是帮助你建立进入源码的顺序。

## 13. 动手练习：画一条你自己的事件链

### 练习 A：纯文本 Turn

从 `loop.spec.ts` 找一个只返回文本的测试，抄出 Session 事件类型顺序，至少包含 `turn/start`、`step/start`、`user/message`、`assistant/message`、`step/end` 和 `turn/end`，并在每个事件旁写一句“它记录了什么事实”。

### 练习 B：工具 Turn

找一个 Mock Adapter 先返回 Tool Call、再返回文本的测试，画出两个 Step；在图中标出 `tool/call`、`tool/result` 和第二次模型请求的位置。

### 练习 C：三种输入对比

分别调用一次 `followup()`、`steer()` 和 `inject()`，观察 Inbox 目标、是否唤醒、`turn/start` 数量和 `agent/inbox/spliced` 事件。不要只看最终回复，要同时看 Session 事件和 Agent status。

## 14. 常见误区

- 把 Turn 当成一次模型 API 调用：有工具时，一个 Turn 会跨多个 Step。
- 把 `steer()` 当成新的独立 Turn：它优先进入下一步边界，是否开启新 Turn 要结合 Agent 当时状态和 Inbox。
- 把 `inject()` 当成唤醒接口：它只排队模型可见上下文，不主动唤醒空闲 Agent。
- 把流式 Chunk 当成最终消息：`assistant/chunk` 是过程事实，`assistant/message` 是聚合后的消息事实。
- 把工具调用当成 Loop 外部副作用：工具调用、结果和下一步上下文都由 Agent Loop 编排并写入 Session。
- 只追最终文本不看边界事件：遇到取消、重试或工具循环时，没有 `turn/step` 边界就很难判断实际发生了什么。

## 15. 自测与参考答案

可以用自己的话思考：模型在第一个 Step 返回了一个 Tool Call，工具也成功返回了结果，为什么 Agent Loop 不直接把工具结果当成最终回答，而要把它放入 `next-step` 再请求一次模型？

参考答案：工具结果是模型继续推理所需的事实，不一定是用户最终要看的答案。放入 `next-step` 后，模型可以读取工具结果，决定是否继续调用工具、解释结果或结束 Turn；Agent Loop 负责把这个过程记录成连续的 Step 和 Session 事件。

读完本模块后，继续模块四的 Session 与上下文重建；事件顺序练习可以按需完成。
