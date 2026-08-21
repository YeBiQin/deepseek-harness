# 模块二：Cordis 插件与生命周期

这是 DeepSeek Harness 深度学习的第二个模块，专门回答一个问题：一个插件从“配置里出现”到“开始工作”，再到“被卸载并清理”，中间发生了什么。

本模块以前一个模块的启动地图为前置知识；暂不深入 Agent Turn、Session 事件流和工具策略流水线，只学习它们赖以存在的运行时装配机制。

## 1. 学完本模块要得到什么

完成本模块后，你应该能看懂一个真实插件的 `apply()`，解释 `inject` 为什么不是普通数组，区分 Service、Event 和 Effect 的职责，并能预测插件卸载时哪些注册会被撤销。

你还应该能回答：“一个模块已经被 TypeScript import，是否就等于它已经在 Harness 里运行？”答案是否定的；本模块会用运行时证据解释原因。

## 2. 先把插件想成一个可撤回的工作小组

把 Cordis 想成一间共享工作室。插件是一个工作小组，`apply(ctx)` 是小组入场时的安装动作，`inject` 是入场前必须满足的门禁条件，Service 是可长期使用的部门，Event 是内部对讲机，Effect 是领用设备时同时登记的归还手续。

这个比喻最重要的部分是“可撤回”：小组离场时，它注册的监听器、工具、适配器、定时器和其他资源不能留在工作室里继续冒充自己还在岗。

| Cordis 概念 | 白话理解 | 在 Harness 中常见的用途 |
|---|---|---|
| Plugin | 一个可装入、可卸载的工作小组 | 注册工具、Provider、策略或入口 |
| Context | 当前插件树共享的工作台 | 访问 `ctx.llm`、`ctx.tools`、`ctx.sessions` |
| Service | 长期存在的部门或设备 | 提供稳定方法，例如 `ctx.llm.stream()` |
| `inject` | “这些部门准备好后我才能入场” | 声明 `tools`、`fs`、`systemPrompt` 等依赖 |
| Event | 内部对讲机或扩展钩子 | 观察、修改、拦截运行时动作 |
| Effect | 领用登记和归还手续 | 卸载时撤销注册、停止定时器、释放连接 |

## 3. 先区分两个图：import 图和运行时插件图

初学者很容易把“文件能被 import”误认为“插件已经生效”。其实要看两张不同的图。

```text
TypeScript import 图：文件 A import 文件 B
  ↓ 只说明代码可以被解析和调用

Cordis 运行时插件图：Loader 挂载 entry → 依赖满足 → apply(ctx)
  ↓ 才说明能力进入当前 Context，并拥有生命周期
```

例如 [`../../scratch-plugin/src/my-plugin.ts`](../../scratch-plugin/src/my-plugin.ts) 可以被某个测试文件直接 import，但如果没有被配置 entry 引用，Loader 就不会把它挂进当前插件树；如果它声明了 `inject: ['tools']`，而当前树又没有 `tools` Service，`apply()` 也不能把 `ctx.tools` 当成已存在的能力使用。

这也是为什么模块一的启动链路要继续追到 [`../../packages/boot/app-boot/src/index.ts`](../../packages/boot/app-boot/src/index.ts:757) 的 `boot()`：这里创建根 `Context`、安装 Loader、挂载根配置、等待 Loader，并在成功后检查 entry 是否激活。

## 4. 一个插件从出生到离场的完整生命周期

可以先记住下面这条顺序。源码细节很多，但大多数插件都能放进这条主线。

```text
配置 entry 被 Loader 发现
  ↓
解析模块、配置和依赖声明
  ↓
等待 inject 指定的 Service 可用
  ↓
执行 apply(ctx, config) 或挂载 Service 实例
  ↓
注册 Service / Event / Tool / Adapter / Effect
  ↓
插件在正常运行期间提供能力
  ↓
插件树或所属 fiber 卸载
  ↓
按 Cordis 生命周期撤销注册、释放资源
```

