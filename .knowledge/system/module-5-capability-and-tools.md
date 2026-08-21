# 模块五：能力缝隙与工具扩展

这是 DeepSeek Harness 深度学习的第五个模块，专门回答两个问题：为什么上层 Agent 不需要知道文件和模型到底在哪里运行，以及一次工具调用如何经过策略、执行、结果整理和 Session 回写。

本模块以前面的 Cordis、Agent Turn 和 Session 知识为前置：插件负责装配，Agent Loop 负责推进，Session 负责记录；现在学习能力接口如何让实现可以替换，以及工具如何在不污染核心循环的情况下扩展。

## 1. 学完本模块要得到什么

完成本模块后，你应该能用 Service Definition → Provider → Consumer 三层方法阅读 LLM、文件系统和 Shell，并能画出 `Tool Call → tools/pre-execute → tools/execute → tools/post-execute → tools/result → tool/result` 的完整路径。

你还应该能写出一个最小模型工具，解释它的 Schema、规范返回值、模型可见渲染和 UI 展示为什么要分开，并知道策略应该放在哪个扩展点。

## 2. 先把能力缝隙想成“标准插座”

把 Service Definition 想成墙上的标准插座，Provider 是不同品牌的电源设备，Consumer 是使用电力的电器。电器只关心插头规格，不关心电来自本地电网、沙箱电池还是远程机房。

在 Harness 中，Service Definition 规定稳定的方法和数据语义，Provider 把这些方法接到具体环境，Consumer 使用 Service 完成功能。只要三者遵守同一接口，就能替换执行环境而不重写上层 Agent Loop 或模型工具。

```text
Service Definition：插座标准
  ↓
Service Provider：本机 / 沙箱 / E2B / DeepSeek 等具体实现
  ↓
Consumer：工具、Agent Loop、策略插件和入口
```

这里的“缝隙”不是缺口，而是有意留下的替换位置。它让“能力是什么”和“能力在哪里执行”分离。

## 3. 三层阅读法：Definition → Provider → Consumer

每读一个能力，固定回答三组问题：接口承诺什么，默认实现如何兑现，谁在消费它。

| 层次 | 白话问题 | 代码中常见形式 |
|---|---|---|
| Service Definition | 这个能力对外保证什么 | `Service` 子类、抽象方法、类型和事件 |
| Service Provider | 这些方法实际在哪里执行 | 本地、沙箱、远程或第三方适配器插件 |
| Consumer | 谁调用这个能力并把它变成产品行为 | Agent Loop、模型工具、策略和入口 |

不要从 Consumer 反推一个 Provider 的内部细节。先读 Definition，确认调用者可以依赖的稳定语义，再读 Provider 的特殊限制，最后读 Consumer 如何把能力暴露给模型或用户。

## 4. 文件系统：同一套工具，不同执行世界

### 4.1 Definition：`FileSystem`

阅读 [`../../packages/fs/fs/src/index.ts`](../../packages/fs/fs/src/index.ts:80) 的 `FileSystem`。它以 `ctx.fs` 提供路径解析、稳定目标身份、进程路径、文件状态和读写编辑等能力；它不要求 Consumer 知道文件是在宿主机、沙箱还是远程执行环境。

这里的重点不是记住每个抽象方法，而是识别它的稳定语义：路径要解析成 Provider 拥有的目标，目标身份要能跨别名保持一致，读写和编辑要遵守 Provider 的一致性规则。

### 4.2 Provider：本地或受限环境

可以对照 [`../../packages/fs/fs-local/src/index.ts`](../../packages/fs/fs-local/src/index.ts) 和 [`../../packages/fs/fs-sandbox/src/index.ts`](../../packages/fs/fs-sandbox/src/index.ts)。它们都实现 `ctx.fs` 的能力，但执行世界、沙箱模式和安全限制不同。

Provider 可以报告 `sandboxMode` 等能力事实；Consumer 根据这些事实决定是否展示升级字段、是否需要审批，而不是假设所有部署都有相同的安全能力。

### 4.3 Consumer：`tool-fs`

