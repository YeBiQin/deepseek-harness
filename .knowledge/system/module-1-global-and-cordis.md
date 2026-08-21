# 模块一：全局认知与 Cordis 插件模型

这是 DeepSeek Harness 深度学习的第一个模块，本模块只解决两个问题：Harness 整体是怎么拼起来的，以及 Cordis 插件为什么能让这些能力协作和卸载。

本模块暂不深入 Agent Turn、Session 事件流和工具策略流水线；它们会在后续模块中沿着真实调用链继续学习。

## 1. 学完本模块要得到什么

完成本模块后，你应该能用自己的话解释 `dsh web` 的启动过程，区分 Profile、Bundle、Patch、Plugin、Context、Service、Event 和 Effect，并能在源码中定位一次插件加载的入口。

你不需要记住所有包名，也不需要现在理解 Agent Loop 的每个并发细节；本模块的目标是先建立一张不会迷路的地图。

## 2. 先用一个生活模型建立直觉

把 DeepSeek Harness 想成一家“可以换设备的智能工作室”。用户不是直接调用某个固定的 `main()`，而是先告诉系统要开哪种工作室，再由系统把设备、员工和规则装配起来。

| 工程概念 | 生活模型 | 白话解释 |
|---|---|---|
| `dsh` | 开店指令 | 决定要启动 Web、Headless、插件管理或配置查看 |
| Profile | 工作室装修方案 | 决定这次运行要组合哪些 Bundle |
| Bundle | 标准设备套装 | 一次提供一组可以复用的插件配置 |
| Patch | 装修修改单 | 按插件 `id` 覆盖配置或插入新插件 |
| Cordis Loader | 装修项目经理 | 读取配置、加载插件、等待插件树稳定 |
| Plugin | 一个工作小组 | 在 `apply(ctx)` 中注册服务、事件或工具 |
| Context | 共享工作台 | 插件从这里访问已经挂载的 Service 和 Event |
| Service | 工作室里的设备或部门 | 提供可以被其他插件调用的稳定能力 |
| Event | 工作室内部对讲机 | 让插件观察、修改或阻止某个运行时动作 |
| Effect | 设备领用和归还记录 | 插件卸载时撤销注册并释放资源 |

这个比喻只帮助记忆，不能替代源码契约；当比喻和代码不一致时，以类型、实现、测试和 [`../../docs/architecture.zh.md`](../../docs/architecture.zh.md) 为准。

## 3. Harness 到底是什么

普通的 LLM 调用通常是“准备消息 → 请求模型 → 得到回复”，而 Harness 还要负责模型之外的长期运行问题：工具调用、文件和 Shell 操作、权限、会话保存、恢复、多个客户端以及插件替换。

因此可以先把 Harness 看成四层：

```text
启动层：dsh / Profile / Bundle / Patch
插件层：Cordis Loader / Context / Service / Event / Effect
Agent 层：Agent / Session / Prompt / LLM / Tools
入口层：Web / Headless / ACP / SDK
```

当前工程的包地图见 [`../../packages/README.zh.md`](../../packages/README.zh.md)，核心脊柱见 [`../../packages/core/README.zh.md`](../../packages/core/README.zh.md)。

这里有一个很重要的判断：Harness 的“核心”不是一大段必须修改的中心代码，而是由多个插件组成的运行时；`agent-loop` 是默认实现，但它仍然通过插件服务和事件扩展。

## 4. `dsh web` 是如何启动的

### 4.1 先看命令入口

打开 [`../../apps/cli/src/bin.ts`](../../apps/cli/src/bin.ts:27)，先不要追所有 import，只看 `parseDshArgs()` 得到的 `invocation.mode` 和后面的 `switch`。

你会看到 CLI 主要负责分流：`profile` 模式进入 `runProfile`，`plugin` 模式进入插件管理，`dump-config` 模式输出最终配置；它不在这里直接创建 Agent。

这体现了一个设计边界：命令行只负责“我想启动什么”，具体“启动哪些插件以及插件如何工作”交给 Profile、Bundle 和 Cordis。

### 4.2 再看 Patch 如何叠加

打开 [`../../apps/cli/src/profile-boot.ts`](../../apps/cli/src/profile-boot.ts:121)，重点看 `allPatches()`、`composeProfile()` 和 `runProfile()`。

当前 Patch 层次是 Bundle Patch、Profile 自己的 Patch、Harness Home 的 Patch、命令行 `--patch` Overlay；后面的层可以按 `id` 覆盖前面的行。

打开 [`../../packages/boot/app-boot/src/profile.ts`](../../packages/boot/app-boot/src/profile.ts:371)，重点看 `loadProfile()` 和 `composeEntries()`：前者读取 Profile 和 Bundle manifest，后者把多层 Patch 应用到空的 entry list 上。

