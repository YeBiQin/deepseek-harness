# 模块四：Session 与上下文重建

这是 DeepSeek Harness 深度学习的第四个模块，专门回答一个核心问题：Agent 下一次请求模型时，究竟从哪里重新得到“到目前为止发生了什么”。

本模块把 Session 当作可回放的事实账本，重点学习事件追加、模型消息投影、请求元数据折叠、恢复和分叉；工具策略流水线会在后续模块单独展开。

## 1. 学完本模块要得到什么

完成本模块后，你应该能解释为什么 Harness 不把“当前聊天数组”当作唯一上下文，区分 Session Log、`session/event` 通知、模型消息 Surface 和物理持久化后端，并能从一段事件日志推导下一次模型请求的消息历史。

你还应该能在源码中定位 `Session.append()`、`deriveMessages()`、`requestHeader()`、`requestContext()` 和 `Session.fromRestore()`，知道每个函数负责保存事实、重建视图还是连接持久化。

## 2. 先用“一本不能撕页的工作账本”建立直觉

把 Session 想成项目经理和团队共同维护的一本工作账本。每次接单、模型输出、工具调用、工具结果和请求配置都会追加记录；任何人想知道“现在进展到哪里”，都从账本重算，而不是偷偷维护另一份可能过期的聊天数组。

这本账本上有三类信息：发生过什么的事实、模型下一次应该看到的对话、以及帮助系统恢复和观测的元数据。它们都在同一条有序日志里，但用途不同。

```text
Session Event Log
  ├─ 运行边界：turn/start、step/start、step/end、turn/end
  ├─ 模型内容：user/message、assistant/chunk、assistant/message
  ├─ 工具内容：tool/call、tool/result
  ├─ 请求元数据：request/header、request/context
  └─ 队列与系统事实：agent/inbox/spliced、todo/write 等
```

关键原则是：模型真正看到的内容必须能从 Session Log 重建。否则进程重启、会话恢复、UI 回放和测试快照可能各自看到不同的故事。

## 3. 四个东西不要混为一谈

| 概念 | 白话理解 | 主要用途 |
|---|---|---|
| Session Log | 不能撕页的事实账本 | 保存可恢复的事件和顺序 |
| `session/event` | 账本新增一页时的广播 | 通知 UI、遥测、持久化和其他 Consumer |
| Model Message Surface | 从账本挑出的模型对话页 | 重建下一次 LLM 请求的 `messages` |
| JSONL / SQLite | 账本的物理存放方式 | 把事件和 Header 写入磁盘或数据库 |

`session/event` 是实时通知，不等于已经写入磁盘；`deriveMessages()` 是从内存中的逻辑日志推导消息，不等于直接读取 JSONL；JSONL 和 SQLite 是可替换的 Provider，不应改变核心 Session 的事件语义。

## 4. Session 的基本不变量

打开 [`../../packages/core/session/src/types.ts`](../../packages/core/session/src/types.ts:230)，先读 `SessionEventMap` 上方的总说明，再看每类事件的类型定义。

### 4.1 事件是追加式且有连续序号

每个事件有 `type`、`seq`、`time` 和经过验证的 `data`。`seq` 从零开始连续递增；即使是原始流式 Chunk，也不能跳号，因为持久化、来源引用和 Surface 替换都依赖这个顺序。

### 4.2 事件数据是可持久化的 JSON

`Session.append()` 会在事件进入日志前检查数据和 Surface 元数据是否是无损 JSON，并冻结快照。调用者之后再修改原始对象，不会改变已经记录的历史。

这意味着 Session 不是任意 JavaScript 对象的临时总线。函数、BigInt、循环引用、Map/Set 等值不能直接成为持久化事件数据；跨进程和恢复边界必须使用项目允许的 JSON 值。

### 4.3 日志和事件快照不可被调用者改写

`session.events` 返回不可变快照；后续追加会生成新的快照，已经交给调用者的数组不会悄悄变长。事件内部数据也被冻结，防止某个观察者把历史改写后影响另一个观察者或下一次请求。

这些不是“代码风格”，而是为了让同一份日志在模型、UI、持久化和测试中保持一致。

## 5. `Session.append()`：所有事实的入口

阅读 [`../../packages/core/session/src/index.ts`](../../packages/core/session/src/index.ts:604) 的 `Session.append()`，按下面顺序观察。