阅读 [`../../packages/fs/tool-fs/src/index.ts`](../../packages/fs/tool-fs/src/index.ts:1)。它声明需要 `tools`、`fs` 和 `systemPrompt`，然后注册 `read`、`write`、`edit` 等模型工具；它拥有参数 Schema、输出窗口、格式化、观察事件和工具注册，但不拥有具体文件读写实现。

因此，换 `fs-local` 为沙箱 Provider 时，模型仍然看到相同的文件工具名字和参数契约，Agent Loop 也不需要知道文件实际落在哪里。

## 5. LLM：抽象流式服务和 DeepSeek Provider

### 5.1 Definition：`LlmRuntime`

阅读 [`../../packages/llm/llm/src/index.ts`](../../packages/llm/llm/src/index.ts:280) 的 `LlmRuntime`。它以 `ctx.llm` 管理 Provider 路由、适配器注册、模型调用准备和流式输出，并通过 `llm/stream` 提供可插入的 around 扩展点。

Agent Loop 只需要提交 `GenerateOptions` 给 `ctx.llm.stream()`；它不应该直接认识 HTTP 请求、DeepSeek SSE 格式或某个 SDK 的错误类型。

### 5.2 Provider：`llm-deepseek`

阅读 [`../../packages/llm/llm-deepseek/src/index.ts`](../../packages/llm/llm-deepseek/src/index.ts:43) 的 `inject = ['llm']` 和 [`apply()`](../../packages/llm/llm-deepseek/src/index.ts:226)。这个插件解析配置和凭证，创建 DeepSeek 适配器，并把 `deepseek-official` 路由注册到 `ctx.llm`。

这就是模块二“不要在 Consumer 里直接 new Provider”的具体例子：Agent Loop 依赖抽象的 `llm`，Provider 负责把外部协议翻译成统一的 Chunk 和失败语义。

### 5.3 Consumer：Agent Loop

模块三的 [`buildRequest()`](../../packages/core/agent-loop/src/agent.ts:426) 构造统一请求，[`step()`](../../packages/core/agent-loop/src/agent.ts:332) 消费 `ctx.llm.stream()`。它关心请求边界、Session 事件和取消信号，不关心 DeepSeek 的网络细节。

## 6. 工具不是一个 `execute()` 函数

一个模型工具至少有四张“身份证”，不要只读执行函数。

| 工具组成 | 服务谁 | 典型代码 |
|---|---|---|
| 名称、描述、参数 Schema | 模型决定是否调用以及传什么参数 | `name`、`description`、`parameters` |
| 规范输出 Schema | 程序和 Code Mode 获得稳定结果 | `output.schema` |
| 执行函数 | 真正完成能力动作 | `execute(args, exec)` |
| 模型可见内容 | 把规范值翻译成模型可理解的结果 | `output.render(args, value)` |
| UI 展示投影 | 把调用和结果变成卡片或 Diff | `presentCall`、`presentResult`、`presentationMeta` |

先阅读[开发教程第 2 篇](develop-study/02-build-a-tool.md)中的 `greet` 例子，建立 `parameters`、`output` 和 `execute` 的关系，再看官方教程 [`../../docs/user/develop/basic/tool.zh.md`](../../docs/user/develop/basic/tool.zh.md) 和 [`../../packages/core/tools/src/schema.ts`](../../packages/core/tools/src/schema.ts:545) 的 `defineTool()` 实现。

## 7. 一个最小工具从注册到模型调用

```text
工具插件 apply(ctx)
  ↓ ctx.tools.register(defineTool(...))
ToolRuntime 保存定义并返回 disposer
  ↓ schemas()
System Prompt 把 name/description/parameters 提供给模型
  ↓ 模型返回 Tool Call
Agent Loop 把 Tool Call 交给 ToolRuntime.execute()
  ↓
策略流水线 → execute(args, exec) → 规范结果
  ↓
Agent Loop 追加 tool/result，并把结果放进下一步上下文
```

注册动作由 Effect 管理。阅读 [`ToolRuntime.register()`](../../packages/core/tools/src/index.ts:1037)，注意它校验输出 Schema，然后通过 `this.layers.effect()` 安装定义；插件 Fiber 卸载时，工具注册随 disposer 撤销。

## 8. 工具策略流水线：像机场过检和登机

