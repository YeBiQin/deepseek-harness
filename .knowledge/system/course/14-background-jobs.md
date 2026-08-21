# 第 14 篇：后台任务的拥有、读取与终止

本篇回答：一个工具启动后不能在当前 Turn 内完成的工作，如何被注册、授权访问、读取增量输出、取消，并在生产方真正释放资源后才被视为结束。

## 本篇目标

- 能区分 Job Registry 的身份、授权和生产方资源。
- 能解释 `running`、`stopping` 与三个终态的差异。
- 能理解流式输出的消费游标和最终输出型任务的读取语义。
- 能写出一个生产方必须遵守的 `JobHooks` 生命周期。

## 前置知识

先完成[Agent Turn](../module-3-agent-turn.md)、[工具策略流水线](../module-5-capability-and-tools.md)和[进程沙箱](13-sandbox-and-execution.md)。Jobs 不是新的 Agent Loop，而是一个由生产方提供执行资源、由 Registry 管理身份和生命周期的能力缝隙。

## 1. 两个拥有者

生产方拥有实际资源，例如进程、子 Agent 或输出缓冲；它通过同步的 `run()` 返回 `JobHooks`。Registry 拥有品牌化 `JobId`、状态、授权、快照、等待者和完成通知。启动前由 Registry 做预检，预检通过后才调用 `run()`；`run()` 抛异常时不能留下一个看似存在的 Job。

```text
JobStart
  ↓ preflight：owner、controller、参数、容量
run() → JobHooks
  ↓ 原子注册
JobId / running snapshot
  ↓ read、wait、kill 或 owner dispose
stopping → completed | killed | failed
  ↓ producer 释放资源
done → 结算、通知、释放 waiter
```

`done` 的完成时间很重要：它必须等生产方释放资源，而不是只等“任务逻辑认为自己结束”。否则 `list()` 已经没有 running 记录，进程或文件句柄却仍然存在。

## 2. 授权依赖 owner，不依赖 id 保密

Job id 的格式是 `<kind>-N`，可预测，所以安全边界不能是“猜不到 id”。有 owner 的任务按 owner 的 `SessionId` 授权，`get`、`list`、`read`、`kill`、`wait` 都要检查调用方；没有 owner 的任务才可被未绑定 Agent 的调用方看到。Agent dispose 会取消并等待它拥有的任务。

本地 Registry 还按确切 owner 统计并发容量，默认每个 owner 最多 10 个 running 或 stopping 任务。容量释放发生在生产方终态结算后，而不是 kill 请求刚发出时。

## 3. 输出和通知

有 `readOutput()` 的 Job 是消费型流：每次 `read()` 返回上次读取之后的 delta，并推进唯一游标。没有 `readOutput()` 的 Job 是最终输出型：运行期间为空，结算后返回 final output，重复读取不消费。快照每次都是新的只读投影，不是 Registry 内部可变对象。

`kill()` 请求同步取消并把任务置为 `stopping`、标记已报告；最终结算采用 first-wins。`onJobDone` 监听器收到 terminal snapshot 和确切 owner，异常被隔离；完成通知在记录提交后才发出，因为 listener 可能立即开启模型 Turn。

## 4. 动手练习：实现一个可终止的假生产方

在测试里构造一个 `JobStart`：`run()` 立即返回 hooks，定时器每次产生一段输出，`cancel()` 同步设置停止标志，`done` 在清理定时器后 resolve。然后验证：另一个 Session 不能 `read` 或 `kill`；连续两次 `read` 不会重复流式 delta；`kill` 后最终状态是 `killed` 而不是马上删除。

不要在练习中把 Registry 的状态直接改成 completed。那会绕过生产方资源释放，正好暴露出两个拥有者的分工。

## 5. 验证结果

运行抽象服务和本地实现测试：

```sh
pnpm exec vitest run packages/jobs/jobs/tests/service.spec.ts packages/jobs/jobs/tests/invariant.spec.ts packages/jobs/jobs-local/tests/jobs.spec.ts packages/jobs/jobs-local/tests/loader-composition.spec.ts
```

如果要验证模型控制工具，再运行：

```sh
pnpm exec vitest run packages/jobs/tool-jobs/tests/tool-jobs.spec.ts
```

预期结果包括：跨 owner 访问被拒绝；启动预检失败时没有 Job；kill 是幂等且有 stopping 过渡；完成通知不会重复；输出读取遵守流式游标和最终输出语义；dispose 会等待资源清理。

## 常见误区

- 把 Job 当成“后台 Promise”，忽略授权、输出游标和可观察状态。
- `cancel()` 只设置一个布尔值，却不保证 `done` 最终结算。
- 任务逻辑结束就立即释放容量，没有等待子进程或文件资源。
- 在 teardown 期间为了发通知重新唤醒一个已经没有读取者的模型会话。

## 权威入口与下一篇

精确类型见[`docs/subsystems/jobs.zh.md`](../../../docs/subsystems/jobs.zh.md)，抽象服务见[`packages/jobs/jobs/src/index.ts`](../../../packages/jobs/jobs/src/index.ts)，本地实现见[`packages/jobs/jobs-local/src/index.ts`](../../../packages/jobs/jobs-local/src/index.ts)，模型工具见[`packages/jobs/tool-jobs`](../../../packages/jobs/tool-jobs)。下一篇学习比后台 Job 更接近 Agent 语义的子 Agent 委派。
