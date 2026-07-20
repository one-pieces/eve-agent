# Session 管理机制

## 数据结构

每个 session 由 `SessionRecord` 描述（`app/_hooks/use-session-list.ts`）：

```typescript
interface SessionRecord {
  id: string;                  // 前端本地唯一 ID（crypto.randomUUID）
  title: string;
  createdAt / updatedAt: string;
  sessionState: {
    sessionId: string;         // eve 框架服务端 session ID
    continuationToken?: string; // 用于跨次恢复的令牌
    streamIndex: number;
  };
  knowledgeBaseIds?: string[];
}
```

## 存储层（纯 localStorage，无服务端持久化）

三个独立的 key：

| Key 模式 | 内容 |
|---|---|
| `eve-session-list` | 所有 `SessionRecord[]` 的 JSON |
| `eve-session-messages-{id}` | 该 session 的消息历史 |
| `eve-session-token-usage-{id}` | token 用量统计 |

---

## Session 生命周期

### 1. 创建

触发点：用户点击"New Conversation"按钮  
位置：`app/(chat)/page.tsx` 或 layout 侧边栏

流程：
1. `createSession()` 生成 `crypto.randomUUID()` 作为前端 ID
2. 初始 `sessionState.sessionId = ""`（空，尚未与 eve 服务端关联）
3. 写入 localStorage，`setActiveId`
4. 路由跳转至 `/session/{id}`

### 2. 连接 eve 框架（首次对话时）

`app/_components/agent-chat.tsx`：

```typescript
const initialSession = sessionRecord?.sessionState?.sessionId
  ? sessionRecord.sessionState   // 有 sessionId → 恢复模式
  : undefined;                   // 无 → 新建
```

`useEveAgent({ initialSession })` 决定是新建还是续接服务端 session。每次 session 状态变化（`onSessionChange`），都回调给 `SessionPage` 更新 localStorage 中的 `sessionState`。

### 3. 消息持久化

- **写入**：`onFinish(snapshot)` 回调时，把 restored + live 消息合并后 `saveSessionMessages()` 写 localStorage
- **读取**：组件挂载时 `loadSessionMessages(sessionRecord.id)` 一次性读取，赋给 `restoredMessages.current`

### 4. 恢复（页面刷新 / 重新打开）

恢复分两个维度：

- **UI 消息恢复**：从 localStorage 读出历史消息直接渲染（不需要服务端）
- **服务端 session 恢复**：将 `continuationToken` + `sessionId` 作为 `initialSession` 传给 `useEveAgent`，让 eve 框架续接服务端上下文

若服务端 session 已失效（`sessionId` 过期），会触发 `prepareSend`，把历史消息格式化为 `clientContext` 注入新 session，最多 12,000 字符（`app/_components/agent-chat.tsx` - `formatMessagesAsContext`）。

**ID 碰撞处理**：服务端重置后 turn ID 会从头计数，`mergeMessages()` 通过对比消息文本内容判断是否真正重复，不同内容则给旧消息加 `__prev{n}` 后缀。

### 5. 删除

`deleteSession(id)` 同时清除：
- `eve-session-list` 中该条记录
- `eve-session-messages-{id}`
- `eve-session-token-usage-{id}`

如果删除的是当前 active session，路由回 `/`。

---

## 架构总结

```
前端 localStorage ←→ useSessionList (React state)
                           ↓
                   SessionContext（全局）
                           ↓
                   AgentChat（每个会话页）
                           ↓
                   useEveAgent (eve 框架)
                           ↓
                   eve 服务端（有状态，session 以 continuationToken 续接）
```

**关键设计**：服务端 session 是有状态但非持久的，所有持久化由前端 localStorage 承担；跨越服务端重置时靠 `clientContext` 文本摘要兜底，而非重放完整消息历史。

## 相关文件索引

| 文件 | 职责 |
|---|---|
| `app/_hooks/use-session-list.ts` | session CRUD、localStorage 读写、token 用量存取 |
| `app/_context/session-context.tsx` | 全局 SessionContext Provider |
| `app/(chat)/layout.tsx` | 侧边栏渲染、新建/选择/删除 session 路由 |
| `app/(chat)/page.tsx` | 空状态页，引导创建新 session |
| `app/(chat)/session/[id]/page.tsx` | 单个 session 页，绑定 URL 参数与 session 记录 |
| `app/_components/agent-chat.tsx` | 核心聊天组件，消息合并、历史注入、token 统计 |

