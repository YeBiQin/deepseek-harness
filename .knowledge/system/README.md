# System Knowledge

## Purpose

`system/` 用于沉淀 DeepSeek Harness 当前已经存在的体系化知识，包括总体架构、启动和配置组合、核心模块、能力分层、数据流、技术规范、调试方法、测试策略和最佳实践。

## Scope

适合放入本目录的内容回答“系统现在是什么、如何运行、如何验证和如何使用现有扩展点”，例如：

- 系统架构和运行时插件树；
- `Agent`、`Session`、LLM、工具和持久化模块说明；
- Profile、Bundle、Patch、Cordis Service 和 Event 的使用规则；
- 源码阅读、调试、测试和故障定位方法；
- 基于当前代码的学习路线、术语表和实践教程。

功能构想、版本规划、尚未实现的设计和任务清单放入 [`../features/README.md`](../features/README.md)。

## Document rules

- 只描述当前仓库可由源码、配置、测试或现有文档验证的事实。
- 每篇文档只负责一个主题；跨主题内容链接到它的唯一归属文档。
- 教程按前置知识和操作顺序组织，并给出可观察的验证结果。
- 参考文档按查阅场景组织，不把实现细节复制成手写目录或生成目录。
- 代码路径使用相对 Markdown 链接，公共 API、事件、失败语义和持久化行为要说明拥有者。
- 内容发生变化时，优先更新源码、包 README 或 `docs/` 中的权威文档，再更新本目录的学习材料。
- 不在本目录写版本状态、未来计划、任务拆解或“待实现”清单；这些内容属于 `features/`。

## Recommended document template

```markdown
# <主题>

## 目标

## 适用范围

## 前置知识

## 当前结构

## 核心概念或数据流

## 源码与文档入口

## 最小验证

## 常见误区

## 相关主题
```

## Existing guide

- [`harness-learning-guide.md`](harness-learning-guide.md) 从基础概念、启动链路和 Agent Loop 开始，逐步进入能力扩展、测试和社区贡献。
- [`course/README.md`](course/README.md) 是完整连续课程的总目录，串联六个基础模块、四篇开发练习和九个高级专题。
- [`module-1-global-and-cordis.md`](module-1-global-and-cordis.md) 是第一模块，只讲全局认知、启动流和 Cordis 插件模型。
- [`module-2-plugin-lifecycle.md`](module-2-plugin-lifecycle.md) 是第二模块，讲插件依赖、Service、Event、Effect 和卸载清理。
- [`module-3-agent-turn.md`](module-3-agent-turn.md) 是第三模块，沿着 Inbox、Driver、Turn、Step、模型请求和工具结果追踪一次 Agent 工作单。
- [`module-4-session-reconstruction.md`](module-4-session-reconstruction.md) 是第四模块，讲 Session 事件日志、模型消息 Surface、请求元数据和恢复重建。
- [`module-5-capability-and-tools.md`](module-5-capability-and-tools.md) 是第五模块，讲 Service Definition、Provider、Consumer、工具契约和策略流水线。
- [`module-6-multi-entry-and-output.md`](module-6-multi-entry-and-output.md) 是第六模块，讲 Web、Headless、ACP、SDK 的共享核心、测试分层、知识沉淀和贡献路径。
- [`harness-deep-dive-explained.md`](harness-deep-dive-explained.md) 是六个模块的综合参考，可配合各模块查阅。
- [`develop-study/README.md`](develop-study/README.md) 是面向初学者的开发教程，按插件、工具、配置和 Bundle 安装组织可运行练习。

## Advanced course

`course/` 中的高级课程按当前能力缝隙拆分为独立文章：审批与权限预设、沙箱与后台任务、一次性和可继续子 Agent、压缩、Workflow、Agent Preset，以及明确标记为实验性的 Agent Teams。每篇文章都有前置知识、调用链、练习、聚焦验证命令和权威来源；不要把它们合并回一篇泛化的“高级功能总览”。
