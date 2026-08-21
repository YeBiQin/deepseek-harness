# 第 13 篇：进程沙箱与一次调用的执行边界

本篇回答：同一个 Shell Consumer 怎样在不同会话、不同模式和一次性提权重试下，得到不同的文件效果边界，而且不把平台 runner 写死在工具层。

## 本篇目标

- 能区分 `read-only`、`workspace-write` 和 `danger-full-access`。
- 能解释 per-call policy、`workspaceRoot` 和解析优先级。
- 能区分 sandbox denial 与 runner failure。
- 能从 Consumer、Service Definition、Provider 三层定位一个沙箱问题。

## 前置知识

先完成[能力缝隙与工具策略流水线](../module-5-capability-and-tools.md)和[权限预设](12-permission-presets.md)。本篇以 Shell 为 Consumer，但结论同样适用于其他需要运行进程的能力。

## 1. 三种模式只定义文件效果

`read-only` 要求后端拒绝写入；`workspace-write` 允许工作区根和后端承诺的临时区域；`danger-full-access` 绕过隔离，直接 spawn 原始 argv。网络和进程可见性不属于这套词汇，不能从“有沙箱”推断出网络隔离。

只有前两种模式进入 `ctx.sandbox.confine()`。`danger-full-access` 是 Consumer 的显式分支，而不是把一个“无限制 policy”传给 Provider。这样可以在类型和控制流上看出什么时候根本没有使用隔离后端。

## 2. policy 是每次调用解析的

```text
显式且已批准的 mode
  > session 的 sandbox/mode 事件
  > deployment 默认值
          ↓
session cwd（规范化后）作为 workspaceRoot
没有 session/cwd 时使用配置 root
          ↓
SandboxExecutionPolicy
          ↓（若不是 danger-full-access）
SandboxPolicy → ctx.sandbox.confine(argv, policy)
```

`SandboxExecutionPolicy` 总是携带绝对 `workspaceRoot` 和可选 `sessionId`，即使最终是 `danger-full-access`。调用方只解析一次完整策略，再决定绕过还是约束。Provider 不应自己猜 cwd、会话默认值或审批结果。

一次被批准的提权重试应该是带显式 mode 的新调用，不应改变 Provider 的全局状态。并发会话也因此可以同时以不同模式请求同一个 Provider。

## 3. Provider 返回的不只是 argv

`confine()` 返回 `argv`、`enforcement`、`denialSignatures` 和 `runnerFailureRules`。`enforcement` 为 `full` 时，后端声称完成了该模式的全部文件效果；`partial` 表示平台或内核只能管控承诺的一部分，要求绝对保证的 Consumer 不能把它当作 full。

Consumer 必须区分两类失败：runner failure 表示包装器在目标命令启动前失败，属于沙箱基础设施故障；denial 表示约束工作了，命令被限制规则阻止。只检查“非零退出码”会把普通命令失败、沙箱拒绝和 runner 崩溃混在一起。

Provider 还拥有平台方言：bwrap、Landlock、Seatbelt 和 Windows ACL 可能分别产生不同 stderr 签名。Consumer 应使用返回的方言，不要维护一个跨平台错误字符串并集。

## 4. 动手练习：追踪一次写文件

选择 `tool-bash` 或 `bash-sandbox` 的一次执行测试，画出四个节点：请求如何得到 mode；policy 如何得到 root；argv 何时被包装；结果如何分类。然后分别预测以下三种运行：在 read-only 下写入工作区；在 workspace-write 下写入工作区；runner 不可用。

练习的完成标准是能说出每种情况属于命令失败、denial 还是 `SANDBOX_UNAVAILABLE`，并能指出判断发生在 Consumer 还是 Provider。

## 5. 验证结果

先运行策略和核心沙箱测试：

```sh
pnpm exec vitest run packages/sandbox/sandbox/tests/vocabulary.spec.ts packages/sandbox/sandbox/tests/roots.spec.ts packages/sandbox/sandbox/tests/escalation.spec.ts packages/sandbox/sandbox-policy/tests/policy.spec.ts packages/sandbox/sandbox-policy/tests/invariant.spec.ts
```

再根据本机平台运行对应的本地后端测试；这些测试可能受平台和权限影响：

```sh
pnpm exec vitest run packages/sandbox/sandbox-local/tests/local.spec.ts packages/sandbox/sandbox-local/tests/acl-grants.spec.ts
```

预期证据是：模式和 root 的优先级稳定；提权只改变这次 policy；缺少后端不会静默透传；分类规则能区分 runner failure 与 denial。平台 e2e 测试应以当前系统能运行的后端为准。

## 常见误区

- 把 workspace-write 解释成“只能写代码文件”，它实际是文件效果范围，不是工具意图。
- 把 `partial` 当成 full，向用户承诺后端无法证明的绝对边界。
- 在 `ctx.sandbox` 不可用时直接 spawn 原 argv，形成静默无隔离。
- 用 session 的 cwd 之外的进程当前目录猜 workspaceRoot，导致多会话边界漂移。

## 权威入口与下一篇

精确词汇见[`docs/subsystems/sandbox.zh.md`](../../../docs/subsystems/sandbox.zh.md)，定义见[`packages/sandbox/sandbox/src/index.ts`](../../../packages/sandbox/sandbox/src/index.ts)，策略服务见[`packages/sandbox/sandbox-policy/src/index.ts`](../../../packages/sandbox/sandbox-policy/src/index.ts)，本地后端见[`packages/sandbox/sandbox-local`](../../../packages/sandbox/sandbox-local)。下一篇转向不会立即结束的工作：后台任务。
