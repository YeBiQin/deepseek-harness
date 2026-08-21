# 第 2 篇：开发一个工具

本篇在第一个插件的基础上注册一个 `greet` 工具，让模型在 Web UI 中按需调用它。重点不是把一个函数接入按钮，而是理解工具的模型契约、参数校验、规范返回值、执行策略和 UI 展示之间的分工。

## 本篇目标

学完本篇，你将能够：

1. 说明工具为什么是面向模型的可调用能力。
2. 使用 `defineTool` 声明名称、描述、参数、输出和执行逻辑。
3. 解释 `parameters` 如何参与参数校验和 TypeScript 类型推导。
4. 区分 `execute()` 返回的规范值、`output.render()` 生成的模型内容和 UI 卡片。
5. 从 Web UI 的真实 Tool Call 验证工具，而不是只直接调用执行函数。
6. 知道参数语义校验、取消信号、错误处理和纯展示方法的边界。

## 前置条件

- 已完成[第 1 篇：第一个插件](01-first-plugin.md)，并保留 [`scratch-plugin`](../../../scratch-plugin)。
- 已理解 `inject: ['tools']` 表达的服务依赖。
- 真实模型调用需要可用的 `DEEPSEEK_API_KEY`；没有密钥时可以先完成代码阅读、配置组合和包测试。

## 1. 工具是什么

### 1.1 要解决的问题

第一个插件只在激活时输出日志，模型没有办法使用它。若希望模型根据对话内容主动调用一项能力，就需要把这项能力注册到 `ctx.tools`，并把调用方式描述给模型。

工具是注册进 Harness、由模型根据名称、描述和参数 Schema 决定是否调用的能力。普通函数由程序员直接调用；工具还必须暴露模型可理解的调用契约，并把执行结果转换成模型能消费的内容。

### 1.2 工具在运行时的位置

```text
模型看到 name / description / parameters
  ↓
工具注册表 ctx.tools
  ↓ 参数校验与策略处理
execute(args, exec)
  ↓ 规范值校验与冻结
output.render(args, value)
  ↓
Session 工具结果 / 模型上下文 / UI 展示
```

工具的注册、策略钩子、后台任务和 UI 卡片的完整约定见[`docs/cookbook/adding-a-tool.zh.md`](../../../docs/cookbook/adding-a-tool.zh.md)；本篇只保留第一个工具必须掌握的部分。

## 2. 注册 `greet`

### 2.1 修改插件文件

将 [`scratch-plugin/src/my-plugin.ts`](../../../scratch-plugin/src/my-plugin.ts) 替换为：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'greet-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: {
      name: { type: 'string', required: true, description: 'The name to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}!`
    },
  }))
}
```

`inject` 保证 `ctx.tools` 在 `apply()` 执行前可用。`ctx.tools.register()` 返回的注册属于插件 Effect；插件卸载时，工具会从注册表移除。

### 2.2 从插件到 Tool Call

模型先在系统提示词中看到工具的名称、描述和参数 Schema，然后生成类似下面的调用：

```json
{
  "name": "greet",
  "arguments": { "name": "Ada" }
}
```

这不是 Web 客户端直接调用 `execute()` 的结果。真正的调用会经过工具注册表的参数校验、策略事件、执行函数、结果校验和 Session 记录。

## 3. `defineTool` 的五个部分

| 字段 | 作用 | 主要消费者 |
|---|---|---|
| `name` | 工具标识；模型调用时使用 | 模型、工具注册表、Code Mode |
| `description` | 说明工具用途和适用时机 | 模型 |
| `parameters` | 入参类型、必填性和描述 | 模型、运行时校验、TypeScript 推导 |
| `output` | 规范返回值的 Schema 和模型渲染器 | 注册表、模型、程序化调用方 |
| `execute(args, exec)` | 接收校验后的参数并执行能力 | 工具运行时 |

### 3.1 `name`：稳定的调用标识

`name` 是模型生成 Tool Call 时使用的标识，也会出现在工具注册表、Session 工具事件和 Code Mode 的调用入口中。它应当稳定、能表达能力，不要用只对实现者有意义的临时变量名。

### 3.2 `description`：帮助模型做选择

描述不是给 UI 开发者看的注释，而是模型选择工具时使用的信息。它至少应说明工具做什么，以及什么情况下适合调用。描述过于笼统时，模型可能在不该调用的场景使用它；描述过于宽泛也不能替代参数 Schema 和执行期校验。

### 3.3 `parameters`：入参契约

`parameters` 描述工具需要的参数。`greet` 声明 `name` 是必填字符串，因此模型应当生成 `{ "name": "Ada" }`，而不是省略该字段或传入数字。

### 3.4 `output`：规范值和模型渲染

`output.schema` 声明 `execute()` 返回的规范值类型；`output.render()` 将规范值转换成模型可见的消息内容。两者一起表达“程序拿到什么”和“模型看到什么”，但不是同一个值的两个字符串版本。

### 3.5 `execute(args, exec)`：真正的能力动作

`execute()` 接收已经通过结构校验的 `args`，执行实际工作并返回符合 `output.schema` 的值。`exec` 还携带执行身份和取消信号；长时间运行的 I/O 应按约定使用 `exec.signal`。

## 4. 参数校验和类型推导

### 4.1 框架负责的结构约束

`defineTool` 根据 `parameters` 在 `execute()` 运行前校验模型生成的 `arguments`。它可以处理类型、必填键、字面量约束、联合分支和嵌套值；`execute(args)` 中的 `args` 类型也从同一个 Schema 推导。

因此 `greet` 的 `args.name` 在 TypeScript 中是 `string`，不需要再写一份 `{ name: string }` 类型，也不需要为了满足静态检查给它加类型断言。

### 4.2 仍由工具负责的语义约束

Schema 只能表达它支持的结构性约束。非空字符串、正数、文件必须存在或两个字段必须满足某种关系等语义约束，仍由 `execute()` 或所属能力自行检查。

例如，`required: true` 只保证 `name` 存在且满足字符串类型，不保证它不是空字符串：

```ts
async execute(args) {
  if (!args.name.trim()) throw new Error('name must not be empty')
  return `Hello, ${args.name}!`
}
```

不要把结构校验已经保证的事实重复写成防御性分支；只补充 Schema 无法表达、但领域行为确实需要的约束。

## 5. 规范值与模型内容分离

### 5.1 为什么不能让 `execute()` 直接返回 UI 或话术

同一个工具结果可能被多个消费者使用：模型需要自然语言或结构化消息，Code Mode 需要稳定的 JSON 值，Session 需要可回放的事实，UI 需要调用卡片或 Diff。如果 `execute()` 直接返回一段为 UI 编排的文本，其他消费者就必须从文本中解析 id、字段和状态。

正确的分工是：

```text
execute(args)
  → 返回规范 JSON 值
