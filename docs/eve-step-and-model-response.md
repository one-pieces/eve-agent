# eve 的 step 概念与模型原始响应分析

## 1. eve 里的一个 step 是不是就是对模型的一次请求？

是，基本对应一次模型请求。

根据 eve 官方文档 `docs/concepts/execution-model-and-durability.md` 的定义，一个 session 的工作分三层：

- **session**：整个持久化的对话/任务，可以跨天跨周运行，不会丢失上下文。
- **turn**：一条用户消息触发的所有工作（模型调用、工具调用、推理），直到 agent 产出回复为止。
- **step**：turn 内部的一个"持久化检查点"，官方原话是 *"one model call and the tool calls it makes"*（一次模型调用 + 它触发的工具调用）。

要点：

- **一个 step = 一次 `streamText` 模型调用**，加上这次调用里模型要求执行的工具调用及其结果。
- 如果模型在一次调用里连续要求多个工具调用（比如同时调用 3 个 tool），这些工具调用结果仍算在**同一个 step** 里，不是各自一个 step。
- 一个 **turn** 通常由多个 step 组成：step 1 模型决定调用工具 → 执行 → step 2 模型看到结果再决定 → ... → 最后一个 step 模型给出终态回复（`finishReason` 不再是工具调用）。
- `instrumentation.md` 里的 trace 结构印证了这一点：每个 `ai.streamText` span（= 一个 step）对应一次 `ai.streamText.doStream`（= 一次模型调用）。事件流里的 `step.started` / `step.completed` 就是这个粒度。

结合项目里 `agent/agent.ts` 的 `loggingFetch`：`.model-requests/` 目录下每一对 `.json`（请求）+ `.response.txt`（响应）文件，正好对应**一个 step 里的那一次模型调用**。如果一个 turn 有多个 step，会看到多组文件。

## 2. "step" 是 eve 自己定义的流程，还是模型的规范？其它框架有类似概念吗？

### 不是模型厂商的协议

Anthropic Messages API / OpenAI Chat Completions API 本身没有 "step" 概念，就是一问一答（一次 HTTP 请求 = 一次 completion，可能带 `tool_use` block）。多轮工具调用的循环（调用模型 → 执行工具 → 再调用模型…）完全是客户端自己维护的。

### 直接来源：Vercel AI SDK

eve 底层用的是 Vercel AI SDK 的 `streamText`/`generateText`，AI SDK 本身就原生定义了多步循环概念：

- `StopCondition`、`isStepCount`（`stepCountIs`）：控制何时停止多步循环
- `onStepFinish`：官方注释是 *"Callback that is called when each step (LLM call) is finished, including intermediate steps."*

也就是说，**"step = 一次 LLM call" 这个定义来自 Vercel AI SDK 本身**，eve 只是在这个已有边界上加了 workflow 级别的持久化 checkpoint（崩溃/重启后从上一个完成的 step 恢复，而不是重放整个 turn），并没有重新发明这个概念。

### 层次对照表

| 层次 | 是否有 "step" 概念 |
|---|---|
| 模型 API 协议（Anthropic Messages / OpenAI Chat Completions） | 没有，单次请求-响应，循环逻辑由客户端控制 |
| Vercel AI SDK（`generateText`/`streamText`） | 有，原生定义：`stopWhen`、`StopCondition`、`isStepCount`、`onStepFinish` |
| eve | 复用 AI SDK 的 step 边界，额外加了 workflow 持久化 checkpoint |

### 其它框架的等价概念

- **LangChain**（`AgentExecutor`）：叫 **iteration**，每次迭代 = 一次模型调用 + 解析出的 action + 执行结果，累积在 `intermediateSteps` 列表里；上限用 `maxIterations` 控制，逻辑上和 eve 的 step 是同一个粒度。
- **LangGraph**：叫 **super-step**（Pregel 风格的图执行模型），每个图节点的一次执行算一跳；用 `create_react_agent` 预置图时，一个 super-step 通常也对应一次模型调用 + 工具执行。
- **OpenAI Assistants API**（平台级，非 Chat Completions）：有官方对象叫 **Run Step**（`run_step`），一个 `run` 由多个 `run_step` 组成，每个 step 是一次 `message_creation` 或一次 `tool_calls`。这是目前唯一在模型厂商侧对外暴露 "step" 这个词的平台级 API。
- **LlamaIndex**（`AgentRunner`/`Workflow`）：也用 **step**，`run_step()` 手动推进一步。

