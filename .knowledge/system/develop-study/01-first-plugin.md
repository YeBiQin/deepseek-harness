# 第 1 篇：第一个插件

本篇创建一个最小的 Harness 插件，并通过 `cordis.yml` Overlay 将它加载到 Web profile 中。完成后，你可以解释插件入口、依赖声明、注册清理和三种插件写法之间的关系。

## 本篇目标

学完本篇，你将能够：

1. 说明插件为什么以 `apply(ctx)` 作为入口。
2. 创建本地插件，并用 Overlay 将它加入实际的 Web profile。
3. 用终端日志和 `--dump-config` 验证插件确实被组合和激活。
4. 判断哪些资源由 Cordis 自动清理，哪些资源必须交给 `ctx.effect()`。
5. 用 `inject` 声明硬依赖，并区分依赖声明与启动顺序。
6. 在函数、对象和 `Service` 类三种形态之间做出选择。

## 前置条件和配套工程

- 已在仓库根目录完成安装，并能运行 `pnpm dsh web`。
- 已阅读[模块一：全局认知与 Cordis 插件模型](../module-1-global-and-cordis.md)的启动链路部分。
- 示例文件位于仓库中的 [`scratch-plugin`](../../../scratch-plugin)。所有命令都从仓库根目录执行。

## 1. 插件是什么

### 1.1 要解决的问题

Harness 是一个可扩展的 Agent harness。增加功能时，插件应当挂载到运行时，而不是要求开发者修改 Agent Loop 或内置 Profile 的源码。

### 1.2 最小定义

在 Harness 中，插件是一个导出 `apply` 函数的 TypeScript 模块。Loader 挂载插件并满足它声明的依赖后，调用 `apply(ctx)`；插件通过 `ctx` 注册服务、事件、工具或其他可管理资源。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'

export function apply(ctx: Context) {
  // Register capabilities here.
}
```

这个例子中有三个关键事实：

| 代码 | 作用 |
|---|---|
| `import type { Context } ...` | 只导入 TypeScript 类型，不在运行时生成模块依赖。 |
| `export const name = 'my-plugin'` | 为插件提供诊断名称；它不是入口函数本身。 |
| `export function apply(ctx: Context)` | 插件被激活时由 Loader 调用的入口。 |

`import` 只说明模块可以被解析，不代表插件已经进入运行时。只有配置条目被 Loader 挂载、依赖满足并执行 `apply()`，插件的注册才会生效。

### 1.3 加载流程

```text
dsh web
  → Profile / Bundle / Patch 组合配置
  → Loader 解析并挂载 entry
  → 创建插件 fiber
  → 等待 inject 声明的服务可用
  → apply(ctx)
  → Service / Event / Tool 注册
```

这里的 `fiber` 是一个已加载插件实例的运行时句柄，负责记录插件状态、子插件和清理动作。插件文件被 import 与插件实例被激活是两个不同阶段；只有后者才会执行 `apply()`。

完整启动链路见[模块一](../module-1-global-and-cordis.md)，Cordis 的插件定义见[`docs/cordis-tutorial/01-first-plugin.zh.md`](../../../docs/cordis-tutorial/01-first-plugin.zh.md)。

## 2. 创建本地练习目录

### 2.1 操作

在仓库根目录执行：

```sh
mkdir -p scratch-plugin/src
```

`scratch-plugin` 是隔离练习目录；`src/` 保存 TypeScript 源码，Overlay 配置放在同级目录。仓库根目录很重要，因为后续 `pnpm dsh` 命令和相对的 `--patch` 参数都以它为基准。

### 2.2 结果

```text
scratch-plugin/
└── src/
```

目录已存在时，`mkdir -p` 不会报错，所以可以重复执行。

## 3. 编写并观察插件文件

### 3.1 让加载产生证据

将 [`scratch-plugin/src/my-plugin.ts`](../../../scratch-plugin/src/my-plugin.ts) 写成下面的形态：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello-plugin'

export function apply(ctx: Context) {
  console.log('[hello-plugin] plugin loaded!')
}
```

在当前练习工程中，示例文件可能额外把 `ctx` 作为调试参数打印出来；验证时只需检查日志包含 `[hello-plugin] plugin loaded!` 前缀。

### 3.2 为什么日志放在 `apply()` 中

模块顶层代码在 `import` 时执行；`apply()` 内的代码则在插件实例被 Loader 挂载、依赖满足后执行。因此 `apply()` 内的日志才是“插件已激活”的证据，而不是“文件可以被找到”的证据。

