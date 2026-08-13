# Agent Note: 组合器草稿润色

Status: implemented

[English](2026-08-14-composer-draft-polishing.md) | 中文

## 问题

组合器草稿只能手工编辑：没有基于模型的、能作为对话延续的重写能力。任何此类能力都不得扰动会话——重写一条尚未发送的草稿是草稿编辑，而非对话轮次，因此不能被标题化、检查点化或出现在对话流中，也不能改变主对话的上下文与 KV 缓存。支撑重写的上下文还必须是权威的：即会话自身的日志，而不是在浏览器里拼装的快照——后者可能被窗口化或过期。

## 决策

**由一个新 Host 包持有该能力。** `@deepseek-ai/dsh-polish`（`packages/interaction/polish`）挂载一个 Typert remote 服务，暴露 `polish/polish`——`polish(agent, draft, mode, signal)`——返回重写后的文本或显式失败（`draft-blank`、`input-too-large`、`no-route`、`empty-output`、`internal`）。基础 bundle 以必需的部署策略注册该插件（`maxSummaryChars` 2000、`maxRecentMessages` 20、`maxLineChars` 2000、`maxRecentChars` 8000、`maxInputBytes` 16384、`maxOutputTokens` 4096、`timeoutMs` 30000）；`tsconfig.host.json` 增加项目引用。

**三种重写模式，一个线上契约。** `basic` 收紧语法与措辞，`enhanced` 为更强的表达做重构，`expand` 借助上下文支持的细节展开草稿；未知的线上取值在索引提示词表之前回退为 `basic`。系统提示词保证输出契约（保持含义、事实、结构与语言；仅返回纯文本），规范化处理去除首尾空白、剥离一层可选代码围栏并拒绝空结果。

**上下文在 Host 侧从会话日志组装。** `assembleContextLines` 扫描会话自身的事件：先取最新的 `compaction/summary` 检查点（通过结构性投影读取——本包不得导入 `dsh-compaction-basic`），再取该检查点之后最近的 user/assistant 表层消息，全部受策略预算约束。工具行、注入上下文与无文本消息不贡献内容。浏览器只发送草稿与模式。

**辅助调用走会话自身的模型路由。** 路由优先取会话日志中的 `request/header`（会话中途切换模型后的最新事实），回退到智能体创建选项。生成请求携带新增的 `purpose: 'polish'`（`GenerateOptions` 由 `'compaction' | 'session-title'` 扩展而来），DeepSeek 适配器像处理 `session-title` 一样将其映射为关闭思考。调用受 `maxOutputTokens` 限制，由 `timeoutMs` 截止时间约束（原因码 `POLISH_TIMEOUT`），并随浏览器请求的 `AbortSignal` 取消。

**润色从不触碰会话日志。** 不追加任何内容，因此不会触发标题生成、检查点或对话流条目；主对话的上下文与 KV 缓存不受影响。

**组合器把重写集成受保护的草稿变更。** `ComposerBarInjected` 上注入的 `polish` 槽位携带实时草稿与所选模式。润色按钮打开模式菜单（新增的 ui-primitives `Menu` `fitWidth` 属性让卡片贴合这个短选项集），并显示忙碌锁定——输入框只读并带有至少一个完整淡入淡出周期的淡化效果（`POLISH_LOCK_MIN_MS` 1200）。新一次运行或卸载会中止在途调用；成功重写只在用户尚未接管输入框时替换草稿，并挂起一次性撤销（`{ original, polished }`），任何手动编辑草稿、切换会话或刷新页面都会撤销该状态。

## 曾考虑的替代方案

**浏览器组装的上下文行。** 早期设计由组合器在客户端组装最近的对话行并与草稿一起发送。不采用：浏览器快照可能被窗口化或过期，而会话日志才是权威；服务从 `agent.session.events` 按部署预算组装上下文。

**把润色当作对话轮次。** 不采用：把重写追加进会话日志会被标题化、检查点化并出现在对话流中，还会扰动主对话的上下文与缓存。

**流式回传重写、重试策略或风格预设。** 推迟：首发是一次性整体替换，已列入包 README 的后续工作。

**复用既有生成 purpose 实现关闭思考映射。** 不采用：独立的 `purpose: 'polish'` 让每项能力的传输元数据与生成策略保持显式，而不是让 `session-title` 或 `compaction` 承担额外职责。

## 后果

辅助 token 开销产生在会话自身的模型路由上，受 `maxOutputTokens` 限制；后续轮次没有上下文或缓存差异。润色期间组合器锁定输入框，只在用户未接管时替换草稿，并提供一次性撤销。失败是显式且可展示的，包括输入超限与无路由的情况。不包含 Web 组合器的组合无需本包。已知限制：一次性重写、受预算约束的上下文窗口（最新压缩摘要之前的历史不在范围内）、服务端不缓存草稿与组装后的上下文。

## 相关

本文件是内部决策记录（Agent Note），并非官方文档，不会发布到文档站点。面向用户的用法文档位于包 README（`packages/interaction/polish/README.md`，双语），由它承载服务契约与模型体验；本笔记只记录决策、替代方案与后果。