# 服务端 session 为什么会失效？什么时候会失效？session 不应该是稳定的吗


这是个很好的问题，核心原因在于**架构选择**——服务端 session 是**纯内存**的，不是数据库持久化的。

## 为什么会失效

### 1. 服务端重启 / Vercel 冷启动（最主要原因）

这个项目用 `eve/next` 部署在 Next.js（通常是 Vercel）上：

```~/eve-agent/next.config.ts:1-8
import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@zvec/zvec", "chromadb"],
};

export default withEve(nextConfig);
```

Vercel 的函数是**无状态 Serverless**，每次冷启动都是全新进程，没有任何内存状态。Eve 框架的 session（包含消息历史、工具调用状态等）存在服务端内存里，**进程一重启就没了**。本地开发时也一样，`next dev` 重启就丢失。

### 2. Context Window 压缩（Compaction）

```~/eve-agent/agent/agent.ts:86-94
export default defineAgent({
  model: buildModel(),
  modelContextWindowTokens: isLocalModel
    ? 32_768
    : 200_000,
  compaction: {
    thresholdPercent: 0.75,
  },
});
```

当 context window 用量到达 75%（约 15 万 token）时，eve 框架会自动 compact——把历史对话总结压缩，**产生一个新的 session 状态**。原来的 `continuationToken` 会随之更新或重置。

### 3. Session TTL / Token 过期

`continuationToken` 本身通常有过期时间（这是 eve 框架内部行为），长时间不活跃的 session 会自然失效。

---

## "应该稳定"的误解

Session 稳定需要**有状态的服务端**（比如把 session 写入 Redis / 数据库）。当前架构选择了无状态部署（Serverless），因此：

| 层 | 持久化方式 | 稳定性 |
|---|---|---|
| 前端消息历史 | localStorage | 稳定（浏览器不清数据就在） |
| 服务端 session 上下文 | 进程内存 | **不稳定**（重启即失效） |

`continuationToken` 是 eve 框架提供的"尽力而为"恢复机制——运气好服务没重启就能续上；运气不好就走 [prepareSend](../app/_components/agent-chat.tsx:198:4-214:5) 的 `clientContext` 兜底路径，把历史对话文本注入到新 session 里。

代码注释也直接说明了这点：

```~/eve-agent/app/_components/agent-chat.tsx:179-181
  // When a session restarts (server resets), inject previous conversation
  // history as clientContext so the agent has awareness of earlier messages.
  const historyInjected = useRef(false);
```

如果想要真正稳定的 session，需要 eve 框架支持把 session 状态持久化到外部存储（数据库）。


# 其它的框架，比如 langchain 是怎么管理 session 的？也是跟 eve 类似吗

主流框架的 session 管理思路差异挺大，从简单到复杂分几个层次：

## LangChain / LangGraph

**LangGraph** 是 LangChain 生态里专门处理有状态对话的框架，它的设计最接近"真正稳定的 session"：

- **Checkpointer（持久化层）**：核心概念，支持把 graph state（相当于 session）写入外部存储
  - `MemorySaver` — 内存，同 eve，重启即失效
  - `SqliteSaver` / `PostgresSaver` — 写入数据库，**跨重启存活**
  - `RedisSaver` — 适合生产高并发
- **Thread ID**：每个对话有一个 `thread_id`，下次发消息带上同一个 ID，框架自动从 checkpointer 恢复完整状态
- 恢复是**完整重放**，不是文本摘要注入，上下文语义完全保留

```python
# LangGraph 示例
from langgraph.checkpoint.postgres import PostgresSaver

checkpointer = PostgresSaver(conn)
graph = workflow.compile(checkpointer=checkpointer)

# 同一个 thread_id → 自动续接
config = {"configurable": {"thread_id": "abc123"}}
graph.invoke({"messages": [...]}, config)
```

## 对比其他框架

