# 第 17 篇：Workflow 与受控脚本编排

本篇回答：模型写出的脚本怎样在受控运行时里启动多个子 Agent、报告阶段和日志，并在脚本卡住或取消时有界地结束。

## 本篇目标

- 能解释 Workflow Engine、worker provider 和 tool Consumer 的三层关系。
- 能区分 `meta`、`args`、脚本文本、`agent()` 和 `phase()` 的职责。
- 能判断哪些错误必须作为 fatal error 终止整个脚本。
- 能验证 `result` 不 reject、`dispose()` 会等待有界清理。

## 前置知识

先完成[能力缝隙](../module-5-capability-and-tools.md)、[后台任务](14-background-jobs.md)和[子 Agent](15-subagents.md)。Workflow 不是另一套 Agent Loop；它是一个可选的脚本编排引擎，所有脚本启动的 child 都归请求中的 parent Agent。

## 1. 一个 Workflow 请求包含什么

`WorkflowStartRequest` 由 `script`、`meta`、可选 `args`、可选的 child provider 和 `maxTotalAgents`、必填 `parent` 以及可选 signal 构成。`meta` 和 `args` 是普通 JSON 数据，Engine 会在脚本运行前校验 `meta`；它不会通过求值脚本文本来“推断”身份数据。

`WorkflowMeta` 要求 kebab-case 的 `name` 和一行 `description`。`whenToUse` 用于列表展示，`phases` 只是允许观察者知道阶段标题；`phase()` 不改变执行拓扑，也不自动创建并行或流水线。

## 2. worker 中的一次运行

```text
tool-workflow 构造 request
  ↓
workflowEngine.start()
  ↓ 校验 meta、脚本选项和上限
workflow/start
  ↓
worker 执行脚本；agent() 调用 subagent provider
  ↓ workflow/phase、log、agent-start/end
脚本 return 普通 host JSON
  ↓
WorkflowResult + workflow/end
  ↓ tool Consumer 写 run-start/run-end 并 dispose
```

当前 worker-thread Provider 每次 run 使用一个 Node worker，脚本的 vm 上下文在其中。脚本可以 top-level await，最后返回 host-domain JSON；`undefined` 物化为 `null`。worker 不是安全沙箱的同义词，文件效果仍由被调用的工具和沙箱策略负责。

## 3. fatal error 与普通失败

错误选项、未知或延迟的 `agent()` 选项、不支持的结构化 schema、超过上限、无法启动 child 和取消都会产生 `WorkflowError.fatal = true`。`parallel()` 与 `pipeline()` 对 fatal error 直接重新抛出，避免把配置拼写错误伪装成某个 child 的普通失败。

普通 child 失败可以转换成非成功结果或组合器中的 `null`；这只表示该项没有得到有效答案，不表示 Workflow 配置错误。顶层 `WorkflowResult` 的 `stopReason` 是 `completed`、`cancelled` 或 `error`，非 completed 时用 `error` 提供失败信息，不能把部分值当成功返回。

## 4. 句柄、取消和事件

`WorkflowRun.result` 永不 reject；调用方通过结果读取脚本失败。`cancel()` 发出取消，`dispose()` 负责必要时取消、等待有界 settlement，并等待 child cleanup。即使脚本不合作，Engine 也在 grace period 后把结果结算为 cancelled，并终止 worker；Consumer 仍必须在所有路径调用 dispose。

`workflow/*` 是观察事件，payload 是快照，不暴露可 cancel/dispose 的 live run。listener 异常被隔离，`workflow/end` 不携带可变的 result value。顶层工具另外把展示事实写入父 Session：run-start 和 run-end 成对，嵌套 transport 不重复写。

## 5. 动手练习：写三个脚本

编写三个最小脚本：第一个使用 `phase()`、`log()` 并返回 JSON；第二个启动两个 child 并返回它们的结构化结果；第三个传入一个超出上限或不支持的选项。对每个脚本先预测 WorkflowResult，再查看 `workflow/*` 事件的配对。

练习的关键观察是：phase 不会自动并发；普通 child 失败不一定结束整个运行；fatal 配置错误必须让脚本明确失败；取消后 result 仍然 resolve。

## 6. 验证结果

运行 Workflow Service 和不变量测试：

```sh
pnpm exec vitest run packages/workflow/workflow/tests/workflow.spec.ts packages/workflow/workflow/tests/invariant.spec.ts
```

再运行 worker-thread 的组合测试和模型工具测试：

```sh
pnpm exec vitest run packages/workflow/workflow-worker-thread/tests/integration.spec.ts packages/workflow/workflow-worker-thread/tests/meta.spec.ts packages/workflow/workflow-worker-thread/tests/realm.spec.ts packages/workflow/tool-workflow/tests/tool-workflow.spec.ts packages/workflow/tool-workflow/tests/invariant.spec.ts
```

预期证据包括：无效 meta 在脚本运行前失败；result 对脚本错误和取消都 resolve；agent-start/end 与 agent 序号配对；worker 终止不会无限等待；顶层 Session 的 run-start/run-end 不会被嵌套调用重复写入。

## 常见误区

- 把 Workflow 当成任意 JavaScript 执行器，忘记 meta、schema、child 上限和 worker 生命周期。
- 把 `phase()` 误解成并行调度语义。
- 把所有 child 失败都升级成 fatal，丢失组合器对普通失败的区分。
- 只等待 `result` 不调用 `dispose()`，让 worker 或 child 继续占用资源。
- 让观察事件携带 live `WorkflowRun`，使 listener 可以越权取消或修改运行。

## 权威入口与下一篇

精确契约见[`docs/subsystems/workflow.zh.md`](../../../docs/subsystems/workflow.zh.md)，类型见[`packages/workflow/workflow/src/types.ts`](../../../packages/workflow/workflow/src/types.ts)和[`packages/workflow/workflow/src/runtime-types.ts`](../../../packages/workflow/workflow/src/runtime-types.ts)，默认实现见[`packages/workflow/workflow-worker-thread`](../../../packages/workflow/workflow-worker-thread)。下一篇学习如何在会话创建前按 preset 组装工具与提示词。
