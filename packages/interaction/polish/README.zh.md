# @deepseek-ai/dsh-polish

[English](README.md) | 中文

面向组合栏的辅助模型草稿润色服务。浏览器通过 `polish/polish` Remote 端点发送当前草稿与所选模式；本服务在 Host 侧从会话自身的日志组装对话上下文（最新的压缩摘要加上最近的表层消息，受部署策略约束），将其组装为一次辅助生成请求，使用会话自身的模型路由，并把润色后的文本返回给组合器写回草稿机器。润色是草稿编辑，而非对话轮次：服务不向会话日志追加任何内容，因此不会触发标题生成、检查点或出现在对话流中。

## 服务契约

`ctx.polish.polish(agent, draft, mode, signal)` 返回 `{ ok: true, value: { text } }`（润色后的文本），或 `{ ok: false, error: { code, message, details } }`（显式失败）：

- `draft-blank` — 去除空白后草稿为空。
- `input-too-large` — JSON 框架后的输入超过 `maxInputBytes`。
- `no-route` — 会话既没有已记录的请求头，也没有包含 provider/model 的创建选项。
- `empty-output` — 规范化后模型未产出文本。
- `internal` — 流、结束原因或超时失败（超时代码 `POLISH_TIMEOUT`）。

辅助路由优先取会话日志中的 `request/header`（会话中途切换模型后的最新事实），回退到智能体创建选项。调用受必需的 `maxInputBytes`、`maxOutputTokens` 与 `timeoutMs` 部署策略约束；浏览器请求的 `AbortSignal` 可取消生成。

输出契约由系统提示词（保持含义、事实、结构与语言；仅返回纯文本润色结果）与规范化共同保证：去除首尾空白、剥离一层可选代码围栏、拒绝空结果。

## 组合

随附的 `dsh` 基础包挂载本服务；Web 组合器的润色按钮通过共享 `/api` RPC 通道调用它。不包含 Web 组合器的组合无需本包。

## 模型体验

### 模型看到什么

一条辅助用户消息，内容为 JSON 框架后的上下文行与草稿，配以固定的润色系统指令。请求携带 `purpose: 'polish'`，DeepSeek 适配器将其映射为关闭思考。此调用不会进入会话日志或对话的模型历史。

### Token 影响

在会话自身模型路由上产生辅助调用 token，受 `maxOutputTokens` 限制。调用不改变对话上下文，因此后续轮次除辅助请求本身外没有 token 或缓存差异。

### KV 缓存影响

辅助请求不属于对话历史，不影响主对话的缓存。草稿来自浏览器，组装后的上下文取自会话日志；两者在服务端均不做缓存。

## 已知限制与后续工作

- **受预算约束的上下文窗口** — 组装后的上下文受 `maxSummaryChars`、`maxRecentMessages`、`maxLineChars` 与 `maxRecentChars` 限制；最新压缩摘要之前的历史不在重写范围内。
- **一次性重写** — 无流式回传、重试策略或风格预设；成功时整体替换草稿。
