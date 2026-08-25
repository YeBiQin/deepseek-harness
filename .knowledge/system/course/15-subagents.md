# 第 15 篇：子 Agent 的两条生命周期

本篇回答：一个 Agent 怎样把任务交给另一个 Agent，以及为什么“一次性委派”和“可继续对话”必须使用不同的句柄、取消和清理模型。

## 本篇目标

- 能区分 `SubagentProvider.start()` 的一次性 run 和 continuation manager 的可继续 child。
- 能解释 provider capabilities、委派深度、tool filter、persona 与 output schema 的启动期检查。
- 能追踪 signal 从调用方到发布前后两个阶段的作用。
- 能理解 inbox、Activation、冷恢复、直接父级授权和 child-first dispose。

## 前置知识

先完成[Agent Turn](../module-3-agent-turn.md)、[Session 重建](../module-4-session-reconstruction.md)和[后台任务](14-background-jobs.md)。子 Agent 是可选能力缝隙，不是 Agent Loop 的内置分支；它把已有 Agent、Session、scope 和 provider 组合起来。

## 1. 一次性 run：一个请求，一个结果

面向调用方的 `SubagentStartRequest` 包含 prompt、parent、signal，以及可选的 output schema、maxDepth、toolFilter、persona。服务先根据 provider 的静态 `capabilities` 检查请求，再把请求解析成 provider-facing descriptor，最后调用具名 provider 的 `start()`。

```text
tool-subagent
  ↓ name + SubagentStartRequest
ctx.subagents.start()
  ↓ capability / depth / schema 校验
provider.start(resolved request)
  ↓ 发布 child 后返回 SubagentRun
await run.result
  ↓ 无论结果如何
await run.dispose()
```

`SubagentRun.result` 对 child-level 失败不 reject，而是返回 `stopReason: completed | aborted | error | max-tokens | refusal` 等结果；只有 seam 无法表达的基础设施故障才 reject。非 completed 的 `output` 可能不完整，Consumer 必须把它作为错误结果，而不是报告成成功答案。

provider 注册表允许多个 provider 共存。`spawn`、`fork`、ACP、Codex、Claude Code 和 DSH SDK 可以有不同能力；能力缺失时必须得到 typed `UNSUPPORTED_CAPABILITY`，不能接受请求后静默忽略 schema、工具过滤或 persona。

## 2. 一次性请求中的四个可选能力

- `outputSchema` 要求 object-rooted JSON Schema；成功时结果才可能有 `structured`，请求 schema 不保证一定得到结构化值。
- `maxDepth` 限制派生 child 的绝对委派深度，不能用一个较小的请求值降低已经持久化的父级深度。
- `toolFilter` 同时影响工具可见性和执行，未知工具名应大声失败，不能只从 prompt 中隐藏。
- `persona` 只作用于这个 child，按和 deployment persona 相同的变量插值规则覆盖 child 的身份段落。

`inheritsParentContext` 只描述对话历史种子：fork 会继承已完成轮次前缀，spawn 和远程 ACP 不继承。它不代表继承工具、服务、权限或 filesystem authority。

## 3. 可继续 child：Session 加 Activation

可继续 child 不是一个长期 Promise。它是一份持久 Session，最多有一个 live Activation；Activation 持有 AgentHandle，Agent inbox 是唯一 FIFO 队列，子级 Activation 由父级所有权集合管理。

```text
持久 Session
  └─ 可选 live Activation
       ├─ 一个 AgentHandle
       ├─ 一个 inbox FIFO
       └─ 其拥有的 child Activations
```

`startContinuable()` 只在初始 prompt 被 inbox 接受后返回 `{ childId, messageId }`，不等待 Turn 开始。`followup()` 根据 Activation 状态路由：running 入队，waiting 唤醒，无 Activation 就冷恢复。调用方 signal 只负责 inbox 接受以前；一旦消息已接受，之后的 Activation 由 continuation manager 独立管理。

可继续 child 的授权来自确切的直接 parent。`interrupt()` 可以取消当前 Turn 但保留 inbox，等待 driver idle 后再通过下一次唤醒恢复；它不会把已领取的工作重新塞回队列。`reportFrom()` 由 child 自己授权，管理器从持久 parentSession 推导唯一接收方，不允许调用方随便指定收件人。

## 4. 深度、描述符和冷恢复

子 Agent 的持久 header 和运行时选项共同记录委派深度；父级深度加一后再检查安全整数和绝对上限。fork 的 seed 必须是从 seq 0 开始、以完整已完成 Turn 结尾的平衡事件前缀。可继续 child 的 descriptor 记录 provider、模式、label，以及用于冷恢复的必要配置，但不记录整个可扩展 AgentOptions 对象。

冷恢复由 continuation manager 调用 `ctx.agents.resume()`，不是重新调用 provider 的 `start()`。Provider 对可继续 child 只提供 detached `ContinuableCreateSpec`，不拥有 Agent、AgentHandle、prompt、result 或 dispose。

## 5. 动手练习：比较两种委派

用同一个 parent 分别启动一个 one-shot child 和一个 continuable child，记录它们返回的身份与等待点。对 one-shot 等 `run.result`，再调用 `dispose()`；对 continuable child 发两次 `followup()`，观察两个 message id 进入同一 inbox 顺序，并在 child 不在线时验证第二次操作走冷恢复。

然后尝试给 provider 加一个它不支持的 `toolFilter` 或 `outputSchema`。正确结果是启动前失败，而不是 child 运行后才发现选项没有生效。

## 6. 验证结果

先运行核心 seam 的服务与生命周期测试：

```sh
pnpm exec vitest run packages/subagent/subagent/tests/service.spec.ts packages/subagent/subagent/tests/continuation.spec.ts packages/subagent/subagent/tests/continuation-inheritance.spec.ts packages/subagent/subagent/tests/run-settlement.spec.ts packages/subagent/subagent/tests/invariant.spec.ts
```

再运行模型工具和进程内 provider 的重点测试：

```sh
pnpm exec vitest run packages/subagent/tool-subagent/tests/tool-subagent.spec.ts packages/subagent/subagent-in-process-driver/tests/subagent-in-process-driver.spec.ts packages/subagent/subagent-in-process-driver/tests/preset-inheritance.spec.ts
```

预期证据包括：能力不支持时 typed reject；一次性 child failure 通过 result 表达；dispose 可重复且最终停稳；continuable child 的 followup 遵守 FIFO；直接父级鉴权拒绝错误调用方；冷恢复不经过 one-shot provider 的生命周期。

## 常见误区

- 把 continuable child 当成一个永不结束的 `SubagentRun`，于是为每轮制造包装 Task。
- 认为 fork 继承了父级权限、工具和服务；它只提供平衡的历史 seed。
- signal 在消息接受后仍强行销毁 Activation，破坏已提交 inbox 的所有权。
- 用 provider 的可用性判断持久 child 是否存在；列表和恢复依赖 Session 与 projection。
- 把非 completed 的部分 output 当作成功答案。

## 权威入口与下一篇

精确 seam 文档见[`docs/subsystems/subagent.zh.md`](../../../docs/subsystems/subagent.zh.md)，核心实现见[`packages/subagent/subagent/src/index.ts`](../../../packages/subagent/subagent/src/index.ts)和[`packages/subagent/subagent/src/continuation.ts`](../../../packages/subagent/subagent/src/continuation.ts)，工具测试见[`packages/subagent/tool-subagent/tests/tool-subagent.spec.ts`](../../../packages/subagent/tool-subagent/tests/tool-subagent.spec.ts)。下一篇学习历史过大时怎样安全替换 Surface。
