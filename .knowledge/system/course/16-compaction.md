# 第 16 篇：压缩 Session Surface

本篇回答：上下文变大时，系统怎样把一段历史变成一个摘要节点，同时保持 Session Log 可回放、工具调用配对可验证、失败尝试可观察。

## 本篇目标

- 能区分 compaction 日志事件和模型 Surface 事件。
- 能解释 `start → summary → user/message replace → end` 的事务顺序与锁。
- 能判断一个区域是否保持工具调用／结果配对。
- 能区分自动压缩、手动压缩、区域压缩和工具结果剪枝。

## 前置知识

先完成[Session 重建](../module-4-session-reconstruction.md)、[Agent Turn](../module-3-agent-turn.md)和[子 Agent](15-subagents.md)。压缩是可选能力缝隙，定义、Provider 和 Consumer 分开；它不是 Agent Loop 中的一段隐式数组截断。

## 1. 日志与 Surface 的双层关系

压缩追加 `compaction/start`、`compaction/summary` 和 `compaction/end` 三种仅记日志事件。它们记录锁、摘要、被遮蔽的 seq、token 估算、Provider 和模型调用事实，但不直接进入模型 transcript。

真正改变模型 Surface 的是一个带 `surfaceOp: { op: 'replace', start, end }` 的 `user/message`。它承载摘要内容，并把原有 Surface span 替换成一个新节点。因此理解压缩必须同时看“日志发生了什么”和“模型最终看到什么”。

## 2. 一次成功压缩的顺序

```text
检查 session、范围和 tool pairing
  ↓
append compaction/start，取得日志锁
  ↓
Provider 生成摘要，记录 compaction/summary
  ↓
append user/message replacement checkpoint
  ↓
append compaction/end，释放锁
  ↓
返回 CompactionResult
```

锁覆盖整个操作，不只是模型请求。中途崩溃会留下 start 而没有匹配 end，回放可以识别这是未完成尝试，而不是错误地声称压缩成功。并发入口看到未匹配 start 时应拒绝；跨生命周期的陈旧 start 有专门的手动路径处理，不能简单删除所有 lock evidence。

`shadowedRange` 是 Surface 位置的两端，不是数值 seq 的闭区间。一次替换会追加高 seq 的摘要节点到旧位置，因此后续 Surface 可能出现 start 大于 end；真正权威的被遮蔽集合是按 Surface 顺序保存的 `shadowedSeqs`。

## 3. 三种运行路径

- `compactIfNeeded(agent, 'pressure' | 'context-overflow', signal)` 服务自动策略。pressure 遵循正常阈值；context-overflow 可以在低于普通阈值时强制寻找一个安全、平衡的缩减。
- `compactNow(agent, signal, sourceCommandId?)` 是空闲会话的手动维护。没有可用范围时返回 `null` 且不写入；预期失败以 `busy`、`cancelled`、`changed`、`summary`、`commit` 或 `persistence` 分类，并保留失败尝试的日志。
- `compactRegion(start, end, agent, signal?)` 是显式范围压缩。两端必须存在、顺序有效、属于当前 Surface 且在工具调用／结果边界上平衡。

在自动压力路径中，可选的 tool-result pruner 会先对过大的工具结果做确定性 head/middle/tail 剪枝，再重新测量；剪枝本身也追加 replacement 事件和 `compaction/prune` shadow-price 事实。

## 4. 取消、失败与恢复

摘要 Provider 必须转发调用方 signal。取消优先于普通摘要错误，但必要的清理和 `compaction/end` 仍要完成。`changed` 和 `summary` 失败应保持 Surface 不变；`commit` 可能已经发生部分变更；`persistence` 表示内存里的生命周期已闭合但 flush 失败。不要把所有异常都转成“压缩成功后继续请求”。

一个过大的单独 retained unit 或 request envelope 不能靠 Surface 压缩修复；工具配对只保护边界，不保证任意内部轮次都可压缩。先用 `toolPairingBalancedBefore/After` 读取当前 Surface，再决定范围。

## 5. 动手练习：观察一个替换节点

从一个包含用户消息、assistant 消息、tool call 和 tool result 的 Session 开始，选择一段平衡范围执行手动区域压缩。输出压缩前后的 Surface seq 顺序，并同时列出三条 compaction 事件和 replacement `user/message`。

再构造一个边界落在 tool call 与 tool result 之间的范围。预测它应在写入前失败；如果测试显示允许，先检查是否实际选择了另一段 Surface，而不是修改规则绕过配对检查。

## 6. 验证结果

运行核心压缩、工具配对和基础 Provider 测试：

```sh
pnpm exec vitest run packages/compaction/compaction/tests/compaction.spec.ts packages/compaction/compaction/tests/invariant.spec.ts packages/compaction/compaction/tests/tool-pairing.spec.ts packages/compaction/compaction-basic/tests/compaction-basic.spec.ts packages/compaction/compaction-basic/tests/manual-compaction.spec.ts
```

再运行剪枝与命令 Consumer 测试：

```sh
pnpm exec vitest run packages/compaction/compaction-tool-result-pruner/tests/tool-result-pruner.spec.ts packages/compaction/command-compact/tests/command-compact.spec.ts packages/compaction/command-compact/tests/invariant.spec.ts
```

预期证据包括：压缩事件不进入 Surface；成功替换只产生一个摘要节点；锁有成对 start/end；工具边界不平衡时拒绝；手动 no-op 不写日志；失败类别和取消语义可从日志与结果区分。

## 常见误区

- 直接截断事件数组，丢失被遮蔽 seq、摘要调用和恢复证据。
- 把 `compaction/summary` 当成模型消息，忘记真正的 Surface 变化在 replacement `user/message`。
- 用数字 seq 范围代替 Surface 位置范围。
- 在摘要失败后仍然追加一个看似成功的 end，掩盖遗留锁。
- 认为压缩能解决单个无法拆分的超大请求。

## 权威入口与下一篇

精确设计见[`docs/subsystems/compaction.zh.md`](../../../docs/subsystems/compaction.zh.md)，Service Definition 见[`packages/compaction/compaction/src/index.ts`](../../../packages/compaction/compaction/src/index.ts)，基础 Provider 见[`packages/compaction/compaction-basic`](../../../packages/compaction/compaction-basic)，工具结果剪枝见[`packages/compaction/compaction-tool-result-pruner`](../../../packages/compaction/compaction-tool-result-pruner)。下一篇在受控脚本中组合子 Agent。
