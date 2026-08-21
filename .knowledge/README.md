# Project Knowledge

`.knowledge/` 集中保存 DeepSeek Harness 的体系化知识和后续功能规划，并通过子目录隔离两类内容。

## Directory boundaries

- [`system/`](system/README.md) 只记录当前工程已经存在的架构、模块、技术规范、最佳实践和学习材料。
- [`features/`](features/README.md) 只记录后续迭代的版本规划、需求、设计方案和任务拆解。

`system/` 是当前代码和现有文档的知识索引，不承载未实现功能的设计；`features/` 可以引用 `system/` 的稳定事实，但不能复制它们作为第二个事实来源。

## Current documents

- [`system/harness-learning-guide.md`](system/harness-learning-guide.md) 面向初学者的 DeepSeek Harness 学习与源码梳理指南。
- [`system/module-1-global-and-cordis.md`](system/module-1-global-and-cordis.md) 第一模块：全局认知、启动流和 Cordis 插件模型。
- [`system/module-2-plugin-lifecycle.md`](system/module-2-plugin-lifecycle.md) 第二模块：插件依赖、Service、Event、Effect 和卸载清理。
- [`system/module-3-agent-turn.md`](system/module-3-agent-turn.md) 第三模块：Inbox、Driver、Turn、Step、模型请求和工具结果。
- [`system/module-4-session-reconstruction.md`](system/module-4-session-reconstruction.md) 第四模块：Session 事件日志、模型消息 Surface、请求元数据和恢复重建。
- [`system/module-5-capability-and-tools.md`](system/module-5-capability-and-tools.md) 第五模块：能力缝隙、工具契约和工具策略流水线。
- [`system/module-6-multi-entry-and-output.md`](system/module-6-multi-entry-and-output.md) 第六模块：多入口复用、测试分层、知识沉淀和贡献路径。
- [`system/harness-deep-dive-explained.md`](system/harness-deep-dive-explained.md) 六个主题的综合参考，可配合各模块查阅。
- [`system/develop-study/README.md`](system/develop-study/README.md) 插件开发入门路线：插件、工具、配置以及打包安装。

## Maintenance rules

- 新文档先判断内容属于“当前是什么”还是“未来做什么”，再选择子目录。
- 需要描述当前代码行为时，链接源码、包 README 或 `docs/` 中的权威文档，并注明验证入口。
- 需要描述尚未实现的功能、取舍或任务时，放入 `features/`，不要在 `system/` 中使用未来时态伪装成当前能力。
- 文档中的仓库路径使用相对 Markdown 链接；代码、配置和生成目录的事实以仓库现状为准。
