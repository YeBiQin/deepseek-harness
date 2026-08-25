# 第 19 篇：Agent Teams（实验性）

本篇介绍当前仓库里的实验性 Agent Teams，不把它当成稳定主线能力。它适合在用户明确要求“组建 teammate 协作”时学习；普通子 Agent、Workflow 和 Agent Teams 是三种不同的编排模型。

## 本篇目标

- 能区分 Team Lead、具名 teammate、一次性 child 和普通 continuable child。
- 能解释 Lead Session 中的 roster、持久 mailbox 和共享任务 DAG。
- 能理解 mailbox 去重、任务 revision 和 write scope 的边界。
- 能在使用实验插件前明确共享 checkout 与单进程限制。

## 前置知识

先完成[子 Agent](15-subagents.md)、[Workflow](17-workflow.md)和[Session 重建](../module-4-session-reconstruction.md)。Agent Teams 建立在 continuable-subagent 与持久 Session 之上，但拥有自己的 Team 事件和 Lead-only 操作。

## 1. Team 的身份与 roster

每个普通运行时 Root 都隐式成为 Team Lead，`TeamId` 等于 Root `SessionId`。teammate 是具名、持久化的 continuable 直接 child；名字在 Team 生命周期内不可变，Session id 才是持久和授权身份。成员从 `provisioning` 开始，最终到 `active` 或 `failed`；`running`、`idle`、`inactive` 是实时状态，不会改写 roster phase。

创建流程先把 provisioning member flush 到 Lead Session，再让配置的 fresh/fork provider 创建 child。provider 失败会留下 failed member，避免名字被复用；恢复时会核对 child parent、descriptor 和初始消息是否已经持久化。

## 2. Peer mailbox

Lead Session 先保存完整的 `team/message/queued`。只有 target Session 的 pending inbox 或用户消息历史持久化了相同 message id，Lead 才追加 `team/message/delivered`。因此 queued minus delivered 就是恢复时的 mailbox。

`quiet` 投递可以把消息注入 live target，但不唤醒 inactive target；`wakeup` 投递会成为下一个 FIFO Turn，并在需要时冷恢复。成功写入持久队列后的 `queued` 结果已经是成功，不允许调用方因为即时投递推迟而重发。target 侧的 `TeamMessageSource` 与 id 用于崩溃恢复后的去重。

这是单进程、进程内重试和 target Session 去重，不是跨进程 exactly-once。多个 harness 进程同时操作同一个 Team 不在当前保证内。

## 3. 共享任务 DAG

每条任务变更都写完整快照，并递增 `revision`。更新必须携带 `expectedRevision`，陈旧调用方得到 stale revision，而不会覆盖最新状态。`blockedBy` 必须指向未删除任务并保持无环；所有 blocker completed 后 pending 才是 ready。

`writeScopes` 会被规范化为 workspace-relative 路径前缀，用来提示可能的写入重叠，不是锁，也不授予文件权限。共享 checkout 中所有成员即时看到对方修改，所以 Lead 必须分配不重叠范围、在 formatter/codegen 前协调，并在最终回答前检查 diff。

## 4. 模型工具与权限

实验性 `tool-agent-team` 在 Lead 和 teammate scope 中安装策略与工具。只有用户明确要求 Agent Teams 或 teammate 时才创建成员；它不会因为一个普通任务自动组队。`spawn_teammate` 和 `interrupt_agent` 在服务内部检查 Lead 身份，不能只靠工具描述文字约束。

Team 成员可以发送 peer 消息和使用任务板；Lead 才能创建 teammate、interrupt teammate、分配任务。`wait_agent` 只观察调用后发生的变化，不会唤醒 inactive member；若没有其他 running 或 provisioning member，应该立即返回 noProgress，先用 followup_task 唤醒必要成员再等待。

## 5. 动手练习：三成员协作回放

在显式启用实验插件的配置中创建两个 teammate：一个 quiet 接收资料，一个 wakeup 执行任务。创建带 blocker 的共享 task，让一个成员 claim 后更新，另一个使用旧 revision 更新并观察拒绝。最后让 Lead list roster、task 和 mailbox，重启或冷恢复后比较 queued-minus-delivered。

练习中不要让两个成员写同一个文件，也不要把 write scope 当成互斥锁。完成标准是能从 Lead Session 日志解释每条 queued、delivered、task revision 和成员 phase。

## 6. 验证结果

运行 Team 服务和模型工具测试：

```sh
pnpm exec vitest run packages/experimental/agent-team/tests/team.spec.ts packages/experimental/agent-team/tests/fold.spec.ts packages/experimental/agent-team/tests/persistence.spec.ts packages/experimental/agent-team/tests/invariant.spec.ts packages/experimental/tool-agent-team/tests/tool-team.spec.ts
```

如果仓库当前测试文件名称不同，先用下面的命令确认实际入口，再运行对应文件：

```sh
rg --files packages/experimental/agent-team packages/experimental/tool-agent-team | rg 'tests/.*spec\.ts$'
```

预期证据包括：非 Lead 不能执行 Lead-only 操作；消息持久化后不会因 queued 结果重发；target 侧身份可以去重；任务 revision 和 DAG 不变量被拒绝；wait_agent 不会无条件唤醒 inactive teammate。

## 当前限制

- 所有成员共享同一个 cwd，不提供 worktree、自动 merge 或文件锁。
- write scope 只是协作提示，Bash、formatter、codegen 和外部写入可以绕过它。
- roster 扁平且名字不可复用，不支持嵌套 Team、重命名或删除成员。
- idle、interrupt、退出和工作失败不会自动释放任务 owner。
- mailbox 不是跨进程 exactly-once，也没有完整 mailbox 时间线 UI。

## 权威入口

稳定词汇见[`docs/subsystems/agent-team.zh.md`](../../../docs/subsystems/agent-team.zh.md)，领域 README 见[`packages/experimental/agent-team/README.zh.md`](../../../packages/experimental/agent-team/README.zh.md)，模型工具 README 见[`packages/experimental/tool-agent-team/README.zh.md`](../../../packages/experimental/tool-agent-team/README.zh.md)。使用实验功能前还应阅读[`packages/experimental/AGENTS.md`](../../../packages/experimental/AGENTS.md)。