### 3.3 逐行检查

| 代码 | 需要记住的事实 |
|---|---|
| `import type` | 只影响编译期类型，不负责把插件加入运行时。 |
| `name` | 方便 Loader、日志和诊断识别插件；它不能替代配置条目的 `id`。 |
| `apply(ctx)` | 只在插件被激活后执行；插件提供的注册应从这里开始。 |
| `console.log(...)` | 这是本练习的可观察证据，不是生产插件必须提供的能力。 |

## 4. 用 `cordis.yml` 注册本地插件

### 4.1 创建 Overlay

在仓库根目录运行 `pwd`，取得绝对路径，然后将 [`scratch-plugin/cordis.yml`](../../../scratch-plugin/cordis.yml) 写成：

```yaml
- insert:
    - id: hello
      name: '/absolute/path/to/deepseek-harness/scratch-plugin/src/my-plugin.ts'
```

把 `name` 替换为你自己的绝对路径。示例中 `/absolute/path/to/deepseek-harness` 只是占位符，不应原样复制。

### 4.2 逐行理解

| 配置 | 含义 |
|---|---|
| `- insert:` | 向最终 entry list 插入一项配置。 |
| `id: hello` | 这条插件配置在组合树中的标识；覆盖已有条目时按它匹配。 |
| `name: '...'` | Loader 要解析和导入的插件模块路径。 |

### 4.3 为什么使用绝对路径

Overlay 只贡献配置，不改变 Loader 解析模块名称时使用的 profile 目录。相对路径会相对于 Loader 的解析基准计算，而不是相对于 `cordis.yml` 所在目录计算；因此把练习文件写成绝对路径，才能让 Overlay 在当前 Profile 下稳定定位本地模块。

这个规则不是所有 Bundle 的通用规则：已安装的 Bundle 在自己的 Patch 中通常用包名，例如 `name: dsh-hello-plugin`，由 Node 的包解析机制定位模块。两种场景不要混用。

## 5. 启动和验证

### 5.1 启动真实 Web profile

从仓库根目录执行：

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

预期是终端出现包含 `[hello-plugin] plugin loaded!` 的日志，并启动 Web 服务。日志的意义是：`--patch` 被读取、配置被组合、模块被加载、`apply()` 被调用。

### 5.2 先查看组合结果

如果只想验证 Overlay 是否插入成功，可以不启动服务：

```sh
pnpm dsh --profile web --dump-config --patch ./scratch-plugin/cordis.yml
```

输出中应包含 `hello` 条目。`--dump-config` 只能证明配置被组合，不能单独证明插件已经执行 `apply()`；执行证据仍来自启动日志或运行行为。

如果日志没有出现，按这个顺序检查：Overlay 是否被 `--patch` 传入，`hello` 条目是否出现在 `--dump-config`，模块绝对路径是否指向当前 checkout，以及插件是否因缺少 `inject` 依赖而处于 `PENDING`。不要先在 `apply()` 中添加大量判空代码；先确认配置和依赖事实。

## 6. 自动清理和 `ctx.effect()`

### 6.1 哪些注册会自动清理

通过 Cordis API 建立的注册属于插件生命周期。例如 `ctx.on(event, listener)` 的监听器、`ctx.plugin(child)` 挂载的子插件，以及 Harness 注册表返回的工具或 Adapter 注册，都会附着在所属插件的 Effect 上；插件卸载时框架撤销这些注册。

定时器、WebSocket、文件监听和原生进程等资源不一定由 Cordis 直接拥有。插件必须显式告诉框架如何释放这些资源。

### 6.2 最小 Effect

```ts
import type { Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context) {
  ctx.effect(() => {
    const timer = setInterval(() => {
      console.log('heartbeat')
    }, 5000)

    return () => clearInterval(timer)
  })
}
```

Effect 的主体在插件激活时运行，返回的 disposer 在插件卸载时运行。资源由插件创建，也应由同一个插件的 disposer 释放；调用者不需要知道这个资源的内部清理方式。

### 6.3 一个完整的子插件示例

下面的例子同时展示了子插件、定时器和主动卸载：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'lifecycle-demo'

function heartbeat(ctx: Context) {
  console.log('heartbeat plugin loading')
  ctx.effect(() => {
    const timer = setInterval(() => console.log('tick'), 200)
    return () => {
      clearInterval(timer)
      console.log('heartbeat cleaned up')
    }
  })
}

