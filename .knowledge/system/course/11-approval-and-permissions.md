# 第 11 篇：用户审批与权限决定

本篇回答一个具体问题：工具已经准备执行时，系统怎样询问“这一次操作可以继续吗”，又怎样保证没有应答者、应答者出错或请求被取消时不会误放行。

## 本篇目标

- 能区分审批结果、审批策略和沙箱模式。
- 能从 `ctx.approval.request()` 追踪到 waterfall、审计日志和调用方结果。
- 能解释为什么 `unavailable`、`rejected` 和 `cancelled` 都必须被调用方视为拒绝。
- 能用测试验证 `never` 策略不会触发任何应答者。

## 前置知识

先完成[插件生命周期](../module-2-plugin-lifecycle.md)、[Session 重建](../module-4-session-reconstruction.md)和[工具策略流水线](../module-5-capability-and-tools.md)。本篇不要求先学 UI；审批服务本身只定义请求、结果和分发，不拥有某一种界面。

## 1. 审批不是权限本身

审批回答的是一次具体工具操作能否继续。它有四个闭合结果：`allowed-once`、`rejected`、`cancelled`、`unavailable`。只有 `allowed-once` 是授权，而且只授权当前询问的那一次操作；调用方不能把它升级成永久许可。

沙箱模式回答进程可以对文件系统产生什么效果，审批策略回答是否要先问人。两者可以组合，但拥有者不同：审批由 `ctx.approval` 处理，沙箱由 `ctx.sandboxPolicy` 与 `ctx.sandbox` 处理，调用方负责按自己的策略流水线同时使用它们。

## 2. 一次请求经过什么路径

```text
工具或策略层构造 ApprovalRequest
  ↓
ctx.approval.request(req)
  ↓
写入 approval/asked
  ↓
ask：按 approval/request waterfall 找应答者；never：直接 rejected
  ↓
取消、缺失、异常或非法结果 → unavailable/cancelled/rejected
  ↓
写入匹配的 approval/decided
  ↓
调用方只有在 allowed-once 时继续
```

请求携带精确的 `agent`、`toolName`、可选 `callId`、原因和 `AbortSignal`。它故意不重复工具参数：界面可以用 `callId` 关联已经展示的工具调用，避免审批提示和工具卡片出现两份会漂移的参数。

`approval/asked` 与 `approval/decided` 是仅记日志的审计事件，不进入模型 transcript。审批对模型可见的后果来自调用方写入的工具结果和运行时上下文快照，而不是让模型直接读取审计记录。

## 3. `ask`、`never` 与 fail-closed

`ask` 把请求交给组合后的 waterfall。应答者负责该请求时返回一个合法结果，否则调用 `next()`；链末默认产生 `unavailable`。没有 UI、自动化桥接未提供答案、应答者抛异常，都会走这个关闭路径。

`never` 在 waterfall 之前直接返回 `rejected`，不会运行任何应答者。因此后注册的 listener、UI 或 ACP 桥接都不能绕过无人值守策略。会话的覆盖值来自最后一条 `approval/policy` 事件，没有覆盖时使用服务配置。

审批请求要求处于打开的 Turn 内，因为审计对必须处在可提交和可回放的日志边界中。空闲时请求会在追加前失败；如果审计 append 在提交前失败，服务不会返回一个“没有被记录的决定”。

## 4. 动手练习：写一个最小应答者

在一个本地插件中注册 `approval/request` listener，只允许工具名为 `read_file` 的请求，其他请求调用 `next()`。不要让 listener 直接执行工具，也不要把 `ask` 策略改成全局状态。

练习完成后回答：同一个请求被取消时，listener 还能晚到返回 `allowed-once` 吗？如果能，服务应如何处理这个晚到的结果？正确答案是取消会让请求完成为 `cancelled`，晚到答案被丢弃。

## 5. 验证结果

先运行审批服务的核心测试：

```sh
pnpm exec vitest run packages/interaction/user-approval/tests/approval.spec.ts packages/interaction/user-approval/tests/invariant.spec.ts
```

应观察到测试通过，并覆盖策略折叠、审计成对、取消、缺失应答者和失败关闭语义。再搜索调用方如何消费结果：

```sh
rg -n "allowed-once|unavailable|approval/request|approval/asked|approval/decided" packages
```

验证标准不是“发现了审批代码”，而是能够指出：调用方只在 `allowed-once` 分支继续；其他三个结果都会阻止当前操作。

## 常见误区

- 把 `unavailable` 当成“暂时没回答，稍后自动重试”，这会把 fail-closed 变成隐式重试。
- 把审批事件当成模型消息，导致审计事实污染 transcript。
- 让 `never` 只在 UI 层隐藏按钮，忘记服务内部必须在 waterfall 前拒绝。
- 在工具参数之外再复制一份审批参数，最终 UI 展示的对象和真实调用可能不一致。

## 权威入口与下一篇

精确词汇见[`docs/subsystems/approval.zh.md`](../../../docs/subsystems/approval.zh.md)，服务实现见[`packages/interaction/user-approval/src/index.ts`](../../../packages/interaction/user-approval/src/index.ts)，审批策略测试见[`packages/interaction/user-approval/tests/approval.spec.ts`](../../../packages/interaction/user-approval/tests/approval.spec.ts)。下一篇把审批策略和沙箱模式组合成用户可选择的权限预设。