`apply()` 不是“每次调用某个能力时才执行”的业务函数，而是一次性的装配入口。真正的业务工作通常由它注册的 Service 方法、Event 监听器或工具执行函数完成。

### 4.1 解析和等待

Loader 先读取 entry 的模块和配置，并根据 `inject` 判断插件需要等待哪些能力。这个机制把“先启动谁”改写成“我依赖谁”，从而减少手写启动顺序。

`inject` 只表达运行时所需的服务依赖，不是 TypeScript 的 import，也不是一个可以随意写入所有包名的标签。声明了 `inject: ['llm']`，意味着 `apply()` 运行时应当能从当前 Context 取得 `ctx.llm`。

### 4.2 激活和注册

当依赖满足后，Loader 才执行插件的 `apply()`；插件在这里把自己的能力接入现有系统。一个插件可以只注册一个监听器，也可以同时注册多个工具、服务或 Provider。

真实例子是 [`../../packages/llm/llm-deepseek/src/index.ts`](../../packages/llm/llm-deepseek/src/index.ts:43)：它声明自己依赖 `llm`，在 `apply()` 中把 DeepSeek 路由注册到抽象的 `ctx.llm`，所以上层 Agent 不需要直接 import DeepSeek SDK。

另一个例子是 [`../../packages/fs/tool-fs/src/index.ts`](../../packages/fs/tool-fs/src/index.ts:19)：文件工具需要 `tools`、`fs` 和 `systemPrompt`，因此它是在这些能力都存在时才把读写编辑工具装入运行时；`attachments` 还通过一次额外的 `ctx.inject()` 使图像读取能力按部署组合出现。

### 4.3 运行和卸载

插件工作期间，其他代码通过 Service 方法或事件扩展点使用它；插件不应假设自己永远存在。热重载、配置更新、作用域结束或根 Context 关闭，都可能触发卸载。

卸载时，Cordis 会执行这个插件及其子插件登记的 disposer。因而“谁创建，谁登记清理”是最容易记、也最实用的所有权规则：插件创建定时器，就在自己的 Effect 中清理；插件注册适配器，就保留注册返回的 disposer。

## 5. Service、Event、Effect 到底怎么选

| 你要解决的问题 | 首选机制 | 判断方式 |
|---|---|---|
| 其他插件要直接调用一个稳定能力 | Service 方法 | 使用者需要主动发起调用并得到明确结果 |
| 其他插件要观察、包装、修改或阻止一次动作 | Event | 运行时在某个扩展点主动 dispatch |
| 注册动作需要在卸载时撤销 | Effect | 安装和清理必须绑定在同一生命周期 |

可以用三个问题快速判断：如果调用者知道“我要做什么”，通常找 Service；如果系统知道“某件事正在发生”，通常发 Event；如果你新增了任何长期注册或外部资源，马上问“卸载时谁负责撤销”，答案通常是 Effect。

### 5.1 Service：提供稳定能力

Service 是长期挂在 Context 上的能力入口。比如 [`../../packages/llm/llm/src/index.ts`](../../packages/llm/llm/src/index.ts:284) 的 `LlmRuntime` 以 `ctx.llm` 提供模型流式调用和适配器注册；[`../../packages/core/tools/src/index.ts`](../../packages/core/tools/src/index.ts:787) 的 `ToolRuntime` 以 `ctx.tools` 管理工具注册、呈现和执行。

这类 Service 通常继承 Cordis 的 `Service`，在构造函数中声明自己的 key，并可以在构造阶段注册依赖、事件或生命周期效果。真正要理解某个 Service，先看它的构造函数，再看它公开的方法和这些方法返回的 disposer。

### 5.2 Event：提供可插入的运行时时刻

事件不是“所有回调都一样”。Harness 使用 `emit`、`waterfall`、`parallel` 和 `serial` 表达不同语义，权威说明见 [`../../docs/cordis-primer.zh.md`](../../docs/cordis-primer.zh.md:15)。

