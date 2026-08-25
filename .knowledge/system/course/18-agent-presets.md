# 第 18 篇：Agent Preset 与按会话组装

本篇回答：多个会话怎样在同一进程中拥有不同的工具和提示词，同时共享宿主级注册表，并让运行中的会话不因 preset 文件变化而突然换掉自己的模型可见前缀。

## 本篇目标

- 能解释 preset 目录、常驻挂载和 agent scope 的关系。
- 能区分发现健康、信任展示和真正的运行时强制规则。
- 能解释代际、`mount()`、`composeFrom()` 与 `recompose()` 的差异。
- 能验证 preset 选择为何必须进入 Session Log。

## 前置知识

先完成[插件生命周期](../module-2-plugin-lifecycle.md)、[多入口与输出](../module-6-multi-entry-and-output.md)和[子 Agent](15-subagents.md)。Preset 是插件组合层，不是一个新的 Agent 类型；它把已有工具、system prompt 和 projection 注册到某个 agent scope。

## 1. preset 解决什么问题

一个 preset 是包含 `agent.cordis.yml` 的目录。常驻 roster 将它挂载一次，agent scope 通过父链加入；agent 看到的是 `agent → preset → global` 的分层。这样两个会话可以分别加入 `minimal` 和 `coding`，工具和提示词不同，但进程级服务仍由宿主组合拥有。

```text
宿主组合：Session、Agent、Provider、跨会话 Registry
        ↓
roster 常驻挂载：preset scope
        ↓
agent scope 认父到 preset
        ↓
该会话获得工具、提示词和投影贡献
```

如果 preset 把全局服务发布到 root realm，挂载会拒绝它，因为第二个 preset 会和第一个冲突，并让宿主无法判断哪个实例代表整个进程。必须按 agent 隔离的服务应放在 scope 或 isolate realm 中。

## 2. 发现、健康和信任

`list()` 与 `resolve()` 每次重新读取 roots；重复 id 由靠前的 root 胜出。目录名不符合 `[a-z0-9][a-z0-9-]*` 会跳过；配置文件缺失、YAML 无法解析或不是具名插件列表的目录会作为 broken 条目列出，而不是静默消失。

`system` 与 `user` trust 主要服务于展示和创作权限。user preset 的权限等同于它引用的插件和 Shell 权限，trust 字段不会把不可信 preset 变成沙箱。`copy()` 只写首个 user root，复制整个目录并拒绝覆写；`remove()` 不允许删除 system preset。

## 3. 挂载与代际

agent 工厂的 `setup(agentCtx)` 是唯一支持的 `mount()` 调用点。此时 agent 尚未发布，挂载失败可以让整个创建回滚，不会留下半组装会话。常驻子树由 roster fiber 所有，比加入它的 Agent 活得更久。

roster 以 `agent.cordis.yml` 的 mtime 和 size 形成 stamp。文件变更会为后续会话创建新代际，已经运行的会话继续使用旧代际；这保护了前缀稳定性和正在执行的工具注册。旧代际在进程结束前可能继续存在，这是当前的资源代价。

子 Agent 通过 `composeFrom()` 认父到 parent 的 standing composition，不能直接 `mount()`。这样 child 与 parent 使用同一个已解析代际；冷恢复会从 child 自己记录的 preset id 重建实际运行过的选择，而不是重新套部署默认值。

## 4. 运行中切换为什么受限

`agent-preset/selected` 事件记录运行时选择，因为 preset 决定模型看到的工具 schema 和提示词。如果只读 Session header，切换后的会话恢复时会错误地按创建时组装，历史里的工具调用可能无法重建。

`recompose()` 先确保目标 preset 可加载，再在 scope 移动前准备新挂载；失败时恢复旧链。产品层只允许没有任何产出的 agent 切换，避免已经记录的工具调用在新组装中没有对应工具。默认值变化只影响后续会话，不会改变现有会话。

## 5. 动手练习：两会话两种前缀

准备两个简单 preset：一个只注册观察工具，另一个注册不同名称的工具和提示词段。分别创建两个空白 Agent，观察它们的 tool catalog 和 system prompt 不同；创建第三个已经产生消息的 Agent 后尝试 recompose，记录调用方在哪一层拒绝。

修改 `agent.cordis.yml` 后再次创建会话，比较新旧会话使用的代际。不要修改运行中会话的共享文件来验证“热更新”；正确观察是新会话获得新代际，旧会话保持旧组装。

## 6. 验证结果

运行 preset 的发现、挂载、Session 选择和不变量测试：

```sh
pnpm exec vitest run packages/preset/agent-presets/tests/metadata.spec.ts packages/preset/agent-presets/tests/session.spec.ts packages/preset/agent-presets/tests/user-root.spec.ts packages/preset/agent-presets/tests/authoring.spec.ts packages/preset/agent-presets/tests/invariant.spec.ts
```

再运行 persona 组合测试：

```sh
pnpm exec vitest run packages/preset/persona/tests/persona.spec.ts
```

预期证据包括：broken preset 可见但不能挂载；重复 id 遵守 root 优先级；user root 的复制和删除有边界；root realm 服务会被拒绝；选择事件可重建实际 preset；非空 Agent 不能被无条件重组。

## 常见误区

- 把 preset 当成普通配置文件，直接把工具写成全局注册。
- 以为 trust 会自动提供安全隔离；user preset 与它引用的插件拥有同级 Shell 权限。
- 文件一改就重挂载所有运行中会话，破坏模型前缀和已记录工具调用。
- 让 child 根据当前默认值 mount，而不是继承 parent 的 standing composition。
- 把 header 的创建 preset 当成整个 Session 的实际 preset。

## 权威入口与下一篇

总体职责见[`packages/preset/README.zh.md`](../../../packages/preset/README.zh.md)，详细机制见[`packages/preset/agent-presets/README.zh.md`](../../../packages/preset/agent-presets/README.zh.md)，实现见[`packages/preset/agent-presets/src`](../../../packages/preset/agent-presets/src)。下一篇单独学习实验性的 Agent Teams；它不是稳定 preset 或普通 subagent 的别名。
