# DeepSeek Harness 学习与梳理指南

本文是一份面向初学者的当前工程学习教程，目标是让读者先建立运行时全局观，再沿着一条真实 Agent 请求链阅读源码，最后能够编写插件、工具和测试。

## 1. 学习目标和阅读边界

完成本指南后，应能说明 `dsh` 如何启动插件树、`Agent` 如何驱动一次 Turn、`Session` 如何成为模型上下文的来源、工具如何经过策略流水线执行，以及 Web、Headless、ACP 和 SDK 如何复用同一套核心能力。

本指南只描述当前仓库中已经存在的结构和扩展点；后续功能规划统一放在 [`../features/README.md`](../features/README.md)。

## 2. 先建立全局认知

### 2.1 项目定位

DeepSeek Harness 是一个基于 Cordis 的 Agent harness：它把模型适配器、会话日志、Prompt 组装、工具注册、权限、文件系统、Shell、子进程、持久化、UI 和外部协议组合成可替换的插件树。

它不是只有一个聊天页面的单体应用，也不是单纯的 LLM SDK；它负责 Agent 的生命周期、工具执行、会话恢复、运行时策略和多个调用入口。

项目总体架构以 [`../../docs/architecture.zh.md`](../../docs/architecture.zh.md) 为准，项目介绍和运行方式见 [`../../README.zh.md`](../../README.zh.md)。

### 2.2 目录地图

| 目录 | 主要职责 |
|---|---|
| [`../../apps/cli`](../../apps/cli) | `dsh` 命令行入口、参数解析和 Profile 启动 |
| [`../../packages/boot`](../../packages/boot) | 应用启动、Profile 解析、Patch 组合和生命周期管理 |
| [`../../packages/bundle`](../../packages/bundle) | Base、Web、Headless 等可复用插件组合层 |
| [`../../packages/core`](../../packages/core) | Session、Prompt、Tools、Agent 和默认 Agent Loop |
| [`../../packages/llm`](../../packages/llm) | LLM 服务、消息类型、流式协议和模型 Provider |
| [`../../packages/fs`](../../packages/fs) | 文件系统服务、本地实现、策略和模型工具 |
| [`../../packages/shell`](../../packages/shell) | Bash、PowerShell、Shell 工具和执行环境 |
| [`../../packages/subprocess`](../../packages/subprocess) | 子进程启动、输出读取和进程树管理 |
| [`../../packages/sandbox`](../../packages/sandbox) | 文件效果模式、进程约束和权限策略 |
| [`../../packages/session`](../../packages/session) | JSONL、SQLite、投影、标题和遥测等持久化周边 |
| [`../../packages/client`](../../packages/client) 与 [`../../packages/host`](../../packages/host) | Web 浏览器端和服务端能力 |
| [`../../packages/acp`](../../packages/acp) 与 [`../../packages/sdk`](../../packages/sdk) | 自动化协议和进程外 SDK |
| [`../../examples`](../../examples) | 可运行的 Cordis 配置和集成示例 |
| [`../../vendor`](../../vendor) | Vendored Cordis 及其依赖源码；初学阶段只在需要理解框架行为时阅读 |

### 2.3 五个基础术语

| 术语 | 白话解释 | 在工程中的表现 |
|---|---|---|
| Plugin | 一段由 Cordis 加载的可插拔代码 | 导出 `apply(ctx)` 的模块 |
| Context | 插件访问服务和事件的上下文 | `ctx.agents`、`ctx.sessions`、`ctx.tools`、`ctx.llm` |
| Service | 向其他插件提供稳定能力的运行时对象 | `SessionStore`、`AgentRegistry`、`LlmRuntime` |
| Event | 插件观察、拦截或协作的通信点 | `agent/request`、`session/event`、`tools/execute` |
| Effect | 带卸载函数的注册或资源生命周期 | `ctx.effect()`、`ctx.on()`、工具注册 |

Cordis 的依赖注入、事件模式和可逆注册见 [`../../docs/cordis-primer.zh.md`](../../docs/cordis-primer.zh.md)。

## 3. 环境准备和第一次运行

### 3.1 基础知识