入门时先掌握 Waterfall：监听器收到 `next` 后，如果只是补充信息或观察，就必须调用 `next()`；如果返回而不调用 `next()`，就表示它主动截断后续处理。工具策略、Agent 请求和提示词组装都会依赖这条规则。

### 5.3 Effect：把安装和清理绑在一起

`ctx.effect(() => disposer)` 可以理解为“现在安装，未来卸载时执行返回的清理函数”。如果清理有先后关系，可以使用生成器 Effect，把多个 disposer 按明确的顺序组合起来。

例如 `LlmRuntime.registerAdapter()` 在 [`../../packages/llm/llm/src/index.ts`](../../packages/llm/llm/src/index.ts:338) 创建 Effect：激活时提交 Provider 路由，卸载时删除路由并通知拓扑变化。`AgentRegistry.register()` 在 [`../../packages/core/agent/src/index.ts`](../../packages/core/agent/src/index.ts:450) 也返回精确的 Cordis disposer，让 Agent 的登记和注销属于同一个生命周期。

## 6. 真实源码中的四个观察点

### 观察点 A：根启动如何拥有整棵插件树

阅读 [`../../packages/boot/app-boot/src/index.ts`](../../packages/boot/app-boot/src/index.ts:757) 的 `boot()`，标出 `new Context()`、`ctx.plugin(Loader)`、`mountRootInclude()`、`loader.await()` 和失败时 `ctx.fiber.dispose()`。这五个位置分别对应创建工作台、安装项目经理、挂载配置、等待装配完成和统一收尾。

### 观察点 B：Service 如何声明自己的依赖

阅读 [`../../packages/core/tools/src/index.ts`](../../packages/core/tools/src/index.ts:787) 的 `ToolRuntime`，注意 `static inject = ['systemPrompt']`。再对比 [`../../packages/core/session/src/index.ts`](../../packages/core/session/src/index.ts:792) 的 `SessionStore`，它在构造函数中使用 `ctx.inject(['typert'], ...)` 注册类型查找器。

这里有一个阅读重点：静态 `inject` 适合 Service 实例本身的固定依赖；运行中才确定的组合依赖，可以在 `apply()` 或构造函数里调用 `ctx.inject()` 延迟挂载一段逻辑。

### 观察点 C：Provider 如何接入抽象 Service

阅读 [`../../packages/llm/llm-deepseek/src/index.ts`](../../packages/llm/llm-deepseek/src/index.ts:43) 的导出定义和 [`apply()`](../../packages/llm/llm-deepseek/src/index.ts:226)，回答两个问题：它依赖谁？它把什么能力注册给谁？

正确的阅读结果应接近：“它依赖抽象的 `llm` Service；它把 DeepSeek 的模型路由和适配逻辑注册到 `ctx.llm`，而不是让 Agent 直接认识 Provider 实现。”

### 观察点 D：动态组合如何避免悬挂能力

阅读 [`../../packages/fs/tool-fs/src/index.ts`](../../packages/fs/tool-fs/src/index.ts:54)，特别关注 `ctx.inject(['attachments'], ...)`。它说明一个插件可以在主能力已激活后，再根据另一个可选 Service 是否挂载来增加一部分功能。

这不是让每个函数都随意 `if (ctx.get(...))` 的理由；先确认当前代码是否把“可选能力”设计成注入式组合，再沿用已有模式。

## 7. 事件模式的最小练习

打开 [`../../docs/cordis-primer.zh.md`](../../docs/cordis-primer.zh.md:15)，把四种事件模式各写成一句话，并为每种模式补一个“调用方是否等待结果”的例子。然后阅读 [`../../packages/fs/fs-observation-policy/src/index.ts`](../../packages/fs/fs-observation-policy/src/index.ts:106)，观察它如何用 `ctx.on()` 接入文件意图事件。

再看 [`../../packages/fs/tool-fs-search/src/grep.ts`](../../packages/fs/tool-fs-search/src/grep.ts:341) 的 `tools/post-execute` 监听器，检查它是否调用 `next()`。你的目标不是记住业务细节，而是判断这个监听器是在“观察并交给后续处理”，还是在“主动截断”。