把一次工具调用想成旅客过机场：`pre-execute` 是安检和准入，`execute` 是登机和飞行，`post-execute` 是落地后的处理，`result` 是把最终结果广播给观察者。

```text
Tool Call
  ↓
createExecution：解析并冻结身份与参数
  ↓
tools/pre-execute：allow / deny / ask
  ↓
approval（如果策略要求人工确认）
  ↓
guard：最终单调拒绝
  ↓
tools/execute：around wrapper + 工具主体
  ↓
tools/post-execute：接受、替换、阻止或补充上下文
  ↓
规范化、冻结、输出渲染
  ↓
tools/result：观察最终结果
```

Agent Loop 在这条流水线外还会调用 `executionMode()` 决定多个 Tool Call 是串行还是可并行；真正的每个调用仍进入同一个 ToolRuntime 策略流程。

### 8.1 `tools/pre-execute`：允许、拒绝或询问

阅读 [`packages/core/tools/src/index.ts`](../../packages/core/tools/src/index.ts:142) 的事件声明和 [`prepareExecution()`](../../packages/core/tools/src/index.ts:1463)。监听器可以返回 allow、deny 或 ask；只做观察或包装时要调用 `next()`，策略插件接管决定时才直接返回。

异步门禁要观察 `exec.signal`。审批能力不可用时，ask 不应悄悄变成 allow，而是按当前契约失败关闭为拒绝。

### 8.2 `ctx.tools.guard()`：最后一道单调拒绝

阅读 [`guard()`](../../packages/core/tools/src/index.ts:1100)。Guard 在可扩展的 `pre-execute` 之后运行，只能返回拒绝理由或 `undefined`，不能返回“强制允许”。因此，一个 Guard 拒绝后，后面的监听器不能通过顺序竞争把它重新放行。

Guard 适合部署或作用域拥有的最终禁止条件；需要询问用户、改变审批或组合多种策略时，使用 `tools/pre-execute`。

### 8.3 `tools/execute`：包裹真正执行

阅读 [`dispatchScheduledExecution()`](../../packages/core/tools/src/index.ts:1569) 和 [`dispatchToolBody()`](../../packages/core/tools/src/index.ts:1527)。`tools/execute` 是 around waterfall，适合统一增加超时、重试、指标或信号包装；真正的工具主体随后执行。

工具收到的 `exec` 身份字段和参数是受保护的，around wrapper 只能在契约允许的范围内替换并恢复执行信号。工具主体必须返回 `output.schema` 声明的规范 JSON 值，并遵守 `exec.signal`。

### 8.4 `tools/post-execute`：处理已经得到的结果

阅读 [`postExecute()`](../../packages/core/tools/src/index.ts:1731)。监听器可以接受原结果、替换模型可见内容、替换成功值、阻止结果，或附加下一步模型上下文。

这里要区分“程序拿到的规范值”和“模型看到的内容”：内容替换不一定改变程序化值；如果是保密或策略阻断，则可以把结果变成错误并只暴露反馈。

### 8.5 `tools/result`：只观察最终规范结果

阅读 [`notifyResult()`](../../packages/core/tools/src/index.ts:1656) 和事件声明。`tools/result` 在最终结果冻结后触发，监听器失败会被包含，不能再修改本次调用结果。

它适合遥测、审计、UI 更新和调试日志；不要把需要改变执行决定的逻辑放到这里，因为这个阶段已经过了策略和结果提交点。

## 9. 模型可见、程序可见和 UI 可见是三条不同通道

工具设计中最容易混乱的是“返回什么”。当前代码把三种消费者分开：

```text
execute → canonical value
  ├─ output.render → 模型看到的内容
  ├─ output.presentationMeta → 可持久化的 UI 辅助事实
  └─ presentCall / presentResult → UI 卡片和 Diff
```

`ToolRuntime.schemas()` 只投影模型需要的 `name`、`description` 和 `parameters`，不会把执行回调、超时元数据或 UI 方法暴露给模型，见 [`schemas()`](../../packages/core/tools/src/index.ts:1228)。

UI 展示函数必须是只依赖参数和结果的纯函数，因为它既会在实时执行时运行，也会在 Session Log 回放时运行；不要在 `presentCall()` 里读文件、读 Session、看时间或生成随机 ID。