打开 [`../../packages/bundle/base/cordis.patch.yml`](../../packages/bundle/base/cordis.patch.yml:1)，注意它把 LLM、Session、Agent、Tools、权限、持久化等共享能力插入基础 Profile；打开 [`../../packages/bundle/headless/cordis.patch.yml`](../../packages/bundle/headless/cordis.patch.yml:1)，可以看到 Headless 如何在 Base 之上增加一次性运行入口。

要记住一个容易混淆的事实：Patch 针对目标行替换整个配置，不是对目标配置做字段级深合并；而 YAML 行号也不等于最终 Service 激活顺序，插件的 `inject` 和服务可用性才决定何时能运行。

### 4.3 最后看 Loader 如何真正挂载

打开 [`../../packages/boot/app-boot/src/index.ts`](../../packages/boot/app-boot/src/index.ts:757)，重点看 `boot()`：它创建 `Context`，安装 Loader，执行准备逻辑，挂载根配置，等待 Loader 完成，再确认插件条目已经激活。

把启动过程压缩成一句话就是：CLI 选择模式，Profile 找到 Bundle，Patch 组合出 entry list，Loader 把 entry list 挂载到 Context，插件在依赖满足后开始注册能力。

### 4.4 启动链路图

```text
dsh web
  ↓ apps/cli/src/bin.ts
runProfile
  ↓ apps/cli/src/profile-boot.ts
Profile + Bundle + user Patch + --patch
  ↓ packages/boot/app-boot/src/profile.ts
composeEntries
  ↓ packages/boot/app-boot/src/index.ts
boot → Loader → Context
  ↓
Plugin apply(ctx) → Service / Event / Effect
```

## 5. Cordis 插件的最小形态

打开仓库已有的 [`../../scratch-plugin/src/my-plugin.ts`](../../scratch-plugin/src/my-plugin.ts)，你会看到一个最小插件只需要一个名字和 `apply(ctx)`。

`apply(ctx)` 可以理解为“这个工作小组正式入场时要做的安装动作”。它可以注册事件监听器、工具、模型适配器或服务，也可以读取已经由 Cordis 准备好的依赖。

插件并不是“只要被 import 就生效”。代码被 import 只说明模块可以被找到；只有它被 Loader 挂载、依赖满足并执行 `apply()`，它提供的能力才进入当前运行时。

项目入门教程 [`../develop-study/01-first-plugin.md`](develop-study/01-first-plugin.md) 将最小插件、绝对路径 Overlay、卸载清理和 `inject` 串成一次可运行练习；仓库官方教程 [`../../docs/user/develop/basic/index.zh.md`](../../docs/user/develop/basic/index.zh.md) 保留完整 API 参考。

## 6. `Context`、`Service` 和 `inject`

### 6.1 Context 是什么

`Context` 可以理解为工作室的共享工作台，但它不是一个随意堆放全局变量的对象；每个稳定能力有自己的 Service 和 `ctx` key，例如 `ctx.sessions`、`ctx.agents`、`ctx.tools` 和 `ctx.llm`。

插件通过 Service key 找到能力，而不是把某个具体 Provider 的实现路径硬编码进来。这是替换本地文件系统、LLM Provider 或执行环境的基础。

### 6.2 `inject` 是什么

`inject` 是插件对 Loader 的明确声明：“我只有在这些 Service 准备好后才能执行”。例如文件工具声明需要 `tools`、`fs` 和 `systemPrompt`，见 [`../../packages/fs/tool-fs/src/index.ts`](../../packages/fs/tool-fs/src/index.ts:19)。

DeepSeek Provider 声明需要 `llm`，见 [`../../packages/llm/llm-deepseek/src/index.ts`](../../packages/llm/llm-deepseek/src/index.ts:43)。这意味着 Provider 的 `apply()` 执行时可以使用已经准备好的 `ctx.llm` 注册适配器。

生活中可以把 `inject` 理解成“开门条件”，而不是“启动顺序表”：插件不必说“请先运行 A，再运行 B”，只需要说“我需要 B”；Loader 根据服务可用性安排激活。

### 6.3 为什么不直接 import 具体实现

如果工具直接 import 本地文件系统实现，那么换成 E2B 或沙箱实现就要修改工具代码；如果工具只依赖 `ctx.fs` 这个 Service Definition，那么 Provider 可以替换，Consumer 可以保持稳定。

这就是项目文档中“Service Definition、Service Provider、Consumer”三角色的原因。能力分层的完整说明见 [`../../docs/architecture.zh.md`](../../docs/architecture.zh.md) 和 [`../../docs/subsystems/README.zh.md`](../../docs/subsystems/README.zh.md)。

## 7. Event 和 Effect：插件如何协作和收尾