export function apply(ctx: Context) {
  const fiber = ctx.plugin(heartbeat)
  ctx.effect(() => {
    const timer = setTimeout(async () => {
      await fiber.dispose()
      console.log('disposed')
      process.exit(0)
    }, 700)
    return () => clearTimeout(timer)
  })
}
```

运行这个示例时，输出会包含 `heartbeat plugin loading`、若干次 `tick`、`heartbeat cleaned up` 和 `disposed`。`ctx.plugin(heartbeat)` 返回子插件 fiber；`fiber.dispose()` 会等待子插件清理完成，并递归处理它挂载的子插件。

### 6.4 清理顺序

disposer 按注册顺序的逆序启动，但多个异步 disposer 可能并发运行。如果资源必须按严格顺序关闭，应把依赖的关闭步骤放在同一个 disposer 中并显式依次等待。

插件 fiber 通常会经历以下状态：

```text
PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
                 ↘ FAILED
```

`PENDING` 表示依赖尚未满足，`FAILED` 表示激活或配置校验失败，`UNLOADING` 和 `DISPOSED` 表示清理过程及完成状态。完整生命周期语义见[`docs/cordis-tutorial/02-lifecycle-and-effects.zh.md`](../../../docs/cordis-tutorial/02-lifecycle-and-effects.zh.md)和[模块二](../module-2-plugin-lifecycle.md)。

### 6.5 常见的生命周期误区

- 把 `import` 当成插件激活：模块可解析不等于 entry 已挂载。
- 把所有资源都交给手写 disposer：`ctx.on()`、工具注册和子插件挂载已经由 Cordis 管理，重复清理可能造成所有权混乱。
- 只清理父插件而忘记子插件：使用 `ctx.plugin()` 获得的 fiber 应属于父插件，父插件卸载时应让它递归清理。
- 在 disposer 中依赖另一个异步 disposer 已完成：多个异步 disposer 可能并发，严格顺序必须放进同一个清理函数中。

## 7. 用 `inject` 声明依赖

### 7.1 为什么需要声明

`ctx.tools`、`ctx.llm` 和 `ctx.agents` 都是由其他插件提供的 Service。消费方不应猜测这些 Service 的激活顺序，也不应在自己的 `apply()` 中偷偷创建另一个实现。

### 7.2 基本写法

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-tool-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(/* ... */)
}
```

`inject` 表达的是“我需要哪些服务”，不是全局启动顺序。Loader 会让插件保持 `PENDING`，直到列出的服务存在，然后才调用 `apply()`；因此 `ctx.tools` 在该入口中可以按声明使用。

多个硬依赖可以并列声明：

```ts
export const inject = ['tools', 'llm']
```

### 7.3 可选依赖

如果某项能力缺失时插件仍然可以运行，就不要把它写成硬依赖；应按项目已有的可选 Service 模式探测：

```ts ignore-check
export function apply(ctx: Context) {
  const greeter = ctx.get('greeter')
  console.log(greeter?.greet('maybe') ?? 'no greeter available')
}
```

可选依赖不能用来掩盖必需服务缺失。若插件没有 `tools` 就无法完成自身职责，应使用 `inject: ['tools']`，让 Loader 负责等待或报告配置问题。

### 7.4 运行期间的依赖变化

`inject` 不是只在启动时检查一次。如果提供方在运行期间被卸载或热替换，依赖它的插件也会卸载；服务恢复后，消费方可以按依赖关系重新激活。Effect 清理保证消费方不会继续保留对已消失服务的注册和资源引用。

服务的定义、提供和消费见[`docs/cordis-tutorial/03-services.zh.md`](../../../docs/cordis-tutorial/03-services.zh.md)。

### 7.5 用一个问题检查理解

如果插件模块已经被 TypeScript import，但 `ctx.tools` 还没有挂载，这个插件能不能安全调用 `ctx.tools.register()`？不能。正确做法是声明 `inject: ['tools']`，由 Loader 在 Service 可用后激活插件；不要在 Consumer 中自行创建第二个 `ToolRuntime`。

## 8. 三种插件形态

### 8.1 对照表

| 形态 | 本质 | 适用场景 |
|---|---|---|
| 函数 | 独立导出 `name`、`inject` 和 `apply` | 默认选择；注册工具、事件或普通能力 |
| 对象 | 默认导出 `{ name, inject, apply }` | 想把元数据和入口集中管理 |
| 类 | 默认导出 `Service` 子类 | 插件需要向其他插件提供 Service |