结论：这是一个 **agent 编排层的通用抽象**（不同框架命名不同：step / iteration / super-step / run step），语义高度一致，都指"一次模型调用 + 由它触发的工具执行"，不是任何底层模型 API 规定的东西。

## 3. 模型原始响应内容分析（示例：`1783415032554-zqh4ft.response.txt`）

这是 Anthropic Messages API 的 **SSE 流式响应**（通过 Bedrock 调用 `anthropic.claude-sonnet-4-6`），本次 step 的模型行为是**发起一次工具调用**，没有输出任何文本。

### 事件流拆解

**1. `message_start`**
- 模型：`anthropic.claude-sonnet-4-6`
- usage（起始）：`input_tokens: 3`，`cache_creation_input_tokens: 4998`（新写入 5 分钟缓存 4998 tokens），`cache_read_input_tokens: 0`（本次未命中已有 prompt cache）

**2. `content_block_start` (index 0, type: `tool_use`)**
- 模型决定调用工具 **`rag_search`**（对应 `agent/tools/rag_search.ts`）
- `id: toolu_bdrk_012A7i8dg5hEeXQxHRFhTgeK`

**3. 一串 `content_block_delta`（`input_json_delta`）**

工具入参是流式拼出来的（`partial_json` 分片），拼接完整后是：

```json
{
  "query": "新型能源体系建设\"十五五\"规划主要目标",
  "knowledgeBaseId": "d35118c3-654e-4001-a26b-e86a4b07e4e7",
  "vectorDbType": "chroma",
  "topK": 8
}
```

对应 `rag_search` 工具 schema 里的 `query` / `knowledgeBaseId` / `vectorDbType` / `topK` 参数；`knowledgeBaseId` 对应项目里 `app/knowledge/[id]/page.tsx` 展示的知识库 ID，`vectorDbType: chroma` 命中的是 `app/api/knowledge/vector-index/chroma.ts` 后端。

**4. `content_block_stop` → `message_delta`**
- `stop_reason: "tool_use"` —— 这就是这个 step 结束的原因：模型没打算直接回答，而是先请求调用工具
- 最终 usage：`output_tokens: 157`（生成 tool_use JSON 参数消耗的输出 token）

**5. `message_stop`**
- Bedrock 特有的调用指标：`invocationLatency: 2275ms`，`firstByteLatency: 1329ms`
- `cacheWriteInputTokenCount: 4998` —— 说明这轮把系统提示词/工具定义等 4998 tokens 写入了 prompt cache，后续同一 5 分钟内的请求应该能看到 `cache_read_input_tokens` 命中，降低成本延迟

### 结论

这一个 step 完整对应上面第 1 节的定义：**一次模型调用（这次没有输出文本，`stop_reason=tool_use`）+ 它请求的工具调用**（`rag_search`）。eve 收到这个 `tool_use` block 后会去执行 `rag_search` 工具，然后带着工具结果发起下一次模型请求（也就是下一个 step，会产生下一对 `.model-requests/` 文件）。

## 附：如何获取每次模型请求/响应的原始内容

项目 `agent/agent.ts` 中通过自定义 `loggingFetch` 拦截了传给 Anthropic SDK 的 `fetch`：

- **请求**：同步写入 `.model-requests/<timestamp>-<rand>.json`（`url`/`method`/`headers`/`body`）
- **响应**：`response.clone()` 后异步读取原始 SSE 文本，写入配对文件 `.model-requests/<timestamp>-<rand>.response.txt`，不阻塞、不消费真正返回给 AI SDK 的流

eve 自身没有提供开箱即用的"导出模型原始 HTTP 响应"接口，其内置能力（`agent/hooks/*.ts` 订阅 `message.completed` / `action.result` 等事件、OpenTelemetry instrumentation）拿到的都是 AI SDK 解析归一化之后的消息对象，不是逐字节原始响应，所以自定义 `fetch` wrapper 是目前最直接的方式。