文件编辑工具的 Diff 和 Shell 工具的 Terminal 卡片，就是把 UI 事实放进专门的展示投影，而不是把 UI 格式混进模型的规范返回值。

## 10. 工具的并发和作用域

### 10.1 并发默认关闭

阅读 [`executionMode()`](../../packages/core/tools/src/index.ts:1269) 和 [`../../packages/core/tools/tests/execution-mode.spec.ts`](../../packages/core/tools/tests/execution-mode.spec.ts:27)。只有工具的 `isConcurrencySafe(args)` 明确返回精确的 `true`，才会被标记为 `parallel`；缺省、返回其他值或抛异常都按 `exclusive` 处理。

这是一种故意的 fail-closed 规则：文件写入、状态修改和未知副作用不能因为一个模糊的 truthy 值就与兄弟调用并行。

### 10.2 全局工具和 Agent 作用域工具

`ctx.tools.register()` 可以注册全局工具；通过 `agent.ctx` 取得的 `ctx.tools.register()` 则只对该 Agent 作用域可见，作用域销毁时自动清理。阅读 [`../../packages/core/tools/tests/scoped.spec.ts`](../../packages/core/tools/tests/scoped.spec.ts:61)，观察 scoped 工具如何 shadow 全局同名工具。

### 10.3 `restrict()`：控制模型看到和能调用的工具

阅读 [`restrict()`](../../packages/core/tools/src/index.ts:1064)。它只能在 scoped Context 中使用，`allow` 和 `deny` 会编译成当前作用域的限制；限制会影响 Schema 可见性和执行解析，作用域自己的工具注册仍按当前层规则保留。

“模型看不到”与“执行时报错”必须保持一致。ToolRuntime 的 `schemas(scope)` 和 `get/resolveExecution` 使用同一套可见性判断，避免提示词广告了一个实际不能调用的工具。

## 11. 选择正确扩展点

| 需求 | 放在哪里 | 原因 |
|---|---|---|
| 注册一个新工具 | 工具插件的 `apply()` + `ctx.tools.register()` | 拥有 Schema、执行和清理 |
| 统一拒绝或询问 | `tools/pre-execute` | 进入执行前仍可改变决定 |
| 最终不可撤销的禁止条件 | `ctx.tools.guard()` | 单调拒绝，不被后续 allow 抵消 |
| 超时、重试、指标 | `tools/execute` | 围绕实际执行过程包装 |
| 改变结果或附加上下文 | `tools/post-execute` | 已有结果但尚未最终提交 |
| 审计和观测 | `tools/result` | 结果已冻结，观察不会改变执行 |
| 替换文件/模型执行环境 | Provider 插件 | Consumer 继续依赖 Service Definition |

不要把部署策略硬编码进每个工具的 `execute()`；工具只处理自己的领域动作，跨工具的政策交给 ToolRuntime 事件和策略插件。

## 12. 源码阅读路线

按下面顺序读，能避免一开始陷入工具实现细节：

1. 阅读 [`../../packages/fs/fs/src/index.ts`](../../packages/fs/fs/src/index.ts:80)，写出 `FileSystem` 承诺的稳定能力。
2. 阅读 [`../../packages/fs/fs-local/src/index.ts`](../../packages/fs/fs-local/src/index.ts) 和 [`../../packages/fs/fs-sandbox/src/index.ts`](../../packages/fs/fs-sandbox/src/index.ts)，标出 Provider 的环境差异。
3. 阅读 [`../../packages/fs/tool-fs/src/index.ts`](../../packages/fs/tool-fs/src/index.ts:18)，确认 Consumer 只读 `ctx.fs` 并负责工具 Schema。
4. 阅读 [`../../packages/core/tools/src/schema.ts`](../../packages/core/tools/src/schema.ts:545) 和 [`ToolRuntime.register()`](../../packages/core/tools/src/index.ts:1037)，理解工具如何被类型化和挂载。
5. 阅读 [`schemas()`](../../packages/core/tools/src/index.ts:1234)、[`prepareExecution()`](../../packages/core/tools/src/index.ts:1463) 和 [`postExecute()`](../../packages/core/tools/src/index.ts:1742)，画出工具流水线。
6. 阅读 [`../../packages/llm/llm/src/index.ts`](../../packages/llm/llm/src/index.ts:284) 与 [`../../packages/llm/llm-deepseek/src/index.ts`](../../packages/llm/llm-deepseek/src/index.ts:226)，把同样的三层方法应用到 LLM。

