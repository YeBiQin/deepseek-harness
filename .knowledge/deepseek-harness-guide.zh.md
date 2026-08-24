# DeepSeek Harness 系统性学习指南

> 本文是个人学习笔记，不参与本仓库的文档门禁体系。内容基于逐行阅读真实源码整理，可作为后续开发的速查手册。

---

## 目录

1. [这个工程是什么](#1-这个工程是什么)
2. [三大设计思想](#2-三大设计思想)
3. [Cordis 世界观（地基概念）](#3-cordis-世界观地基概念)
   - [ctx API 全解：方法与场景](#33-ctx-api-全解方法与场景)
4. [运行时装配：profile / bundle / 插件树](#4-运行时装配profile--bundle--插件树)
5. [核心流程：agent-loop](#5-核心流程agent-loop)
6. [目录地图：去哪里开发](#6-目录地图去哪里开发)
7. [插件开发的四种形态（含真实代码解剖）](#7-插件开发的四种形态含真实代码解剖)
8. [能力缝三件套（capability seam）](#8-能力缝三件套capability-seam)
9. [从配置到代码的端到端闭环](#9-从配置到代码的端到端闭环)
10. [开发实操：先做什么、怎么做](#10-开发实操先做什么怎么做)
11. [工程规则速查](#11-工程规则速查)
12. [术语表](#12-术语表)

---

## 1. 这个工程是什么

**DeepSeek Harness（`dsh`）是 DeepSeek AI 开源的一套"智能体框架"（agent harness）**，用来搭"AI 助手 / AI Agent"类程序——类似 Claude Code、Cursor、Copilot 那种能听懂指令、调用工具、连续干活的程序。

- 底层基于 **Cordis**（以 vendor 方式内置的插件框架）驱动。
- 核心口号：**一切皆插件（Everything is a plugin）**。
- 编排方式：通过 `cordis.yml` 配置把需要的插件"拼"成一棵插件树，启动即用。
- 现状：开发者预览阶段，快速迭代，**会破坏兼容性**（无外部消费者，优先正确地基而非兼容垫片）。

一句话：**它不是单个程序，而是一套"拼积木"的底盘**。从大模型适配器、工具注册表、会话日志到 agent 循环本身，全是可替换的插件。

---

## 2. 三大设计思想

### 思想 1：一切皆插件，没有特权内核

即使是"调大模型"、"记录会话"、"AI 循环本身"这些核心部件，在 dsh 里也是插件。

后果：

- 任何部件都能替换（换模型适配器、换存储后端）。
- 新功能 = "在旁边再挂一个插件"，**不改别人的代码、不碰 agent-loop 内核**。
- 插件卸载时，它注册的一切（监听器、工具、提示词、服务）自动撤销——注册是**可逆副作用**。

### 思想 2：插件之间靠"服务 + 事件"两个口子对接

- **服务（Service）**：插件提供的功能，通过 `ctx.<key>` 暴露（如 `ctx.tools`、`ctx.llm`、`ctx.sessions`）。别的插件**不 import 具体实现，按 key 找服务**。
- **事件（Event）**：插件间的消息 / 扩展点。加策略、做拦截、观察进度，本质都是"在某事件上挂监听器"。

### 思想 3：配置靠"叠加补丁"，不重写

一个跑起来的 `dsh` 是一棵插件树，按层叠拼成：

```
profile 列出的组合包 → profile 的 cordis.patch.yml → home 级 patch → --patch 参数
```

- **补丁按 `id` 定位**某个条目并替换其整个 `config`，或插入新条目。
- 官方交付 `web`（带 UI）与 `headless`（纯一次性运行）两个模板，在此之上 patch 即可。

### 思想 4（铁律）：模型可见的必须被记录

> **Model-visible ⟺ Logged**

一切抵达模型请求的内容，都必须能从会话日志（session log）重建。新增"会喂给模型的东西"就必须新增一个会话事件，并有运行时不变量（invariant）断言。

---

## 3. Cordis 世界观（地基概念）

Cordis 是 dsh 底层的插件框架（源码在 `vendor/cordis/`，能不碰就不碰）。五个核心概念：

| 概念 | 大白话 | 代码形态 |
|---|---|---|
| **插件 plugin** | 一个功能块 | 函数（`name`/`inject`/`Config`/`apply`）或 `Service` 子类 |
| **上下文 context（`ctx`）** | 装所有服务的容器 | `ctx.<key>` 取服务；`ctx.on`/`ctx.inject` 挂东西 |
| **inject 依赖注入** | 声明"我需要哪些服务"，就绪才启动 | `export const inject = ['tools']` 或 `ctx.inject([...])` |
| **事件 event** | 插件间通信 / 扩展点，五种分发方式 | `ctx.on(name, listener)` |
| **注册副作用 effect** | 注册的东西可自动撤销 | `ctx.effect()` / `ctx.on()` / `registry.register()` 返回 disposer |

### 事件分发模式（写代码前必须知道）

共五种（`DispatchMode`）：`emit` / `parallel` / `serial` / `bail` / `waterfall`。

| 模式 | 是否 await | 顺序 | 有返回值 | 大白话 |
|---|---|---|---|---|
| `emit` | 否 | 按注册顺序 | 无 | 广播，各位自己看着办 |
| `parallel` | 是 | 并行 | 无 | 大家一起来，全部结束才返回（有错抛 AggregateError） |
| `serial` | 是 | 按注册顺序 | 有（首个 bail 值） | 一个个来，**第一个"表态"的接管** |
| `bail` | 否 | 按注册顺序 | 有（首个 bail 值） | serial 的同步版 |
| `waterfall` | 否 | 按注册顺序 | 有 | 接力棒，A 处理完交 B；不调 `next()` 即短路 |

> **bail 值**：监听器返回**非 `null` / `false` / `undefined`** 的值即视为"表态"。`serial`/`bail` 在遇到第一个 bail 值时停止后续监听器并返回该值——适合"多个候选处理者，第一个能处理的接管"。

**Waterfall 语义（重中之重）**：监听器收 `(...args, next)`。

- **调用 `next()` = 把控制权交给下游**；下游返回值通过 `next()` 传回来，当前层可包装。
- **不调 `next()` 直接返回 = 短路**（这是设计意图——单决策事件上，拥有决策权的策略监听器就该短路）。
- 只观察 / 标注的监听器**必须委托**（调 `next()`）。
- `prepend: true` 只在必须排在普通注册之前时用。

**实践原则**：拦截和策略优先用事件；直接能力调用优先用服务方法。

### 其他要点

- **可选依赖用 `ctx.get(name)`**，声明注入用 `ctx.<name>`（属性代理对拓扑敏感，`ctx.get` 读全局服务存储）。
- **配置校验双重制**：TS 接口（编译期类型）+ Schemastery schema（运行时校验）。写错配置在加载时 fail loud，绝不静默降级。
- `!!js 表达式`：cordis.yml 里允许的**动态表达式**语法（如 `!!js process.cwd()`），普通配置保持字面量。

### 3.3 ctx API 全解：方法与场景

#### ctx 的构成原理（先懂这个）

`ctx` 不是普通对象，而是一个 **Proxy**：

- **普通属性读**（`ctx.<key>`）走服务解析器——注入声明之后，读 `ctx.tools` 会解析到当前作用域下提供的实现，未注入就报 `cannot get property "xxx" without inject`。
- **可调用方法**大部分来自四个内建服务的 **mixin**（混入），它们在 `ReflectService` 构造时被挂到 `ctx` 上：

| 来源服务 | 混入到 ctx 的方法 |
|---|---|
| `ctx.events` | `on` `once` `parallel` `emit` `serial` `bail` `waterfall` |
| `ctx.registry` | `plugin` `inject` |
| `ctx.reflect` | `get` `set` `provide` `accessor` `mixin` |
| `ctx.fiber` | `effect` `runtime` |
| `ctx.logger` | 本身是 callable（可直接调用） |

`Context` 类本体方法只有三个：`extend` / `isolate` / `intercept`（都是生成子作用域）。

#### A. 事件类（对应前面五种分发模式）

| 方法 | 签名要点 | 场景 |
|---|---|---|
| `ctx.on(name, listener, options?)` | options：`{prepend, global}`；布尔简写 = `prepend`；返回 disposer | 注册监听器。监听器随 fiber 卸载自动移除 |
| `ctx.once(name, ...)` | 触发一次后自毁 | 一次性等待 |
| `ctx.emit(name, ...args)` | 同步广播，忽略返回值 | 通知"某事实发生了" |
| `ctx.parallel(name, ...args)` | 并发跑全部并等齐；有错抛 AggregateError | 各监听器独立、都要完成 |
| `ctx.serial(...)` / `ctx.bail(...)` | 按序直到首个 bail 值 | 多个候选者，第一个能处理的接管 |
| `ctx.waterfall(name, ...args, next)` | 最后一个参数是 `next`；不调 `next()` 即短路 | 请求/决策流水线（`agent/pre-step`、`tools/execute`、`llm/stream` 等） |

#### B. 插件 / 依赖类

| 方法 | 说明 | 场景 |
|---|---|---|
| `ctx.plugin(plugin, config?)` | 加载插件（函数 / 类 / `{apply}` 对象），返回 fiber（可 await，出错则 reject） | 代码内动态挂插件 |
| `ctx.inject(deps, callback)` | 等价 `ctx.plugin({ inject, apply })`：等依赖服务就绪才跑，依赖变化会重跑 | 可选依赖、条件激活（todo 工具里 `ctx.inject(['sessionProjections'], ...)` 就是例子） |

#### C. 服务类

| 方法 | 说明 | 场景 |
|---|---|---|
| `ctx.get(name, strict?)` | 从存储读服务，**不要求注入声明**；未提供返回 `undefined`。`strict` 默认 true（只返回 ACTIVE fiber 的实现） | 可选依赖（`ctx.get('spillStore')` 的典型用法） |
| `ctx.set(name, value)` | 覆盖某服务的值；**只有提供它的 fiber 能 set**，未 provide 则抛错 | 提供方更新自己的实例状态 |
| `ctx.provide(name, value)` | 注册服务实现，返回 disposer；同作用域重复提供抛 `service "xxx" has been registered` | 服务包的 `apply` 里注册实现 |
| `ctx.accessor(name, {get, set})` | 定义 ctx 上的计算属性 | 自定义上下文属性 |
| `ctx.mixin(source, keys)` | 把服务成员挂到 ctx 上（`ctx.on` 就是这么来的） | 服务包便捷暴露方法 |
| `ctx.<key>` 直接读 | 注入后的属性读，**拓扑敏感**（子上下文解析不同） | 声明依赖后的常规取用 |

#### D. 副作用类

| 方法 | 说明 | 场景 |
|---|---|---|
| `ctx.effect(callback)` | 注册可逆副作用：callback 里做注册、返回清理函数；fiber 卸载时按序清理 | **所有"注册类"操作的统一生命周期钩子**（注册工具、监听器、定时器、文件句柄）。之前看过它的 use 例：`ctx.tools.register(...)`、`ctx.on(...)` 底层都挂在 fiber effect 上 |
| `ctx.fiber` | 当前 fiber 对象（诊断、`runtime` 等） | 调试、HMR 测试 |

#### E. 日志类（callable）

```ts
ctx.logger('fs')                   // 命名日志器，之后日志都带 "fs" 前缀
ctx.logger.warn('cannot read %s', path)   // 直接打，用当前 fiber 推导名字
```

- 方法：`error` / `info` / `warn` / `debug`；printf 风格：`%s` 字符串、`%d` 整数、`%o` JSON。
- 场景：给子系统独立日志名，方便按名过滤。

#### F. 作用域类（Context 本体）

| 方法 | 说明 | 场景 |
|---|---|---|
| `ctx.extend(meta?)` | 建子上下文（原型继承父属性，不改父） | 给插件一个隔离的元数据层 |
| `ctx.isolate(name, label?)` | 子上下文里把某服务隔离到独立作用域，可提供不同实现；同 `label` 合并作用域 | **每个 agent/session 有自己的服务实现**（隔离不同会话的状态） |
| `ctx.intercept(name, config)` | 对该服务的插件 config 合并 intercept 配置 | 层叠配置覆盖（profile → patch 链） |
| `ctx.root` | 根上下文 | 访问应用级状态 |

#### G. 内置服务对象

`ctx.events` / `ctx.reflect` / `ctx.registry` / `ctx.logger` / `ctx.fiber` / `ctx.root` / `ctx.baseUrl?` ——需要更底层能力时直接用它们。

#### 场景判断速查表

| 我想… | 用什么 |
|---|---|
| 观察 / 拦截某个时刻 | `ctx.on` + 对应事件 |
| 让多个监听器并行完成 | `ctx.parallel` |
| 第一个能处理的接管 | `ctx.serial` / `ctx.bail` |
| 请求 / 决策流水线包装 | `ctx.waterfall`（记得 `next()`） |
| 提供能力给别人 | `ctx.provide`（或 Service 子类） |
| 读可选能力，没有就算了 | `ctx.get(name)` |
| 挂一个临时资源并确保卸载清理 | `ctx.effect` |
| 动态加载一个插件 | `ctx.plugin` |
| 按依赖就绪再跑 | `ctx.inject` |
| 隔离 / 替换某服务实例（按 agent 等） | `ctx.isolate` |
| 给下层插件叠配置 | `ctx.intercept` |
| 打日志 | `ctx.logger` / `ctx.logger('name')` |

#### 常见陷阱

- `ctx.<key>` 直接读**未注入**的属性会抛 `cannot get property ... without inject`（错误带调用栈增强，方便定位）。
- `ctx.get` 默认 `strict: true`：只返回 **ACTIVE** fiber 的实现；要读到正在卸载的实现可传 `strict: false`。
- `ctx.provide` 同作用域重复提供抛错；`ctx.set` 只能由提供方调用——违反会得到清晰的错误信息。
- `internal/*` 事件（如 `internal/dispatch`、`internal/update`）是框架保留事件，业务插件不要监听。

---

## 4. 运行时装配：profile / bundle / 插件树

### 概念

- **profile**：Harness home 里的具名组装，列出组合包、存放树外插件、保存用户的 `cordis.patch.yml`。`web`、`headless` 是随发行版交付的模板。
- **bundle（组合包）**：Cordis 配置项 + 挂载代码的分发格式，插入的内容始终可被上层 patch。

查看实际启动的配置树：

```sh
dsh --profile web --dump-config
```

### 真实的 cordis.yml（解剖）

来源：`examples/acp-agent/tests/fixtures/subagent/subagent-codex/cordis.yml`

```yaml
# 每一项 = 一个插件：id（唯一编号）+ name（包名）+ 可选 config（参数）
- id: subagent
  name: '@deepseek-ai/dsh-subagent'

# 同一个插件可挂多个实例，用 config 区分
- id: subagent-codex-primary
  name: '@deepseek-ai/dsh-subagent-codex'
  config:
    providerName: codex-primary

# 把"能力"变成"模型可调用的工具"（Consumer 形态）
- id: tool-subagent-codex
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: codex
    toolName: subagent_codex          # 模型看到的工具名
    backgroundMode: one-shot
    maxDepth: 'provider-managed'

# 测试专用：用 mock 提供方，persona 明确写"不得启动模型轮次"
- id: agent-spine
  name: '@deepseek-ai/dsh-agent-spine-demo'
  config:
    agents:
      - id: main
        provider: mock
        model: mock-delegate
        cwd: !!js process.cwd()
```

要点：

- `id` 是补丁定位的锚点，`name` 是包名，`config` 是调参。
- 测试配置与产品配置分离：测试用 mock、不碰真模型。
- 同一个能力（subagent）由三个不同包协作：能力定义、提供方、工具 Consumer。

---

## 5. 核心流程：agent-loop

### 术语

- **一步（step）** = 一次模型请求 + 它调用的工具。
- **一轮（turn）** = 从收到指令到不再欠任何工作为止（含零到多步）。

### 流程

```text
turn/start
  claim 输入
  组装提示词片段 + 工具 schema
  -> agent/pre-step                # waterfall：可改写/拒绝输入
     step/start
     写出用户消息
     从日志派生模型历史
     agent/request -> llm/stream -> assistant/chunk* -> assistant/message
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     还欠工作 -> 再来一步
  -> agent/turn-stopping
turn/end
```

**一句话**：循环"调模型 → 模型要调工具 → 执行工具 → 结果给模型 → 模型可能再调……直到模型说干完"。

### 关键扩展点（事件）

| 事件 | 模式 | 用途 |
|---|---|---|
| `agent/pre-step` | waterfall | 决定模型看到什么（改写 / 拒绝输入） |
| `agent/request` | waterfall | 包一层模型请求 |
| `llm/stream` | waterfall | 包装流式输出 |
| `tools/pre-execute` / `tools/execute` / `tools/post-execute` | waterfall | 工具执行管线（拦截、策略、观察、替换结果） |
| `agent/turn-stopping` | serial | 轮次收尾（无 `next()`） |

持久会话事件与实时扩展点分离：`turn/*`、`step/*`、`user/message`、`assistant/*`、`tool/*` 是**持久事实**（写入日志）；其余是实时扩展。

---

## 6. 目录地图：去哪里开发

### 顶层目录

| 目录 | 干什么 | 注意点 |
|---|---|---|
| `vendor/` | Cordis 等内置框架源码 | 能不碰就不碰，有专门同步流程 |
| `packages/` | **所有功能包，开发主战场** | 按 `<group>/<pkg>/` 组织 |
| `examples/` | 可运行示例 + cordis.yml + 快照基线 | 学写插件最好的地方 |
| `apps/` | CLI / Web 入口 | 看启动链用 |
| `scripts/` | 生成器、门禁检查 | 日常不碰 |
| `docs/` | 架构、子系统、教程 | **动手前先读** |
| `website/` | 文档网站（VitePress 投影） | 改文档要同步 |
| `python/` | Python SDK 与运行时 | 做 Python 端再看 |
| `.agents/` | Agent Notes（决策记录）与技能 | 非平凡改动配套 |

### packages/ 分组逻辑

每个组 = 一个**能力缝**（详见第 8 节）。关键组：

| 组 | 内容 |
|---|---|
| `core/` | 产品主干：session、system-prompt、tools、agent、agent-loop |
| `llm/` | LLM 能力：抽象服务 + DeepSeek 等提供方 |
| `fs/` `shell/` `subprocess/` `terminal/` `web/` | AI 干活的"手" |
| `session/` `storage/` `settings/` `credentials/` | 持久化 / 配置 / 凭据 |
| `skill/` `subagent/` `workflow/` `todo/` `plan/` `job/` | 高级能力（子代理、工作流、任务清单、计划） |
| `interaction/` `guard/` `sandbox/` | 审批交互、循环卫生守卫、沙箱 |
| `sdk/` `acp/` `api/` `host/` `client/` | 对外协议 / Web 宿主 |
| `util/` | 零依赖工具（`Branded<B>`、路径辅助） |

---

## 7. 插件开发的四种形态（含真实代码解剖）

### 7.1 函数式插件（最小模板）

来源：`packages/todo/tool-todo/src/index.ts` 的框架部分

```ts
export const name = 'tool-todo'          // 插件名单（Loader 定位用）
export const inject = ['tools']          // 声明依赖：tools 服务就绪才启动

export interface Config {                // TS 类型（编译期）
  allowParallelInProgress: boolean
}
export const Config: z<Config> = z.object({   // 运行时校验 schema
  allowParallelInProgress: z.boolean().required(),
})

export function apply(ctx: Context, config: Config): void {
  // 一切注册都在这：ctx.on / ctx.inject / ctx.tools.register ...
}
```

规律：

- **函数式插件：命名导出 `name` / `inject` / `Config` / `apply`，无 default export**。
- 服务包（见 7.4）：**default export 服务类**。两者不要混用（Loader 会丢掉注入信息）。
- 同一标识 `Config` 出现两次：TS 接口 + Schemastery schema，双保险。

### 7.2 工具插件（defineTool 四件套）

一个给模型用的工具由四部分组成：

| 部分 | 大白话 | todo_write 例子 |
|---|---|---|
| `name` | 模型看到并调用的名字 | `todo_write` |
| `description` | 用**任务语言**告诉模型怎么用（不是 UI/实现语言） | 分 parallel/single 两种描述，大写强调"整表替换" |
| `parameters` | 模型传参的 JSON Schema（+`output.schema` 定义返回） | todos 数组（content + status） |
| `execute` | 干活：**校验 → 动手 → 记日志 → 返回** | 校验、`session.append('todo/write', ...)`、返回统计 |
| `output.render` / `presentCall` | 结果如何展示（render intent 是设计契约，非事后补） | "Updated todo list: N pending..." |

`execute` 的关键动作示例（todo_write）：

```ts
execute(args, exec) {
  const todos = toTodoList(args.todos, allowParallel)   // ① 强校验：模型输入不可信
  if (!exec.agent) {
    throw new Error('todo_write requires an owning agent session')  // ② 无主则拒绝，不静默
  }
  exec.agent.session.append('todo/write', { todos })    // ③ 写会话日志（模型可见必须记录）
  return Promise.resolve({ todos, counts })              // ④ 返回规范化结果
}
```

**Render intent**：工具的 UI 展示意图（`generic`/`terminal`/`diff`，`locations`）在设计时就定，`presentCall` 决定"模型调用时 UI 怎么显示"。

### 7.3 事件监听插件（观察者 / 策略）

来源：`packages/guard/repeat-tool-reminder/src/index.ts`（检测 AI 重复调同一工具的死循环）

```ts
export function apply(ctx: Context, config: Config): void {
  // 状态按 agent 隔离，WeakMap 自动防泄漏
  const chains = new WeakMap<Agent, Chain>()

  ctx.on('tools/post-execute', async (exec, _result, next): Promise<PostToolDecision> => {
    const reminder = observe(exec)      // ① 自己先计数
    const downstream = await next()     // ② 接力：观察者必须委托！
    if (!reminder) return downstream    // ③ 没到阈值，原样传回
    // ④ 只"追加提醒"，不改写、不否决（Observe-and-enrich, never veto）
    return { ...downstream, additionalContexts: prependContext(reminder, downstream.additionalContexts) }
  })

  // 纯重置钩子：用户插话 → 清空计数 → 无条件 next()
  ctx.on('agent/pre-step', ({ agent, messages }, next) => {
    if (messages.some(m => m.source.kind === 'user')) chains.delete(agent)
    return next()
  })
}
```

要点：

- **waterfall 里观察者必须 `next()`**；只有拥有决策权的策略才能短路。
- 计数放在 `post-execute` 而非 `pre-execute`：被否决的调用也走同一管线，"连续敲被否决的门"正是要防的死循环。
- 参数规范化（`canonicalize`）处理输入边界：`{a:1,b:2}` 与 `{b:2,a:1}` 算同一次调用。
- **这个插件没改任何 agent-loop 代码，仅靠两个 `ctx.on` 就实现了新能力**——这就是"行为挂扩展点"的活例子。

### 7.4 Service 定义插件（abstract + 声明合并 + default export）

来源：`packages/spill/spill/src/index.ts`

```ts
// ① 声明合并：把服务 key 塞进全局 Context 类型
declare module '@deepseek-ai/cordis' {
  interface Context {
    spillStore: SpillStore
  }
}

// ② 抽象服务类：只定义"承诺什么"，不实现"怎么做"
export abstract class SpillStore extends Service {
  constructor(ctx: Context) { super(ctx, 'spillStore') }   // 字符串 key 必须与声明合并一致
  abstract saveText(input: SaveTextSpill): Promise<SpillRef>  // 整个合同就一个方法
}

// ③ 服务包默认导出服务类
export default SpillStore
```

要点：

- **服务定义刻意最小化**：只声明合同，不拥有策略（留存策略、检索、结果替换都是别的插件的事）。
- 声明合并（declaration merging）是"按 key 找服务、不 import 实现"的类型基础。
- 实现方 `extends SpillStore` 被强制实现合同方法（编译期保证）。

---

## 8. 能力缝三件套（capability seam）

### 定义

**一个完整能力 = 服务定义（Definition）+ 服务提供方（Provider）+ 使用方（Consumer）**，三者齐了才成立；只在角色独立演进时才拆分。

### spill 组的活例

| 包 | 角色 | 职责 |
|---|---|---|
| `spill/spill` | **Definition** | `abstract class SpillStore`，声明 `saveText` 合同 + `ctx.spillStore` |
| `spill/spill-local` | **Provider** | `class LocalSpillStore extends SpillStore`，把超长文本存私有文件、返回 locator |
| `spill/spill-policy` | **Consumer** | 挂在 `tools/post-execute` 瀑布上，决定"何时 spill、用预览替换模型看到的文本" |

### 三者协作链

```ts
// Definition：抽象类 + 声明合并进 ctx 类型
export abstract class SpillStore extends Service { abstract saveText(...): Promise<SpillRef> }
declare module '@deepseek-ai/cordis' { interface Context { spillStore: SpillStore } }

// Provider：继承实现（LocalSpillStore 文件见 spill-local/src/store.ts）
export class LocalSpillStore extends SpillStore {
  async saveText(input: SaveTextSpill): Promise<SpillRef> {
    const saved = await saveTextFile({ root: this.root, sessionId: input.owner.sessionId, ... })
    return { locator: SpillLocator(saved.path), bytes: saved.bytes, retrievalHint: 'Use read with offset/limit...' }
  }
}

// Consumer：不 import 实现，按 key 找服务
export const inject = ['tools']
export function apply(ctx, config) {
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    // ... 判断是否超限 ...
    const spillStore = ctx.get('spillStore')          // ← 按 key 找，谁实现都行
    const ref = await spillStore.saveText(save)        // ← 调合同方法
    // ... 用"预览 + locator 提示"替换模型看到的文本 ...
  }, { prepend: true })
}
```

### 为什么这么拆（设计道理）

1. **三者的变更原因不同**：合同变（罕见）、实现变（换后端，频繁）、消费策略变（频繁）。拆开各自演进。
2. **Consumer 不能绑架合同**：工具 schema、Loader、UI、传输、提供方特有行为都留在对应角色里，不要塞进服务定义。
3. **实现可替换**：换存储后端（本地文件 → S3），Consumer 零改动。

---

## 9. 从配置到代码的端到端闭环

```text
cordis.yml（装什么）
   │ Loader 按 name 定位包
   ▼
apply(ctx, config) ←── 函数式插件：name/inject/Config/apply
   ├─ ctx.on(事件)             → 第十三层事件：观察/拦截/追加（waterfall 必调 next()）
   ├─ ctx.tools.register(defineTool) → 给模型一个工具（四件套）
   ├─ ctx.inject([...])        → 可选依赖：拼了才有，不拼没有
   └─ 注册 Service             → abstract 类 + 声明合并 + default export

运行期：
   agent-loop 组装提示词 → 把工具 name/description/parameters 给模型
   模型调用工具 → tools/pre-execute → execute（校验→动手→记日志→返回）
   → tools/post-execute（策略/观察）→ 结果回模型 → 继续
   每次调用留痕到会话日志 → 日志 = 模型记忆 + UI + 回放的唯一真相源
```

---

## 10. 开发实操：先做什么、怎么做

### 动手前的必读顺序

1. `docs/architecture.zh.md` —— **改 `packages/` 前必须读**（工程强制）。
2. `docs/cordis-primer.zh.md` + `docs/cordis-tutorial/index.zh.md` —— Cordis 概念。
3. `docs/agent-lifecycle.zh.md` —— agent-loop 时序。
4. `docs/development.zh.md` —— 开发环境与日常流程。
5. 挑一个 `examples/` 示例 + 对应包 README 对照看。

### 按任务对号入座

| 我要做什么 | 怎么做 |
|---|---|
| 加一个工具 | 参考 `docs/cookbook/adding-a-tool.md`；实现 tool Consumer（schema + render intent + 结果处理） |
| 加一个新能力缝 | 参考 `docs/cookbook/adding-a-package.md`；做齐 Definition + Provider + Consumer 三件套 |
| 改 AI 行为 / 拦截 | 用事件：`agent/pre-step`、`agent/request`、`llm/stream`、`tools/*`（waterfall 必调 `next()`） |
| 只改配置 / 拼装 | 用 `cordis.yml` + `--patch` 覆盖；`dsh --profile web --dump-config` 看最终树 |

### 常用命令

```sh
pnpm install            # 装依赖（pnpm workspaces，node ^22.19 || >=24）
pnpm run test           # vitest 单测
pnpm run test:coverage  # CI 覆盖率门禁：packages/*/*/src 每文件 100%
pnpm run typecheck      # 类型检查
pnpm run lint           # oxlint
pnpm run build          # 构建
pnpm dsh --profile headless "任务"  # 从源码跑一次任务（需 DEEPSEEK_API_KEY）
```

### 关键提醒

- **非平凡改动必须配套 Agent Note**（`.agents/notes/`，同一 PR）。
- 包命名 `@deepseek-ai/dsh-<name>`；测试在包级 `tests/` 下，不在 `src/__tests__/`。
- `src/types.ts` 只放类型，不放运行时代码。
- README 和 JSDoc 是改动的一部分：改了行为就要同 PR 更新（`doc-sync` 门禁）。
- 文档与注释用"直接讲事实"的白话：不写"以前/现在/不再"，不写推理过程。
- 测试要按行为写，不按正确性写；改行为要同步改测试。
- 质保纪律：别在 CI 本地全量跑，挑覆盖改动的针对性检查（`dsh-pre-push-checks` 技能）。

---

## 11. 工程规则速查

（摘自根 AGENTS.md 与 packages/AGENTS.md，加粗为最容易踩的坑）

1. **注册都是副作用**：贡献一律走 `ctx.effect()` / `ctx.on()`；`register()` 返回 disposer。
2. **waterfall 监听器必须调 `next()`**，否则短路。
3. **模型可见的必须被记录**：新模型可见输入 = 新会话事件。
4. **插件而非改循环**：新行为放文档化扩展点；改 `agent-loop` 必须更新 architecture 文档。
5. **能力缝三件套完整才算能力**：不要只做一个角色。
6. **服务包 default export 类；函数插件命名导出四件套，无 default**——混用会丢注入（有 postmortem）。
7. **可选服务用 `ctx.get(name)`**；声明注入用 `ctx.<key>`。
8. **边界校验**：TypeScript 类型在 typed 同进程边界可信，不重复加运行时防御；但**模型输入、配置、文件、进程、wire 边界的输入必须校验**。
9. **误配置 fail loud**：自包含的配置错误在加载时抛错，绝不静默跳过。
10. **跨边界 id 用 branded 类型**（`Branded<B>`），不用裸 `string`。
11. **空 catch 必须命名吞掉了什么**；try 只包一条语句。
12. **开关式判别**：closed union 以 `assertNever` 收尾。
13. **发布状态只在提交点**：操作成功后才通知 / 更新派生状态；缓存、提示词、UI 回显、回放统一从一个权威源派生。
14. **边界应用到完整结果**：byte / token / item / time 限制在"完整产出值"上实施（含包装与元数据）。
15. **每个包拥有 `./invariant`**：注册 manifest 名，检查事件/数据关系。
16. **产品可见插件需要非单测的真实组合测试**（real-composition）：仅手搓 `ctx.plugin(...)` 不够。
17. **TODO/FIXME/XXX 按紧急程度区分**；文件必须以恰好一个换行结尾。
18. **标签**：一个 PR 一个 `kind/*`，所有实质 `area/*`。

---

## 12. 术语表

| 术语 | 大白话 |
|---|---|
| **harness** | 智能体框架 / 底盘 |
| **agent** | 一个"会干活的 AI 实例"，有自己的会话 |
| **agent-loop** | 驱动 agent 运转的循环（调模型→调工具→…） |
| **turn / step** | 轮次（一次输入到干完）/ 步（一次模型请求+它的工具调用） |
| **plugin** | 功能插件（函数式或 Service 子类） |
| **context（ctx）** | 服务容器，`ctx.<key>` 取服务 |
| **Service** | "承诺提供什么"的抽象（abstract class） |
| **Provider** | "具体怎么做"的实现 |
| **Consumer** | "把能力接到模型/产品"的使用方（工具、监听器） |
| **seam（能力缝）** | Definition + Provider + Consumer 的完整组合 |
| **SessionEvent / 会话日志** | 只追加的事件流，模型记忆与 UI 的唯一真相源 |
| **waterfall** | 瀑布式事件，监听器必须 `next()` 委托 |
| **projection（投影）** | 从会话日志实时折叠出的派生视图（如"当前 todo 列表"） |
| **spill** | 把超大工具结果存到外部、用预览替换，避免撑爆上下文 |
| **profile / bundle** | 具名配置组装 / 可安装的补丁层 |
| **patch（覆盖）** | 按 id 定位条目并替换其配置 |
| **render intent** | 工具输出的 UI 展示意图（generic/terminal/diff） |

---

## 附录：高价值参考文档索引

| 文档 | 内容 |
|---|---|
| `docs/architecture.zh.md` | 架构总览（改 packages/ 前必读） |
| `docs/cordis-primer.zh.md` | Cordis 五个核心概念 + 分发模式 |
| `docs/cordis-tutorial/index.zh.md` | Cordis 手把手教程 |
| `docs/agent-lifecycle.zh.md` | agent-loop 时序图 |
| `docs/capability-seams.zh.md` | 能力缝定义与拆分原则 |
| `docs/testing.zh.md` | 测试策略（单测/e2e/快照/覆盖率门禁） |
| `docs/cookbook/adding-a-tool.md` | 如何加一个工具 |
| `docs/cookbook/adding-a-package.md` | 如何加一个新包 |
| `packages/README.zh.md` | 所有包分组地图（对应上文第 6 节） |
| `.agents/notes/README.md` | Agent Notes 的写法与归档规则 |