| 框架 | 默认存储 | 持久化 | 恢复机制 |
|---|---|---|---|
| **eve**（本项目） | 进程内存 | 否（前端 localStorage 兜底） | `continuationToken` + `clientContext` 文本注入 |
| **LangGraph** | 可插拔 Checkpointer | 可选（Postgres/Redis） | 完整 state 重放 |
| **LlamaIndex** | 内存 `ChatMemoryBuffer` | 否（需自己实现） | 无内置机制 |
| **Vercel AI SDK** | 无（纯 stateless） | 否 | 每次请求带完整 messages |
| **OpenAI Assistants API** | OpenAI 云端 | **是**（官方托管） | Thread ID 即可恢复 |

## 核心设计差异

**Vercel AI SDK**（eve 的底层依赖之一）走的是 **stateless** 路线 — 每次请求客户端负责把完整 messages 带上，服务端完全无状态，Serverless 友好，但 context 大了之后传输开销大。

**LangGraph / OpenAI Assistants** 走的是 **stateful** 路线 — 服务端保存完整 graph state，客户端只需带 thread ID，恢复无损，但需要有状态基础设施（数据库 / 官方托管）。

**eve** 的当前方案介于两者之间 — 服务端有 session 内存状态（比纯 stateless 稍强），但不持久化，用前端 localStorage + `clientContext` 文本摘要兜底，算是在 Serverless 限制下的工程折中。

# 回到 eve，为什么需要使用 clientContext 来将之前的 message 记录发给模型，而不是直接将所有 message 记录完整发送给模型？



这是个关键的设计问题。答案有几个层次：

## 1. API 层面：`useEveAgent` 没有提供"注入历史消息"的接口

`useEveAgent` 管理的 `messages` 是**当前服务端 session 的对话状态**，是 eve 框架内部维护的。它不提供直接往这个状态里追加旧 messages 的能力。[prepareSend](../app/_components/agent-chat.tsx:198:4-214:5) 里唯一能扩展的是 `clientContext`（字符串数组），不是 messages 列表。

## 2. 格式层面：旧 session 的 messages 不能直接在新 session 里用

历史消息里包含结构化的工具调用：

```~/eve-agent/app/_components/agent-chat.tsx:96-112
function filterIncompleteToolCalls(messages: readonly any[]): any[] {
  if (messages.length === 0) return [];

  const filtered = [...messages];

  // Check if the last message is an assistant message with tool_use
  const lastMsg = filtered[filtered.length - 1];
  if (lastMsg?.role === "assistant") {
    const hasToolUse = lastMsg.parts?.some((p: any) => p.type === "tool_use");
    if (hasToolUse) {
      // Remove this incomplete tool call
      filtered.pop();
    }
  }

  return filtered;
}
```

旧 session 里的 `tool_use` / `tool_result` 消息携带的 `tool_use_id` 是前一个 session 生成的，**在新 session 里这些 ID 完全无效**。直接发给模型会产生 API 错误（tool_result 找不到匹配的 tool_use）。这也是为什么要专门写 [filterIncompleteToolCalls](../app/_components/agent-chat.tsx:91:0-111:1) 来兜底。

## 3. 语义层面：这是 fallback，不是主路径

这两种机制分工不同：

```
initialSession（含 continuationToken）→ 服务端 session 还在 → 完整上下文，无损恢复
         ↓ 服务端 session 已失效
clientContext 文本摘要 → 注入新 session → 模型知道"之前发生了什么"
```

`clientContext` 只在 **第一次发消息时注入一次**（`historyInjected.current` 防止重复），且只注入纯文本的对话摘要，不包含工具调用细节。这是有意为之——在新 session 里重放旧 session 的工具调用没有意义，模型不需要"假装"那些工具结果还有效。

## 4. Token 成本

即使格式问题可以解决，完整发送所有 messages 代价也更高。`clientContext` 最多 12,000 字符，对长对话做了裁剪：

```~/eve-agent/app/_components/agent-chat.tsx:427-438
  const MAX_CHARS = 12_000;
  let body = lines.join("\n\n");
  if (body.length > MAX_CHARS) {
    const trimmed: string[] = [];
    let len = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (len + lines[i].length > MAX_CHARS) break;
      trimmed.unshift(lines[i]);
      len += lines[i].length;
    }
    body = "[…earlier messages omitted…]\n\n" + trimmed.join("\n\n");
  }
```

