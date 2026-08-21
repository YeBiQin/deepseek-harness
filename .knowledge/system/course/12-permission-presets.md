# 第 12 篇：权限预设与双旋钮状态

本篇回答：客户端为什么可以显示一个“权限”选择器，但运行时仍然把审批和沙箱当成两个独立的强制执行开关。

## 本篇目标

- 能解释预设表如何映射 `sandbox/mode` 与 `approval/policy`。
- 能区分声明的预设、当前生效预设和派生的 `custom`。
- 能按事件顺序解释一次预设切换怎样被回放。
- 能验证重复选择当前预设不会制造多余日志。

## 前置知识

先完成[用户审批](11-approval-and-permissions.md)，并阅读[进程沙箱](13-sandbox-and-execution.md)中三种模式的定义。预设层不执行命令，也不显示审批 UI；它只是一个把两个 knob 组合给客户端的可选能力。

## 1. 预设表是什么

默认表包含 `workspace-write + ask` 和 `danger-full-access + never`。每一项还可以提供展示名称和描述。`custom` 不应写进表：它是当前两个旋钮的实际值无法匹配任何表项时，由服务派生出的显示状态。

```text
预设名称
  ↓ resolve()
{ sandbox: SandboxMode, approval: ApprovalPolicy }
  ↓ set(session, name)
permission/preset → sandbox/mode（如有变化）→ approval/policy（如有变化）
```

预设服务要求同时存在能施加隔离的 `ctx.shell` 和 `ctx.approval`。加载时如果配置了保留名 `custom`，或 Shell 没有 `sandboxMode` 能力事实，应该直接失败；不能等到用户真正切换时才悄悄降级。

## 2. 当前值为什么需要折叠

`current(events)` 读取的是两个旋钮的有效状态，而不是最后一条 `permission/preset` 的名字。它先折叠会话中的沙箱和审批覆盖，再和预设表匹配。若多个表项有相同组合，仍匹配的最后一次预设选择优先；否则按表声明顺序取第一个；完全不匹配就返回 `custom`。

这样做解决了两个问题：重放时强制执行读各自的规范事件，不需要依赖一个额外的缓存；两个预设可以共享组合，又能通过 `permission/preset` 保留用户最后选择的是哪一个名字。

## 3. 切换的持久化顺序

`set(session, name)` 先解析名字并判断它是否已经是当前生效预设。当前值相同就什么也不写。值发生变化时先追加 `permission/preset`，然后通过沙箱和审批各自的 setter 写入真正变化的 knob。选择事件是用户意图；真正的模型可见和执行后果由两个 knob 的事件负责。

一个重要细节是事件顺序：选择事件必须先于 `sandbox/mode` 或 `approval/policy`，这样回放可以保留用户选择事实，同时仍由各自的拥有者负责语义折叠。不要在预设服务里复制另一套 sandbox 或 approval 状态机。

## 4. 动手练习：构造 `custom`

给配置增加一个只改变审批策略的临时会话覆盖，例如保留 `workspace-write`，把审批切到 `never`，而预设表中不提供这个组合。观察选择器的选项仍列出声明预设，并在当前值处追加 `custom`；不要把 `custom` 当成 `set()` 的目标。

然后恢复到一个已声明的预设，比较事件序列。记录哪些事件由 `permission-presets` 写入，哪些事件由 `sandbox-policy` 与 `user-approval` 写入。

## 5. 验证结果

运行预设层的服务、投影和不变量测试：

```sh
pnpm exec vitest run packages/interaction/permission-presets/tests/permission-presets.spec.ts packages/interaction/permission-presets/tests/projection.spec.ts packages/interaction/permission-presets/tests/invariant.spec.ts
```

预期结果包括：默认组合可解析；`custom` 只作为派生值出现；未知名字失败；重复选择不追加事件；切换时选择事件先写；两个 knob 的事件只在实际变化时写入。

## 常见误区

- 认为预设本身就是强制执行器，绕过各自的规范 setter。
- 把 `custom` 写入预设表，造成“派生状态”与“可切换目标”混淆。
- 只保存最后选择的名字，不保存 knob 事件，导致回放无法知道实际执行策略。
- 用预设服务的默认值覆盖会话里已经记录的沙箱或审批选择。

## 权威入口与下一篇

精确规则见[`docs/subsystems/permission-presets.zh.md`](../../../docs/subsystems/permission-presets.zh.md)，实现见[`packages/interaction/permission-presets/src/index.ts`](../../../packages/interaction/permission-presets/src/index.ts)，测试见[`packages/interaction/permission-presets/tests/permission-presets.spec.ts`](../../../packages/interaction/permission-presets/tests/permission-presets.spec.ts)。下一篇追踪沙箱如何把生效模式解析为一次具体的受限 argv。