### 7.1 Event 不是普通回调列表

Event 是运行时的扩展点，不同事件有不同调度语义：`emit` 用于通知，`waterfall` 用于逐层包装或作决定，`parallel` 用于并行等待，`serial` 用于按顺序执行。

Cordis Primer 的 [`Dispatch Modes`](../../docs/cordis-primer.zh.md:15) 和 [`Waterfall Semantics`](../../docs/cordis-primer.zh.md:28) 是本小节的权威解释。

初学时先记住 Waterfall：只观察或只增加信息的监听器要调用 `next()`；不调用 `next()` 就意味着当前监听器主动接管并截断后续处理。后面学习 `agent/pre-step`、`agent/request` 和 `tools/pre-execute` 时会反复遇到这个规则。

### 7.2 Effect 解决什么问题

如果插件只会注册不会撤销，热重载或卸载后就可能出现重复工具、重复监听器、悬挂定时器和仍在运行的外部连接。

Effect 把“安装动作”和“清理动作”绑定在一起：插件挂载时注册，插件卸载时运行 disposer。项目入门教程明确说明，通过 `ctx` 注册的监听器、工具和定时器会随插件卸载清理；外部资源则应通过 `ctx.effect()` 提供显式清理函数。

## 8. 第一个可观察练习

### 练习 A：只观察插件装载

运行下面的 Overlay，观察终端是否出现 `hello-plugin` 的加载信息：

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

源码入口是 [`../../scratch-plugin/cordis.yml`](../../scratch-plugin/cordis.yml) 和 [`../../scratch-plugin/src/my-plugin.ts`](../../scratch-plugin/src/my-plugin.ts)。这一步只验证“模块被 Loader 挂载并执行 `apply()`”。

### 练习 B：验证 `inject`

阅读 [`../../docs/user/develop/basic/index.zh.md`](../../docs/user/develop/basic/index.zh.md:87)，给练习插件增加 `inject: ['tools']`，然后在 `apply(ctx)` 中访问 `ctx.tools`。

观察重点不是工具功能，而是“插件依赖未满足时不会提前执行”。完成后回答：如果把 `tools` 从 Profile 中移除，这个插件应该是正常执行、等待，还是启动失败？请用实际 Loader 行为验证答案。

### 练习 C：验证 Effect 清理

给插件注册一个定时器，并把清理函数交给 `ctx.effect()`；修改配置触发 HMR 后，观察旧插件的定时器是否还在继续输出。

本练习的学习重点是资源所有权：定时器由插件创建，也应由插件的 disposer 负责释放。

## 9. 本模块的源码阅读任务

按下面顺序打开文件，不要跳到后续 Agent Loop：

1. 阅读 [`../../apps/cli/src/bin.ts`](../../apps/cli/src/bin.ts:27)，用一句话写出每个 `invocation.mode` 的职责。
2. 阅读 [`../../apps/cli/src/profile-boot.ts`](../../apps/cli/src/profile-boot.ts:121)，写出 Patch 的应用顺序。
3. 阅读 [`../../packages/boot/app-boot/src/profile.ts`](../../packages/boot/app-boot/src/profile.ts:371)，找出 Profile 如何解析 Bundle manifest。
4. 阅读 [`../../packages/boot/app-boot/src/index.ts`](../../packages/boot/app-boot/src/index.ts:757)，找出 Loader 安装、配置挂载和启动完成检查。
5. 阅读 [`../../docs/cordis-primer.zh.md`](../../docs/cordis-primer.zh.md:7)，把 `Service`、`inject`、Event 和 Effect 分别写成一句白话。
6. 阅读 [`../../packages/llm/llm-deepseek/src/index.ts`](../../packages/llm/llm-deepseek/src/index.ts:43)，确认一个真实 Provider 如何声明依赖并注册到 `ctx.llm`。

建议为每个文件填写一张源码卡片：它解决什么问题，谁调用它，读取哪些 `ctx` Service，注册什么能力，失败时如何处理，卸载时由谁清理。

## 10. 自测与参考答案

可以用自己的话思考下面的问题：

> 如果 `greet` 插件已经被 TypeScript import，但 `ctx.tools` 还没有被 Loader 挂载，这个插件能不能安全地调用 `ctx.tools.register()`？为什么？

参考答案：不能安全调用。`import` 只让 TypeScript 找到插件代码，不代表运行时已经有 `tools` Service；插件应声明 `inject: ['tools']`，由 Loader 在依赖满足后执行 `apply()`。如果 Profile 缺少这个 Service，应由 Loader 在可确定的位置报告配置问题，而不是由插件自行创建一个平行的 `ToolRuntime`。

读完本模块后，按模块二的顺序继续阅读 Plugin、Context、Service、Event、Effect 的完整生命周期；不必等待答题或提交练习。