```text
接收类型和数据
  ↓
复制并验证 JSON 数据和 Surface 元数据
  ↓
分配连续 seq、记录 time、冻结事件
  ↓
验证 Surface 状态转换
  ↓
把事件推入内存日志
  ↓
同步通知 session/event 观察者
  ↓
返回已经进入日志的事件
```

`append()` 的提交点在事件进入 `log` 之后。`session/event` 观察者可以观察新事件，但观察者失败不会把已经提交的事件从历史中抹掉；持久化插件则通过自己的生命周期和 `session/flush` 机制把缓冲事件写到物理后端。

Agent Loop 的 `turn()`、`step()`、`buildRequest()` 和工具调度器都通过这个入口记录事实，这就是为什么模块三看到的 Turn、Assistant 和 Tool 事件能够被统一重放。

## 6. 哪些事件会变成模型消息

打开 [`../../packages/core/session/src/types.ts`](../../packages/core/session/src/types.ts:342)，查看 `SurfaceEventType`。当前实现中，只有下面三类事件有资格进入模型可见的消息 Surface：

| 事件 | 投影结果 | 是否直接进入 `deriveMessages()` |
|---|---|---|
| `user/message` | User Message | 是 |
| `assistant/message` | Assistant Message | 是，空内容消息除外 |
| `tool/result` | Tool Result Message | 是 |

`turn/start`、`step/start`、`step/end`、`turn/end` 是边界事实；`assistant/chunk` 是流式过程事实；`tool/call` 记录模型发出的调用；`request/header` 和 `request/context` 是请求元数据。它们都很重要，但不会因为存在于日志中就自动变成模型对话消息。

## 7. Surface：账本中的“模型可见页码”

可以把 Surface 想成账本上专门贴给模型看的页签。普通消息用 `surfaceOp: 'append'` 加到末尾；压缩或其他重写操作可以用 `surfaceOp: { op: 'replace', start, end }` 替换一段旧的模型可见内容，并通过 `sourceEventSeqs` 指出它来源于哪些更早事件。

阅读 [`../../packages/core/session/src/surface.ts`](../../packages/core/session/src/surface.ts:70) 的 `deriveEventMessage()`：它把 `user/message` 原样投影为用户消息，把 `assistant/message` 投影为 Assistant Message，把 `tool/result` 投影为 Tool Result Message，其他事件返回 `null`。

再阅读 [`foldSurface()`](../../packages/core/session/src/surface.ts:387) 和 `SurfaceManager`，理解它如何根据每个事件的 Surface 操作维护当前模型可见节点顺序。Surface 是“哪些事件参与模型历史”的唯一入口，不能在另一个地方再凭经验拼一份聊天数组。

## 8. `deriveMessages()`：每次请求前重新算历史

阅读 [`../../packages/core/session/src/index.ts`](../../packages/core/session/src/index.ts:701) 的缓存字段和 [`deriveMessages()`](../../packages/core/session/src/index.ts:726)。它的核心步骤是：取得当前 Surface 节点，按节点序号找到原始事件，调用 `deriveEventMessage()`，跳过不能产生消息的节点，返回一份新的消息数组。

它有缓存，但缓存不是第二个事实来源。新增事件只会让缓存继续投影新的 Surface 节点；发生 Surface replace 时，缓存按 replacement generation 重建；原始日志始终是权威来源。

在模块三的 `step()` 中，`buildRequest()` 调用 `this.session.deriveMessages()`；这就把“模型下一次看到什么”与“Session 当前日志是什么”连接起来了。

```text
Session Log
  → SurfaceManager.nodes
  → deriveEventMessage()
  → session.deriveMessages()
  → GenerateOptions.messages
  → LLM Adapter
```

## 9. 为什么要同时记录 Chunk 和完整 Message

`assistant/chunk` 保存流式输出到达的过程，适合实时 UI、崩溃前缀保留和精确回放；`assistant/message` 保存已经组装完成的一步 Assistant Message，适合稳定地加入模型历史。

它们不是重复记录：Chunk 是过程，Message 是经过组装的事实结果。`deriveEventMessage()` 明确忽略 Chunk，所以模型历史不会把每个流片段重复当成一条 Assistant 消息。

取消发生在模型流中间时，Agent Loop 可能把已经收到的可见内容作为带 `interrupted: true` 的 `assistant/message` 追加；如果没有收到可见内容，则不会凭空制造空的模型消息。

## 10. 请求元数据：Header 和 Context 不是聊天历史

