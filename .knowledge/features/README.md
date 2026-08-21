# Feature Planning

## Purpose

`features/` 用于集中管理 DeepSeek Harness 后续迭代的信息，包括版本规划、需求文档、设计方案、任务拆解、验收标准和风险记录。

## Scope boundary

本目录回答“接下来要做什么、为什么做、如何设计、如何验证和如何拆分工作”。当前已经实现的系统事实以 [`../system/README.md`](../system/README.md)、源码、包 README 或 [`../../docs/architecture.zh.md`](../../docs/architecture.zh.md) 为准。

不要把未实现的方案写入 `system/`，也不要在功能文档中复制整段现有架构说明；功能文档只引用所需的当前事实和相关链接。

## Allowed document types

- 版本规划：目标版本、范围、依赖和发布约束；
- 需求文档：用户问题、使用场景、非目标和验收条件；
- 设计方案：影响面、数据流、接口、迁移、灰度和回滚；
- 任务拆解：按可验证结果拆分的实施任务和负责人信息；
- 风险记录：已知风险、触发条件、缓解措施和待确认问题。

## Document rules

- 每篇文档开头写明状态：`draft`、`proposed`、`accepted`、`in-progress`、`done` 或 `rejected`。
- 明确区分目标、非目标、当前事实、设计假设、待确认问题和验收条件。
- 设计方案必须链接受影响的 `system/` 知识，并列出代码入口、数据或协议变化、测试层次和回滚方式。
- 任务拆解必须对应可观察结果，不使用“完成开发”这类无法验证的任务描述。
- 功能完成后，把仍然有效的架构和使用知识迁移或补充到 `system/` 的唯一归属文档；规划文档保留必要的决策记录。
- 不把规划状态当作产品当前能力，不在 README 或系统学习指南中引用未完成功能为已可用。

## Recommended document templates

### Requirement or design document

```markdown
# <功能名称>

Status: <draft | proposed | accepted | in-progress | done | rejected>

## Problem

## Goals

## Non-goals

## Current facts

## Proposed behavior

## Affected packages and entry points

## Data, protocol, or configuration changes

## Testing and acceptance

## Risks and rollback

## Open questions
```

### Task breakdown

```markdown
# <功能名称> Task Breakdown

Status: <status>

## Deliverables

## Tasks

- [ ] <task with an observable result>

## Dependencies

## Verification commands

## Out of scope
```