output.schema
  → 校验和描述这个值
output.render(args, value)
  → 转换为模型可见内容
presentCall / presentResult
  → 转换为 UI 展示意图
```

### 5.2 `greet` 的闭环

对于输入 `Ada`，调用过程是：

1. 模型生成 `greet({ name: 'Ada' })`。
2. 注册表根据 `parameters` 校验参数。
3. `execute(args)` 返回规范值 `"Hello, Ada!"`。
4. 注册表根据 `output.schema` 校验并冻结规范值。
5. `output.render()` 返回 `[{ type: 'text', text: 'Hello, Ada!' }]`。
6. 工具结果写入 Session，并作为模型下一轮上下文的一部分。

`output.render()` 可以随着模型展示需求变化而调整，而不必改变 `execute()` 的程序化结果。

## 6. 运行并验证

### 6.1 启动 Web profile

从仓库根目录启动：

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

打开 `http://127.0.0.1:3080`，输入：

```text
Use the greet tool to greet Ada.
```

有可用模型时，预期是模型发起 `greet` 调用，并收到 `Hello, Ada!` 的工具结果。验证重点是：工具调用由模型根据工具描述决定，参数通过 `parameters` 校验，结果通过 `output.render()` 返回模型。

### 6.2 分层验证

如果只想验证插件条目是否被组合，可以先运行：

```sh
pnpm dsh --profile web --dump-config --patch ./scratch-plugin/cordis.yml
```

这只能证明配置被组合，不能证明模型真的调用了工具。没有 API Key 时，可以依次验证：

1. `--dump-config` 中出现 `greet-tool` 条目。
2. 工具插件在 `apply()` 中成功注册，不因缺少 `tools` 而提前执行。
3. 工具包测试覆盖参数、输出和执行失败路径。
4. 现有 Keyless Snapshot 通过真实示例回放模型可见结果。

## 7. 工具执行的进阶边界

以下规则来自[工具编写参考](../../../docs/cookbook/adding-a-tool.zh.md)，它们是从第一个工具开始就应该知道的边界。

| 规则 | 说明 |
|---|---|
| 参数已完成结构校验 | `execute()` 不必重复检查类型和必填字段，但必须处理 Schema 无法表达的业务约束。 |
| 返回规范 JSON 值 | 不要返回专供 UI 使用的卡片或终端围栏，让 `output.render()` 和展示投影负责转换。 |
| 异常表示失败 | 基础设施故障应抛异常；成功但结果不理想的领域状态应写入规范值。 |
| 遵守 `exec.signal` | 长任务收到取消信号时应停止进行中的工作。 |
| 注册借用只读定义 | 注册后不要修改 Schema 或替换回调；热替换应卸载旧插件后重新注册。 |
| 将模型可见事实写入 Session | 新的模型可见输入或结果必须能从日志重建。 |