打开 [`../../packages/core/session/src/types.ts`](../../packages/core/session/src/types.ts:302)，区分 `request/header` 和 `request/context`。

### 10.1 `request/header`：下一次请求的完整配置快照

它记录 Provider、Model、系统提示、工具 Schema 和其他模型调用配置，并附带 `initial`、`resume` 或 `change` 原因。它不进入 `deriveMessages()`，但恢复 Agent 时可以折叠出上一次请求配置，避免模型请求脱离原来的运行环境。

阅读 [`Session.requestHeader()`](../../packages/core/session/src/index.ts:662) 和 [`../../packages/core/session/src/request-header.ts`](../../packages/core/session/src/request-header.ts)，观察它如何只折叠新增的 Header 事件，而不是每一步从零扫描整本账。

### 10.2 `request/context`：解析后的路由和容量信息

`request/context` 记录 Provider、Model 和上下文窗口等已解析环境信息。它用于恢复和诊断，不参与消息历史和 Header 相等性判断；不要把它误认为模型收到的 `messages`。

阅读 [`Session.requestContext()`](../../packages/core/session/src/index.ts:682)，看它如何保存最近一次上下文信息。

## 11. `session/event` 和物理持久化的关系

Session 本身负责内存中的逻辑日志和事件语义；通过 [`SessionStore.flush()`](../../packages/core/session/src/index.ts:1009) 触发持久化检查点，具体写入由挂载的 `SessionPersistence` Provider 完成。

JSONL Provider 见 [`../../packages/session/session-persistence-jsonl/src/index.ts`](../../packages/session/session-persistence-jsonl/src/index.ts:115)，SQLite Provider 见 [`../../packages/session/session-persistence-sqlite/src/index.ts`](../../packages/session/session-persistence-sqlite/src/index.ts:49)。两者都依赖 `sessions`，但一个写文件、一个写数据库；上层 `Session.append()`、`deriveMessages()` 和恢复语义不应因此分叉。

一个常见误区是看到 `session/event` 就认为“磁盘已经安全”。当前代码中 `append()` 的热路径不会等待 I/O；需要确认物理持久化结果时，应沿着 `SessionStore.flush()` 和具体 Provider 的 `append()`/`load()` 继续阅读。

## 12. 恢复、Replay 和 Fork

### 12.1 Replay / Restore

打开 [`Session.fromRestore()`](../../packages/core/session/src/index.ts:487) 及其构造逻辑。恢复不是把一个普通对象塞回内存，而是重新验证 Header、事件 Envelope、连续序号、JSON 值和 Surface 转换，再冻结恢复后的对象。

恢复后的 Session 应该能够得到和原 Session 一致的 `deriveMessages()`；这就是“从日志重建”比“保存一份当前聊天数组”更可靠的原因。

### 12.2 Fork：从某个日志边界复制工作账本

阅读 [`SessionStore.fork()`](../../packages/core/session/src/index.ts:1081) 和 [`../../packages/core/session/tests/fork.spec.ts`](../../packages/core/session/tests/fork.spec.ts:125)。Fork 不是复制当前内存数组后随意继续，而是选择一个合法的连续事件边界，复制可验证的事件前缀，并拒绝切在未关闭 Turn 中间的边界。

这让“从某个历史节点重新尝试”成为可解释的事件操作，而不是复制一份已经失去来源关系的聊天文本。

### 12.3 崩溃尾部修复

如果进程在 Turn 中间退出，日志可能只有已经提交的前缀。阅读 [`../../packages/core/session/src/repair.ts`](../../packages/core/session/src/repair.ts:19) 的 `interruptedTurnClosers()`，它扫描未闭合的 Turn/Step，并生成确定性的关闭事件；工具调用的来源引用也必须保持可回放。

先把“修复日志边界”与“重试模型请求”分开理解：Repair 负责让事件序列重新闭合，是否重试是 Agent/Provider 侧的策略。

## 13. 源码阅读顺序和观察卡片

按下面顺序阅读，不要先钻进 JSONL 的压缩细节：