---

**总结**：不是"选择不发完整消息"，而是：①API 不支持，②格式不兼容（tool_use ID 跨 session 无效），③语义上在新 session 里重放旧工具调用没有意义。`clientContext` 是在这些限制下最合理的降级方案。

# 使用 clientContext 可能会有一些问题，比如无法使用模型的缓存功能来节省 token，关于这个问题，其它框架是怎么解决的？还是它们没有这问题，是因为它们 的 session 不是存在内存，还是持久化存储了，所以没有这问题？

你的直觉完全正确。这是 eve 当前方案的一个真实代价，其他框架的处理方式正好印证了你的猜测。

## 为什么 `clientContext` 破坏缓存

Claude 的 prompt cache 工作原理：**相同的 message prefix 才能命中缓存**。

`clientContext` 是把历史对话序列化成文本字符串，注入到新 session 第一条消息的 context 里。每次服务端 session 失效重建，这个字符串都是当场生成的，和上一次发给模型的 messages 结构完全不同 → **cache 永远 miss**。

---

## 其他框架的情况

### Vercel AI SDK（纯 stateless）— 无此问题，反而最 cache 友好

```
Turn 1 → [system, user_1]
Turn 2 → [system, user_1, assistant_1, user_2]   ← prefix 相同，命中缓存
Turn 3 → [system, user_1, assistant_1, user_2, assistant_2, user_3]
```

每轮客户端都发**完整**历史消息列表。因为 `user_1, assistant_1...` 这部分每次都原封不动，Claude 对前缀的缓存完美命中。**stateless 反而天然 cache 友好**，代价只是每次请求的带宽/token 传输量随对话增长。

### LangGraph + 持久化 Checkpointer — 无此问题

从 Postgres/Redis 恢复的是**原始结构化 messages**，和上次发给模型的列表完全一致 → prefix 相同 → cache 命中。这是持久化存储的直接好处，不只是"session 不丢"，还顺带让 cache 工作正常。

### OpenAI Assistants API — 无此问题

Thread 历史由 OpenAI 服务端托管，模型侧 OpenAI 自己控制 context 拼装，内部有 caching，对开发者透明。

---

## 对比总结

| 方案 | Session 存储 | Cache 命中 | 原因 |
|---|---|---|---|
| Vercel AI SDK stateless | 无（客户端带全量） | ✅ | 每次发相同的 message prefix |
| LangGraph + DB | 数据库 | ✅ | 从 DB 恢复原始消息，prefix 一致 |
| OpenAI Assistants | OpenAI 云端 | ✅ | 平台透明处理 |
| **eve 正常情况**（session 存活） | 进程内存 | ✅ | 服务端维护同一 session，prefix 不变 |
| **eve fallback**（clientContext） | — | ❌ | 文本摘要与原 messages 结构不同 |

---

## 核心结论

你的判断是对的：**其他框架没有这个问题，根本原因就是它们要么持久化了 session，要么干脆全量传消息**。这两种策略都保证了发给模型的 message prefix 在多次请求间保持一致。

eve 的 `clientContext` 降级路径本质上是在两个"正确方案"之间走了一条捷径——既没有存储完整 messages，又没有持久化 session state，代价就是在 session 失效后的第一轮对话里，牺牲了 cache 和完整语义。

# 模型的缓存可以持续多久？如果在缓存期内，那不管是持久化还是全量传消息，都能缓存到，那省 token 效果是好的，但如果在缓存失效后，还全量发送历史消息，那 token 消耗可能会比 clientContext 的方案要高？

这个分析非常准确，缓存 TTL 是整个对比的关键变量。

## Claude 缓存有效期

Claude 的 prompt cache 默认 TTL 是 **5 分钟**，Anthropic 也提供 extended cache（约 1 小时，需显式标记 `cache_control`）。这意味着：

- 活跃对话（< 5 分钟内连续发消息）→ 大概率命中
- 正常使用节奏（几分钟到几小时一条消息）→ **大概率冷缓存**

## 缓存失效后的 token 成本对比