### 8.2 对象形式

```ts
import type { Context } from '@deepseek-ai/cordis'

export default {
  name: 'my-plugin',
  inject: ['tools'],
  apply(ctx: Context) {
    // Register capabilities here.
  },
}
```

对象形式和函数形式表达相同的插件元数据，选择它主要是代码组织问题。它不会自动把普通对象变成 Service。

### 8.3 类形式和 Service

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

export default class MyService extends Service {
  static inject = ['tools']

  constructor(ctx: Context) {
    super(ctx, 'myService')
  }
}
```

`Service` 子类通过 `super(ctx, 'myService')` 将实例以 `myService` 注册到 `ctx`。其他插件可以声明 `inject: ['myService']` 并使用这个服务。

运行时注册和编译期类型安全是两个问题。提供自定义 Service 时，消费方通常还需要通过 TypeScript 声明合并补充 `Context` 类型：

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    metrics: MetricsService
  }
}
```

声明合并不会生成运行时代码；它只让 `ctx.metrics` 获得类型。真正的 Service 实例仍需在运行时挂载。

### 8.4 选择逻辑

- 只想注册工具、监听事件或执行安装动作时，使用函数形式。
- 只想集中整理元数据时，可以使用对象形式。
- 需要让其他插件消费一个具名稳定能力时，使用 `Service` 类，并补齐运行时注册、类型声明和生命周期。

## 9. 动手练习

### 练习 A：确认 Overlay 和激活是两件事

先运行 `--dump-config`，再启动 Web profile，分别记录“配置中出现 `hello`”和“终端出现加载日志”的证据。解释为什么第一条证据不能替代第二条。

### 练习 B：观察硬依赖

把插件改成 `inject: ['tools']`，然后在 `apply()` 中访问 `ctx.tools`。临时移除提供 `tools` 的配置，观察插件是否提前执行、报错或保持 `PENDING`，再用 Cordis 服务文档解释结果。

### 练习 C：观察 Effect 清理

注册一个短周期定时器并用 `ctx.effect()` 返回清理函数。修改配置触发 HMR，确认旧插件不再继续输出。重点记录资源创建者、disposer 所属 fiber 和清理发生的时机。

## 10. 下一步

完成本篇后，继续[第 2 篇：开发一个工具](02-build-a-tool.md)，把 `inject: ['tools']` 用在第一个真实模型能力上；如果要深入插件状态和事件调度，转到[模块二：Cordis 插件与生命周期](../module-2-plugin-lifecycle.md)。

## 本篇小结

- 插件是由 Loader 激活的 TypeScript 模块，`apply(ctx)` 是运行时入口。
- Overlay 插入本地插件时使用绝对模块路径；已安装 Bundle 通常使用包名。
- `--dump-config` 验证组合结果，`apply()` 内日志验证激活结果。
- Cordis 注册属于插件生命周期；定时器、连接等外部资源必须用 `ctx.effect()` 登记 disposer。
- `inject` 声明硬依赖并决定激活时机，不是 YAML 行顺序。
- 函数形式是默认选择；需要提供具名 Service 时再使用类形式。

## 术语表

| 术语 | 含义 |
|---|---|
| Plugin | 由 Loader 挂载、导出 `apply` 入口的扩展模块。 |
| `apply` | 插件激活后由框架调用的安装入口。 |
| `Context` | 插件访问 Service、Event 和生命周期 API 的上下文。 |
| fiber | 已加载插件实例的运行时句柄。 |
| Overlay / Patch | 叠加到 Profile 上的配置层。 |
| Effect | 将资源注册与 disposer 绑定到插件生命周期的机制。 |
| `inject` | 插件声明必需 Service 的导出字段。 |
| disposer | 在插件卸载时释放资源或撤销注册的函数。 |

## 参考资料

- [`docs/user/develop/basic/index.zh.md`](../../../docs/user/develop/basic/index.zh.md)：第一个 Harness 插件。
- [`docs/cordis-tutorial/02-lifecycle-and-effects.zh.md`](../../../docs/cordis-tutorial/02-lifecycle-and-effects.zh.md)：生命周期和 Effect。
- [`docs/cordis-tutorial/03-services.zh.md`](../../../docs/cordis-tutorial/03-services.zh.md)：Service 与依赖。
- [`docs/architecture.zh.md`](../../../docs/architecture.zh.md)：Profile、Bundle、Patch 和扩展点。

下一篇：[第 2 篇：开发一个工具](02-build-a-tool.md)。