先掌握 TypeScript 类型、Promise、`async/await`、AsyncIterator、Node.js ESM、HTTP/JSON、SSE、YAML 和 Git 基础；不需要先学完所有 React 或操作系统细节。

### 3.2 安装和构建

在仓库根目录执行：

```sh
pnpm install
pnpm run typecheck
pnpm run build
```

Node.js 版本要求、构建面和日常命令见 [`../../docs/development.zh.md`](../../docs/development.zh.md)。真实模型演示需要 `DEEPSEEK_API_KEY`；没有 Key 时先使用单元测试和 Keyless Snapshot。

### 3.3 查看实际插件树

```sh
pnpm dsh --profile web --dump-config
```

这个命令比直接阅读大量 YAML 更适合初学者，因为它展示当前 Profile 经过 Bundle、Profile Patch、用户 Patch 和 Overlay 组合后的实际配置。

### 3.4 运行第一个本地插件

仓库已经提供 `scratch-plugin` 和一组开发入门教程。先阅读[插件开发学习路线](develop-study/README.md)，再执行：

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

然后按[第一个插件](develop-study/01-first-plugin.md)和[开发一个工具](develop-study/02-build-a-tool.md)添加并验证最小 `greet` 工具；官方教程用于查阅完整约定。

## 4. 六阶段学习路线

### 阶段一：理解 Cordis 插件模型

目标是能够解释 `apply(ctx)`、`inject`、Service、Event、`ctx.effect()` 和 HMR 清理，不要求理解 Agent Loop。

阅读顺序是 [`../../docs/cordis-primer.zh.md`](../../docs/cordis-primer.zh.md) → [第一个插件](develop-study/01-first-plugin.md) → [`../../docs/user/develop/basic/config.zh.md`](../../docs/user/develop/basic/config.zh.md)。

练习是修改 `scratch-plugin/src/my-plugin.ts`，让它声明 `inject`、注册一个事件监听器，再用 `ctx.effect()` 创建和清理一个定时器。

阶段产物是一页术语表和一张“插件依赖 → 服务 → 注册 → 卸载”的小图。

### 阶段二：理解命令行、Profile 和 Bundle

目标是知道 `dsh web` 到底加载了哪些插件，以及配置层如何叠加。

阅读顺序是 [`../../apps/cli/src/bin.ts`](../../apps/cli/src/bin.ts) → [`../../apps/cli/src/profile-boot.ts`](../../apps/cli/src/profile-boot.ts) → [`../../packages/boot/app-boot`](../../packages/boot/app-boot) → [`../../packages/bundle/base/cordis.patch.yml`](../../packages/bundle/base/cordis.patch.yml) → [`../../packages/bundle/headless/cordis.patch.yml`](../../packages/bundle/headless/cordis.patch.yml)。

重点回答四个问题：Profile 从哪里加载，Bundle 如何插入插件，Patch 如何按 `id` 覆盖配置，以及为什么运行时服务依赖比 YAML 行号更决定激活时机。

阶段产物是一张启动图：`CLI → Profile → Bundle/Patch → Loader → Cordis Context`。

### 阶段三：追踪一次 Headless Agent Turn

目标是沿着真实源码追踪 `followup()` 到 `turn/end`，这是全项目最重要的主线。

先阅读 [`../../examples/headless-agent/cordis.yml`](../../examples/headless-agent/cordis.yml)，确认示例组合了什么；然后阅读 [`../../packages/bundle/headless/src/index.ts`](../../packages/bundle/headless/src/index.ts)，理解它如何创建 Agent 并等待结束。