每读一个能力，填写这张表：Service key、Definition 文件、Provider 文件、Consumer 文件、模型可见字段、策略事件、持久化事件、替换 Provider 的配置入口和相关测试。

## 13. 动手练习：从一个 `greet` 工具开始

### 练习 A：写最小工具

按照 [`../../docs/user/develop/basic/tool.zh.md`](../../docs/user/develop/basic/tool.zh.md:7) 给 `scratch-plugin` 添加 `greet`，只返回规范字符串。验证模型 Schema 能看到 `name` 参数，工具执行后结果进入下一步模型上下文。

### 练习 B：加一个策略插件

注册一个 `tools/pre-execute` 监听器：当工具名是你指定的危险名称时返回 deny，其他调用调用 `next()`。再注册一个 `tools/result` 观察器，打印冻结结果但不尝试修改它。

### 练习 C：比较 Definition 和 Consumer

先阅读 `FileSystem`，再阅读 `tool-fs`，写出两者各自拥有的职责；然后替换一个本地/沙箱 Provider 配置，观察工具代码是否需要改动。

### 练习 D：观察并发 fail-closed

为一个纯计算工具声明 `isConcurrencySafe: () => true`，为一个带共享可变状态的工具省略该字段；通过 `executionMode()` 和 Agent Loop 工具测试确认前者可以并行、后者默认串行。

## 14. 最小验证

先阅读 [`../../packages/core/tools/tests/tools.spec.ts`](../../packages/core/tools/tests/tools.spec.ts:1)，观察 Schema、参数、输出和错误规范化；再运行：

```sh
pnpm vitest run packages/core/tools/tests/tools.spec.ts packages/core/tools/tests/execution-mode.spec.ts packages/core/tools/tests/scoped.spec.ts packages/core/tools/tests/invariant.spec.ts packages/core/agent-loop/tests/tool-calls.spec.ts packages/fs/tool-fs/tests/tools.spec.ts packages/shell/tool-bash/tests/tools.spec.ts
```

这些测试分别覆盖注册/执行、并发分类、作用域限制、生命周期不变量、Agent Loop 回写、文件工具和 Bash 工具；它们比只在 UI 中看到一次成功调用更能证明扩展点语义。

## 15. 常见误区

- 在工具里直接 import 本地文件系统或 DeepSeek SDK：这会绕过 Service Definition，替换 Provider 时迫使 Consumer 一起改。
- 把工具的自然语言结果当程序 API：程序应消费 `output.schema` 的规范值，说明文字交给 `output.render`。
- 把 UI Diff 或 Terminal 格式塞进模型结果：模型通道和 UI 展示通道应分别设计。
- 在 `tools/result` 里尝试拒绝调用：这个事件只观察最终冻结结果，拒绝应放在 `pre-execute` 或 Guard。
- 只隐藏 Schema 不限制执行：模型可见性和 `resolveExecution` 必须使用一致的作用域/限制规则。
- 看到 `isConcurrencySafe` 返回 truthy 就并行：当前契约只接受精确的 `true`，未知或异常按 exclusive。
- 忘记 `exec.signal`：工具可能在 Agent 已取消后继续占用进程、文件或网络资源。

## 16. 自测与参考答案

可以用自己的话思考：为什么“限制模型看到的工具 Schema”与“执行时再次检查工具是否可见”必须同时存在？如果只做前者，会留下什么问题？

参考答案：Schema 限制只影响模型能看到什么，不能单独阻止程序或过期的 Tool Call 直接解析并执行。如果执行阶段不再次检查作用域和限制，隐藏的工具仍可能被调用，形成“模型看不到但运行时能执行”的权限漏洞；两处必须使用一致的可见性判断。

读完本模块后，继续模块六的多入口复用与工程化沉淀；工具和策略练习可以按需完成。