工具运行时还会保护调用身份、物化参数和规范输出。普通同进程 Consumer 不需要为 TypeScript 已经保证的类型添加重复的运行时 hostile-input 分支；模型生成的 JSON、持久化数据和进程边界仍必须按各自的解析规则校验。

## 8. 工具策略流水线

工具执行不是只有 `execute()`。策略插件可以在不修改工具主体的情况下参与调用：

```text
Tool Call
  → tools/pre-execute     允许、拒绝或请求审批
  → tools/execute         包装并运行执行器
  → tools/post-execute    处理结果或阻止结果
  → tools/result          观察最终规范结果
  → tool/result            持久化工具结果
```

`tools/pre-execute` 适合可扩展的允许、拒绝和询问策略；`ctx.tools.guard()` 适合设置后续监听器不能撤销的最终拒绝；`tools/execute` 适合截止时间、重试或指标包装；`tools/post-execute` 适合改变展示、替换结果或附加模型可见上下文；`tools/result` 只观察不可变的归一化结果。

工具主体不应把部署策略硬编码进每个 `execute()`。先使用现有事件扩展点，再考虑修改工具实现。各事件的输入、顺序、返回值和失败语义以[`packages/core/tools/README.md`](../../../packages/core/tools/README.md)为准。

## 9. UI 卡片和模型内容是不同通道

`output.render()` 只负责模型可见内容。工具 UI 卡片通过可选的 `presentCall`、`presentResult` 和 `presentationMeta` 生成：

- `presentCall(args)` 可以返回 `generic`、`terminal` 或 `diff` 等调用期卡片。
- `presentResult(args, result)` 可以把已完成的结果展示为通用结果、终端输出、Diff、搜索结果或 Web 结果。
- `presentationMeta(args, value)` 可以从规范值派生可持久化、可回放的卡片数据。

展示方法必须是纯函数：不做 I/O，不读取会话状态，不依赖时钟或随机数。实时渲染和 Session 回放都可能调用它们；展示逻辑依赖外部状态时，回放就无法稳定重建。

UI 格式不应进入模型结果。` ```console ` 围栏、Diff、相对化路径和卡片字段属于展示投影，不应为了方便 UI 而混入规范值或 `output.render()` 的消息。

没有展示方法的工具会回退到通用卡片，通常使用工具名作为标题、原始参数作为输入。`greet` 使用这种回退属于正常行为。

## 10. 与第一个插件的关系

| 第 1 篇：Hello Plugin | 第 2 篇：Greet Tool |
|---|---|
| `name = 'hello-plugin'` | `name = 'greet-tool'` |
| 没有 `inject` | `inject = ['tools']` |
| `apply()` 输出日志 | `apply()` 注册 `defineTool(...)` |
| 验证插件被加载 | 验证模型调用工具并接收结果 |
| 不提供模型能力 | 提供模型可调用的工具能力 |

从第一个插件到第一个工具，新增的不是另一种插件机制，而是使用已有的 `tools` Service，并遵守工具自己的输入、输出、执行和展示约定。

## 本篇小结

- 工具是面向模型的可调用能力，注册到 `ctx.tools`。
- `defineTool` 同时声明模型描述、输入校验、规范输出和执行逻辑。
- `parameters` 负责结构约束；Schema 无法表达的业务约束仍由执行逻辑负责。
- `execute()` 返回规范值，`output.render()` 负责模型可见内容，UI 展示另行设计。
- 工具会经过策略事件和 Session 结果记录，不能只把它理解成一个 `execute()` 函数。
- 模型调用应通过真实 Web/Headless 入口验证，而不是只直接调用 `execute()`。

## 术语表

| 术语 | 含义 |
|---|---|
| Tool | 注册到工具运行时、由模型按需调用的能力。 |
| `defineTool` | 声明工具名称、参数、输出和执行器的 DSL。 |
| `parameters` | 输入参数的结构 Schema，同时参与运行时校验和类型推导。 |
| 规范值 | `execute()` 返回、符合 `output.schema` 的程序化结果。 |
| `output.render` | 将规范值转换为模型可见内容的函数。 |
| `presentCall` / `presentResult` | 将调用或结果投影为 UI 卡片的纯函数。 |
| `exec.signal` | 用于取消进行中工具工作的 AbortSignal。 |

## 参考资料

- [`docs/user/develop/basic/tool.zh.md`](../../../docs/user/develop/basic/tool.zh.md)：官方最小工具教程。
- [`docs/cookbook/adding-a-tool.zh.md`](../../../docs/cookbook/adding-a-tool.zh.md)：工具参数、策略、后台任务和 UI 展示的完整参考。
- [模块五：能力缝隙与工具扩展](../module-5-capability-and-tools.md)：工具和 Service Provider 的架构阅读路线。
- [`packages/core/tools/README.md`](../../../packages/core/tools/README.md)：工具运行时扩展点。

下一篇：[第 3 篇：插件配置](03-plugin-config.md)。