接着阅读 [`../../packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts) 的公开接口，再阅读 [`../../packages/core/agent-loop/src/agent.ts`](../../packages/core/agent-loop/src/agent.ts) 的 `wakeDriver()`、`turn()`、`preStep()`、`step()` 和 `buildRequest()`。

核心链路是：`followup()` 写入 inbox，Driver 唤醒，记录 `turn/start`，运行 `agent/pre-step`，记录 `step/start` 和 `user/message`，组装 Prompt，运行 `agent/request` 和 `llm/stream`，记录 `assistant/chunk` 与 `assistant/message`，执行工具流水线，记录 `tool/result`、`step/end` 和 `turn/end`。

阶段产物是一张时序图；项目现有的精确版本见 [`../../docs/agent-lifecycle.zh.md`](../../docs/agent-lifecycle.zh.md)。

### 阶段四：理解 Session 和模型上下文

目标是理解为什么 Session Log 是模型上下文、UI 回放和恢复的共同来源。

阅读 [`../../packages/core/session/src/types.ts`](../../packages/core/session/src/types.ts)、[`../../packages/core/session/src/index.ts`](../../packages/core/session/src/index.ts) 和 [`../../packages/core/session/src/surface.ts`](../../packages/core/session/src/surface.ts)。

重点关注 `SessionEventMap`、`session.append()`、`session.events`、`deriveMessages()`、`request/header`、`assistant/chunk` 和 `assistant/message`。

必须掌握的规则是：任何到达模型请求的内容都必须能从 Session Log 重建；JSONL 和 SQLite 是持久化后端，不能替代核心 Session 的事件语义。

阶段产物是一张“输入事件 → 持久化事件 → 模型消息”的映射表。

### 阶段五：理解工具和能力缝隙

目标是能用同一套方法读懂 LLM、文件系统、Shell 和子 Agent 等可替换能力。

每个能力都按三层阅读：Service Definition → Service Provider → Consumer。

推荐顺序是 `packages/llm/llm` 与 `packages/llm/llm-deepseek`，然后是 `packages/fs/fs`、`packages/fs/fs-local`、`packages/fs/tool-fs`，再是 `packages/shell/shell`、`packages/shell/bash-local`、`packages/shell/tool-bash`。

工具事件的定义和执行代码见 [`../../packages/core/tools/src/index.ts`](../../packages/core/tools/src/index.ts)，模型工具的完整教程见 [`../../docs/cookbook/adding-a-tool.zh.md`](../../docs/cookbook/adding-a-tool.zh.md)。

阶段产物是一张能力表，至少写清服务接口、默认 Provider、模型 Consumer、策略事件、持久化事件和相关测试。

### 阶段六：理解 Web、ACP、SDK 和工程质量

目标是理解不同客户端如何驱动同一个 Agent 核心，以及项目如何用测试和构建保证组合行为。

阅读 `packages/client`、`packages/host`、`packages/acp`、`packages/sdk` 对应 README 和示例，再阅读 [`../../docs/testing.zh.md`](../../docs/testing.zh.md)。

最后练习运行与改动范围匹配的测试，不要把全量测试当作第一次学习入口。模型或用户可见行为应关注 Snapshot，核心语义应关注包测试，真实组合应关注 Loader 或端到端测试。

## 5. 源码阅读方法

### 5.1 从行为问题开始

不要从 `packages/` 目录逐个读；每次只追踪一个问题，例如“用户输入如何进入模型请求”“工具如何被拒绝”“会话如何恢复”。

### 5.2 固定阅读顺序

对一个能力，优先阅读契约，再阅读默认实现、Consumer、运行示例和测试：`README → types.ts → Service Definition → Provider → Consumer → example → tests`。

### 5.3 每个关键函数记录七项信息

```text
函数和文件：
调用者：
读取的 Context 服务：
发出的实时事件：
写入的持久化事件：
失败、取消和重试语义：
卸载或资源释放方式：
```

这张卡片能避免只看控制流而忽略所有权、持久化和清理行为。

### 5.4 使用搜索定位主线

```sh
rg -n "followup|wakeDriver|preStep|buildRequest|session\.append" packages apps
rg -n "turn/start|agent/pre-step|agent/request|llm/stream|tools/pre-execute|turn/end" packages
rg -n "static inject|export const inject|ctx\.on\(|ctx\.effect\(|register\(" packages
rg -n "defineTool|ctx\.tools\.register" packages
```

同时画两张图：一张是 TypeScript Import Graph，另一张是 Cordis Runtime Graph；前者说明代码依赖，后者说明服务和事件在运行时如何连接。

### 5.5 使用 IDE 和调试器

在 IDE 中使用 Go to Definition、Find All References 和 Call Hierarchy，优先定位 `Agent`、`Session`、`ToolDefinition`、`LlmAdapter` 和事件声明。

源码调试时优先在 `ReactLoopAgent.turn()`、`preStep()`、`step()`、`buildRequest()`、`Session.append()` 和工具 `execute()` 上设置断点，不要先进入生成的 `lib/` 或 `vendor/`。

## 6. 循序渐进的实践项目

### 项目一：Hello Plugin

使用 `scratch-plugin` 创建一个只打印启动信息的插件，再增加 `inject` 和 `ctx.effect()` 清理逻辑，验证加载与卸载。

### 项目二：Greet Tool

按照[开发一个工具](develop-study/02-build-a-tool.md)添加 `greet` 工具，观察工具 Schema 如何进入 Prompt、模型如何发起 Tool Call、执行结果如何回到 Session。

### 项目三：可配置工具

阅读[插件配置](develop-study/03-plugin-config.md)，给 `greet` 增加配置，使用 Schemastery 设置默认值和校验，验证错误配置在加载期失败。

### 项目四：事件追踪插件

监听 `session/event`、`agent/status`、`tools/pre-execute` 和 `tools/post-execute`，输出 Session ID、事件类型、Turn、Step、工具名和结果摘要。

ACP 的 stdout 是协议通道，调试信息必须写到 stderr；这个约束可从 [`../../examples/acp-agent/README.zh.md`](../../examples/acp-agent/README.zh.md) 了解。

### 项目五：替换执行 Provider

阅读 [`../../examples/headless-agent/e2b.cordis.yml`](../../examples/headless-agent/e2b.cordis.yml)，理解如何替换文件系统和子进程 Provider，而不修改上层工具和 Agent Loop。

### 项目六：增加一个 Keyless Snapshot

选择工具调用、会话恢复、错误处理或上下文压缩中的一个稳定行为，增加可回放的示例和 Snapshot，并核对会话 JSONL 与最终输出。

## 7. 知识沉淀方法

建议在 `system/` 中逐步形成六类文档：`boot-composition`、`agent-lifecycle`、`session-model`、`capability-seams`、`surfaces` 和 `testing`；每篇只负责一个主题，不把所有内容堆进单一总览。

每篇笔记至少回答：它解决什么问题，谁拥有它，输入和输出是什么，哪些事件参与其中，是否持久化，失败和取消如何处理，源码和测试入口在哪里。

技术文章应围绕一个问题组织，而不是罗列“今天看了哪些文件”。例如“dsh 如何完成一次带工具调用的 Turn”可以依次讲定义、启动服务、调用链、Session Event、工具流水线和验证结果。

## 8. 测试和贡献入口

先运行聚焦检查：

```sh
pnpm exec vitest run packages/core/agent-loop/tests/loop.spec.ts
pnpm exec vitest run packages/core/session/tests/session.spec.ts
pnpm exec vitest run packages/core/tools/tests/tools.spec.ts
pnpm exec vitest run packages/llm/llm-deepseek/tests/sse.spec.ts
```

修改模型、协议或用户可见行为时，阅读 [`../../docs/testing.zh.md`](../../docs/testing.zh.md) 中的 Snapshot 规则；修改文档时运行 `pnpm run doc-sync`；修改代码前阅读 [`../../AGENTS.md`](../../AGENTS.md) 和 [`../../docs/development.zh.md`](../../docs/development.zh.md)。

初学者适合从文档、示例、边界测试和独立插件开始，确认行为后再修改核心 Agent Loop；真实 API Key 不写入仓库，涉及文件写入和 Shell 的实验使用可恢复或隔离的工作目录。

## 9. 完成标准

当你能独立回答下面问题时，已经建立了第一版知识体系：

- `dsh web` 如何从 CLI 变成 Cordis 插件树？
- Profile、Bundle、Patch 和 `inject` 分别解决什么问题？
- `followup()` 如何进入 Agent Loop？
- Turn 和 Step 有什么区别？
- 哪些事件是持久化事实，哪些事件只服务于实时协作？
- 为什么模型可见内容必须能从 Session Log 重建？
- 一个工具如何同时连接 Schema、执行器、结果和展示？
- 如何替换文件系统或子进程 Provider 而不修改 Agent Loop？
- Web、Headless、ACP 和 SDK 如何共享核心 Agent 能力？
- 新功能应该注册到哪个扩展点，什么时候才需要修改核心循环？