| 方案 | 缓存失效时每轮发送量 | 随对话增长 |
|---|---|---|
| 全量发送（stateless） | 完整历史 messages（O(n)） | 线性增长，越聊越贵 |
| clientContext 摘要 | 最多 12K chars 的文本 | 固定上限，不增长 |
| LangGraph + DB | 从 DB 加载完整历史（O(n)） | 同全量发送 |

**你的判断是对的**：全量发送方案对稀疏对话（几小时/几天回来一条消息）成本会显著高于 clientContext。因为每次都要重新付 50K、100K tokens 的历史消息费用，而缓存早就失效了。

## 正确的工程权衡

实际上没有银弹，最优解取决于对话模式：

```
活跃连续对话（缓存有效期内）：  全量发送  >  clientContext
稀疏对话（缓存早已失效）：      clientContext  >  全量发送
超长对话（history 很大）：      压缩/摘要  >  全量发送
```

这也是为什么 LangGraph / LlamaIndex 等框架都实现了 **conversation summarization**（而不只是全量存储）——到一定长度后，把旧消息归纳成摘要，只保留摘要 + 最近 N 条消息。eve 在服务端 session 存活时有 `compaction`（75% 上限自动压缩），效果类似。

## eve 的 clientContext 其实并不差

从 token 经济学角度反过来看：

- **session 存活时**：服务端维护完整 context，模型侧缓存有效 → 最优
- **session 失效时**（clientContext 触发）：发一份 12K 字的摘要，比重发几万 token 的历史消息便宜得多

所以 clientContext 降级方案在 token 成本上，**对稀疏对话反而更合理**。它真正的代价不是 token 多，而是语义损失（工具调用细节丢失、上下文精度下降）。

# 看下 .workflow-data 里的文件

现在有了完整图景。**`.workflow-data` 正是 eve 框架的 session 持久化层**，数据结构非常清晰：

## `.workflow-data` 目录结构

```
.workflow-data/
├── runs/           # 每个 wrun_*.json = 一个服务端 session 的元数据
├── steps/          # 每个 step 的执行记录（stepName, input, output, status）
├── events/         # 运行时事件日志（run_started 等）
├── streams/chunks/ # 流式输出数据块
└── hooks/tokens/   # hook 相关数据
```

`runs/wrun_01KXJ4DXMYMTZGW643G4XJ6KRD.json` 里的内容：

```json
{
  "runId": "wrun_01KXJ4DXMYMTZGW643G4XJ6KRD",
  "status": "running",
  "workflowName": "workflow//eve//workflowEntry",
  "attributes": {
    "$eve.type": "session",
    "$eve.title": "帮我将 eve-agent 项目里的 connections..."
  }
}
```

**`runId` 就是 `sessionState.sessionId`**——前端存的 `wrun_01KXJ...` 和这里完全对应。

---

## 关键发现：session 数据其实是持久化到磁盘的

之前分析"session 存内存会失效"并不完全准确。`.workflow-data` 证明 eve 框架的 workflow runtime 会把 session 状态写到磁盘。

但 `yarn start` 的报错暴露了真正的问题：

```
Failed to proxy http://127.0.0.1:4274/eve/v1/session/wrun_...
Error: connect ECONNREFUSED 127.0.0.1:4274
```

**eve 是两进程架构**：
- `next start`（端口 3000）— Next.js 前端 + API routes
- eve runtime server（端口 4274）— 真正管理 session 的 workflow 引擎，读写 `.workflow-data`

`yarn start` 只启了 Next.js，没有启 eve runtime。`yarn dev` 应该会同时启动两者。session "失效"并不是数据丢了，而是 **eve runtime 进程没跑**，导致 Next.js 无法代理到它。

---

## 修正之前的结论

| 之前的描述 | 实际情况 |
|---|---|
| session 存在进程内存，重启即失效 | session 持久化在 `.workflow-data`，数据在磁盘 |
| Serverless 友好但不持久 | 需要 eve runtime 常驻，**不是真正 Serverless** |
| clientContext 是唯一恢复手段 | eve runtime 重启后理论上可从 `.workflow-data` 恢复 |

实际问题可能是：`yarn dev` / `yarn start` 命令没有同时启动 eve runtime（4274），导致每次重启 Next.js 后 session 连不上，触发了 clientContext 降级路径。
