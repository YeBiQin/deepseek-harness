# DeepSeek Harness 完整课程

这是一条从 Cordis 插件基础、Agent Loop、Session 和工具，一直走到权限、执行隔离、后台任务、子 Agent、压缩、Workflow 与按会话组装的连续课程。每篇文章都以当前仓库的代码和测试为事实来源，并要求读者完成一个可观察的练习。

## 如何使用这套课程

先按顺序完成基础主线，再进入开发练习，最后按专题顺序学习高级能力。不要把专题文章当成 API 手册；每篇文章只保留理解一个运行时问题所需的契约、调用链、源码入口、练习和验证方式，精确字段继续回到 `docs/` 与包 README。

每篇文章的完成标准有三层：能够用自己的话解释拥有者和数据流；能够完成练习并预测结果；能够运行文中的聚焦测试或检查，并根据输出判断预测是否成立。命令都从仓库根目录执行。

## 第一阶段：基础主线

这六篇建立整个系统的共同词汇。读完后应该能从入口追踪到 Agent Turn、Session Log、模型请求、工具执行和输出投影。

1. [全局认知、启动流和 Cordis 插件模型](../module-1-global-and-cordis.md)：理解 Profile、Bundle、Loader、Context 和 Plugin。
2. [插件依赖、Service、Event 和 Effect](../module-2-plugin-lifecycle.md)：理解服务依赖、事件分发、注册 disposer 与卸载顺序。
3. [一次 Agent Turn 的完整链路](../module-3-agent-turn.md)：沿着 Inbox、Driver、Turn、Step、模型请求和工具结果阅读主循环。
4. [Session Log 与模型上下文重建](../module-4-session-reconstruction.md)：理解持久事件、Surface、请求元数据和恢复。
5. [能力缝隙与工具策略流水线](../module-5-capability-and-tools.md)：用 Definition、Provider、Consumer 读懂可替换能力。
6. [多入口、测试分层与工程化沉淀](../module-6-multi-entry-and-output.md)：理解 Web、Headless、ACP、SDK 如何复用同一核心。

综合复习使用[学习与梳理指南](../harness-learning-guide.md)和[系统深潜参考](../harness-deep-dive-explained.md)。

## 第二阶段：最小开发实践

这一阶段把基础概念变成可以运行的仓库修改。每篇都在 `scratch-plugin` 或本地 Cordis 配置上完成一个小闭环。

1. [创建第一个插件](../develop-study/01-first-plugin.md)：加载、依赖、Effect、清理和最小验证。
2. [开发一个工具](../develop-study/02-build-a-tool.md)：参数 schema、执行函数、规范结果、展示和策略流水线。
3. [给插件增加配置](../develop-study/03-plugin-config.md)：Schemastery、默认值、校验和配置错误。
4. [把插件做成可安装 Bundle](../develop-study/04-package-install.md)：包元数据、构建产物、Cordis 配置和安装验证。

开发阶段的环境与写作约定见[开发学习路线](../develop-study/README.md)。

## 第三阶段：运行时高级专题

下面的文章按“先决定操作能否继续，再决定怎样执行，最后学习如何并行、压缩和组装 Agent”的顺序排列。

7. [用户审批：一次操作怎样获得明确决定](11-approval-and-permissions.md)：`ask`、`never`、fail-closed、审计事件和调用方拒绝语义。
8. [权限预设：把审批与沙箱组成一个选择器](12-permission-presets.md)：预设表、`custom`、事件顺序和两个 knob 的写入路径。
9. [进程沙箱：把文件效果限制在一次调用](13-sandbox-and-execution.md)：模式、workspaceRoot、后端、部分强制执行、runner failure 和 denial。
10. [后台任务：长时间工作怎样被拥有、读取和终止](14-background-jobs.md)：Job Registry、授权、输出游标、完成通知和资源释放。
11. [子 Agent：一次性委派与可继续会话](15-subagents.md)：provider 能力、深度、取消、收件箱、冷恢复和结果。
12. [压缩：怎样在不破坏日志的情况下缩短 Surface](16-compaction.md)：锁、摘要替换、工具配对、剪枝、手动失败和恢复。
13. [Workflow：在受控脚本中编排多个子 Agent](17-workflow.md)：meta、脚本、worker、fatal error、取消、dispose 和事件配对。
14. [Agent Preset：按会话组装工具与提示词](18-agent-presets.md)：发现、信任、常驻挂载、代际、切换和持久选择。
15. [Agent Teams：实验性的 Lead、teammate、mailbox 与任务板](19-agent-teams.md)：显式启用、共享 checkout、持久消息、CAS 任务和实验限制。

## 最终实践项目

完成专题后，做一个“受限编码助手”练习：为一个空白 Profile 选择一个 preset；在 `workspace-write + ask` 下执行一个会修改文件的工具；观察审批和 `sandbox/mode` 事件；启动一个后台任务或一次性子 Agent；当历史变大时手动压缩；最后用一个 Keyless Snapshot 或聚焦组合测试记录结果。每一步都要写出“谁拥有资源、哪些事实进日志、失败怎样被观察到”。

推荐最后运行：

```sh
pnpm run verify-md-links
pnpm run verify-md-wrap
pnpm run doc-typecheck
```

这些检查证明课程内部链接、段落格式和可编译的示例没有破坏文档门禁；专题行为仍以每篇文章列出的 Vitest 测试为准。

## 权威来源

课程文章是学习层，不替代仓库的权威文档。架构、生命周期、测试策略和能力缝隙的总入口分别是 [`docs/architecture.zh.md`](../../../docs/architecture.zh.md)、[`docs/agent-lifecycle.zh.md`](../../../docs/agent-lifecycle.zh.md)、[`docs/testing.zh.md`](../../../docs/testing.zh.md) 和 [`docs/capability-seams.zh.md`](../../../docs/capability-seams.zh.md)。专题文章会链接到对应的 `docs/subsystems/*.zh.md`、包 README、源码和测试。