1. 阅读 [`../../packages/core/session/src/types.ts`](../../packages/core/session/src/types.ts:230)，列出事件类型、是否产生模型消息、是否带 Surface 元数据。
2. 阅读 [`Session.append()`](../../packages/core/session/src/index.ts:604)，画出“验证 → 追加 → 通知”的提交顺序。
3. 阅读 [`deriveEventMessage()`](../../packages/core/session/src/surface.ts:83) 和 [`foldSurface()`](../../packages/core/session/src/surface.ts:387)，确认模型历史的唯一投影路径。
4. 阅读 [`Session.deriveMessages()`](../../packages/core/session/src/index.ts:726)，理解 Surface 节点如何变成 `Message[]`。
5. 阅读 [`requestHeader()`](../../packages/core/session/src/index.ts:670) 和 [`requestContext()`](../../packages/core/session/src/index.ts:691)，区分请求元数据与对话内容。
6. 最后阅读 `SessionStore.flush()`、JSONL/SQLite Provider、`fromRestore()`、`fork()` 和 `repair.ts`。

建议为每个事件填写这张卡片：它记录了什么事实，是否模型可见，是否进入 Surface，是否需要 `sourceEventSeqs`，谁追加它，恢复时谁读取它。

## 14. 最小验证：从测试证明“可重建”

先阅读 [`../../packages/core/session/tests/session.spec.ts`](../../packages/core/session/tests/session.spec.ts:1)，确认简单消息追加、Seed Replay 和 JSON 校验；再阅读 [`../../packages/core/session/tests/surface.spec.ts`](../../packages/core/session/tests/surface.spec.ts:705)，观察 Surface append/replace 如何影响 `deriveMessages()`。

接着阅读 [`../../packages/core/session/tests/derived-cache.spec.ts`](../../packages/core/session/tests/derived-cache.spec.ts:14)，确认缓存只是加速投影而不是替代日志；最后阅读 [`../../packages/core/session/tests/fork.spec.ts`](../../packages/core/session/tests/fork.spec.ts:125) 和 [`../../packages/core/session/tests/repair.spec.ts`](../../packages/core/session/tests/repair.spec.ts:229)，分别验证分叉和异常尾部处理。

可以运行下面的聚焦测试：

```sh
pnpm vitest run packages/core/session/tests/session.spec.ts packages/core/session/tests/surface.spec.ts packages/core/session/tests/derived-cache.spec.ts packages/core/session/tests/fork.spec.ts packages/core/session/tests/repair.spec.ts
```

## 15. 动手练习：把一段日志翻译成模型上下文

### 练习 A：事件分类表

从一个 Agent Loop 测试中取出一段 Session 事件，给每条记录标注“边界、模型消息、工具事实、请求元数据或系统队列”，然后预测哪些事件会进入 `deriveMessages()`。

### 练习 B：手工重建消息

只看 `user/message`、`assistant/message` 和 `tool/result`，按事件顺序写出模型下一次请求的 `messages`；再用 `session.deriveMessages()` 对照，解释差异是否来自空 Assistant Message 或 Surface replace。

### 练习 C：区分实时通知和持久化

监听 `session/event`，在观察者里打印事件序号；然后阅读 `SessionStore.flush()` 和 JSONL Provider，写出“事件已经进入内存日志”和“事件已经经过持久化检查点”之间的区别。

## 16. 常见误区

- 把 Session 当成一个可变聊天数组：Session 的权威数据是有序事件日志，消息是投影。
- 把所有事件都当成模型消息：只有 Surface 事件按投影规则进入 `deriveMessages()`。
- 把 Chunk 和完整 Message 当成重复数据：一个记录流式过程，一个记录可用于历史的组装结果。
- 把 `request/header` 当成对话内容：它是请求配置快照，不进入模型消息 Surface。
- 把 `session/event` 当成磁盘写入完成：它是实时通知，物理持久化要沿 `flush()` 和 Provider 验证。
- 直接修改 `session.events` 或事件对象：公开快照和事件数据都被冻结，应该通过 `append()` 产生新事实。
- 只修复内存状态不修复日志：恢复、回放和另一个进程只看持久化事实，不能依赖某个进程里的临时变量。

## 17. 自测与参考答案

可以用自己的话思考：为什么 `assistant/chunk` 会写进 Session Log，却不会直接出现在 `session.deriveMessages()` 的结果中？如果只保存 `assistant/message`，又会损失什么？

参考答案：`assistant/chunk` 记录流式生成过程，属于可观察的中间事实；`deriveMessages()` 需要的是按 Surface 规则整理后的稳定消息，因此使用 `assistant/message` 等聚合结果。只保存最终消息会丢失流式回放、增量观察、诊断和部分中断过程信息。

读完本模块后，继续模块五的能力缝隙与工具扩展；事件分类和手工重建练习可以按需完成。
