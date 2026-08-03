
# 运行时缺陷
因为 eve agent 的 agent 拓扑是构建时固定的，所以
- 无法运行时创建新的 agent
- 无法运行时加载 mcp server

# 恢复会话 session 的问题
- 无法恢复会话 session，需要借助 clientContext 来恢复，这样大概率会丢失具体的上下文信息，且无法使用 prompt 缓存
- 恢复后无法保证 agent 的状态一致性
- 恢复会话 session 的时机不确定，比如会在 approve tool 执行后恢复，这样就丢失了 approve 的上下文，比如某些 tool called 的记录，导致模型报错

# agent 运行状态不透明，报错机制不完善
- 无法在运行时捕获和处理错误，只能在构建时定义错误处理策略，比如当前 agent 任务执行的进度、目前执行到哪个步骤等
- 报错信息不完整，难以定位问题