## 8. 动手练习：让插件拥有可验证的生命周期

入门级完整操作见[开发教程第 1 篇](develop-study/01-first-plugin.md)；本模块下面的练习用于继续追踪真实 Service 和 HMR 生命周期。

### 练习 A：给 scratch plugin 加依赖

在 [`../../scratch-plugin/src/my-plugin.ts`](../../scratch-plugin/src/my-plugin.ts) 中声明 `inject: ['tools']`，在 `apply(ctx)` 中只打印 `ctx.tools` 已可访问的事实。先运行已有 Overlay，再临时移除 `tools` entry，记录两种配置下的启动行为。

### 练习 B：给插件加一个可清理的定时器

在 `apply(ctx)` 中通过 `ctx.effect()` 创建一个短周期定时器，并在返回的 disposer 中停止它；修改配置触发 HMR，观察旧插件是否停止继续输出。重点记录“什么时候创建、什么时候清理、清理由哪个 Context 所有”。

### 练习 C：读一个真实注册器

任选 `LlmRuntime.registerAdapter()`、`AgentRegistry.register()` 或 `SessionStore.create()`，画出“进入注册表 → 发出事件 → fiber 卸载 → 从注册表移除”的四格图。暂时不要追进入 Agent Turn 的内部逻辑，只验证生命周期的闭环。

如果需要测试证据，可从 [`../../packages/boot/app-boot/tests/hmr-config.spec.ts`](../../packages/boot/app-boot/tests/hmr-config.spec.ts)、[`../../packages/boot/app-boot/tests/app-boot.spec.ts`](../../packages/boot/app-boot/tests/app-boot.spec.ts:651) 和 [`../../packages/core/agent-loop/tests/scope-lifecycle.spec.ts`](../../packages/core/agent-loop/tests/scope-lifecycle.spec.ts) 开始。

## 9. 初学者最容易踩的坑

- 把 import 当成挂载：import 只解决模块可解析，Loader entry 和依赖激活才决定运行时是否存在。
- 把 `inject` 当成顺序数组：它表达“我需要哪些 Service”，不是让你手写全局启动顺序。
- 把 Event 当成普通回调：先查事件的 dispatch mode，再决定是否等待、是否调用 `next()`。
- 只写注册不写清理：热重载后出现重复监听器、重复工具或悬挂定时器，通常是所有权没有绑定到 Effect。
- 在 Consumer 中直接 import Provider：这会让替换实现变难；先寻找 Service Definition，再看 Provider 和 Consumer 的连接点。

## 10. 源码卡片：每读一个插件都填这六格

1. 它的 entry 或导出入口在哪里？
2. 它声明了哪些 `inject` 依赖？
3. `apply()` 或构造函数注册了哪些 Service、Event、Tool 或 Adapter？
4. 它提供的是直接调用能力，还是运行时扩展点？
5. 每个注册动作的 disposer 在哪里？
6. 哪个测试能证明激活、卸载或 HMR 行为？

填完六格再开始读业务算法，通常比从一个很大的 `run()` 函数向下跳更容易建立正确的上下文。

## 11. 自测与参考答案

可以用自己的话思考：如果 `llm-deepseek` 已被模块解析，但它声明的 `llm` Service 没有挂载，为什么不能让它在 `apply()` 里自己 `new LlmRuntime(ctx)` 来“补上依赖”？

参考答案：`llm` Service 的实例、生命周期和注册表由拥有它的 Service Definition/Provider 管理。Consumer 自行 `new LlmRuntime(ctx)` 会绕过 Loader 的依赖关系、作用域和 disposer，造成两个互不一致的运行时；正确做法是声明依赖并让 Loader 在 Service 可用后执行。

读完本模块后，继续模块三的 Agent Turn 主链路；练习和源码卡片可以作为可选巩固材料。
