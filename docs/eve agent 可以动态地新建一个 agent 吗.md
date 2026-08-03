# eve agent 可以动态的新建一个 agent 吗？

**不可以**在 eve 框架中动态新建一个 agent。以下是详细说明：

## 框架对 Agent 的限制

Subagent（子 agent）是**构建时静态声明**的，必须预先定义在文件系统中：

```
agent/subagents/<id>/
├── agent.ts     # 必须包含 description
├── instructions.md
└── tools/
```

框架没有提供任何 API 来在运行时动态注册或创建新的 agent。

## 什么可以动态化

`defineDynamic` 只支持以下三类资源的运行时动态解析：

| 资源类型         | 路径                  | 触发事件                                          |
| ---------------- | --------------------- | ------------------------------------------------- |
| **Tools**        | `agent/tools/`        | `session.started`, `turn.started`, `step.started` |
| **Skills**       | `agent/skills/`       | `session.started`, `turn.started`                 |
| **Instructions** | `agent/instructions/` | `session.started`, `turn.started`                 |

## 最接近"动态 agent"的方案

1. **预声明多个 subagent**，让 parent agent 根据上下文决定委派给哪一个（通过 `Workflow` 工具做编排）

2. **Remote agents**：通过 `defineRemoteAgent` 将独立部署的 eve agent 当作 subagent 使用，但 URL 仍需在文件中静态声明

3. **动态 Instructions + built-in `agent` 工具**：通过动态指令给同一个 agent 注入不同角色/行为，再用 `agent` 工具（agent 的自我复制）去执行，变相模拟"不同 agent"的效果

---

总结：eve 的 agent 拓扑是**构建时固定**的，运行时只能动态改变 agent 的工具、技能、指令，不能创建新 agent。
