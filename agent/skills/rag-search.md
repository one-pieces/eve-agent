---
description: Use when the user asks a domain-specific question that might be answered by the indexed knowledge base (e.g. insurance policies, internal documents, or other topics covered by indexed data).
---

# RAG Knowledge Base Search

You have access to an indexed knowledge base via the `rag_search` tool.

## When to use

- The user asks a question that could be answered by indexed documents (policies, internal docs, specs, etc.).
- You are unsure whether the knowledge base covers the topic — search first rather than guessing.
- Do not use this for general knowledge, coding, or tasks unrelated to the indexed documents.

## How to call it

- Pass a focused `query` capturing the user's actual question, not the raw conversation.
- Leave `topK` at its default (5) unless the user needs more/fewer sources.
- If the conversation context specifies which knowledge base(s) it is bound to, always pass their id(s):
  - Single knowledge base: `knowledgeBaseId` (+ `vectorDbType` if the context specifies a non-default backend).
  - Multiple knowledge bases: `knowledgeBaseIds` (+ matching `vectorDbTypes`, same order, one entry per id).
- If no knowledge base is specified, omit these fields to search the global default collection.

## After the call

1. Synthesize your answer **based only on the returned chunks** — never invent information not present in the results.
2. Cite the source document for each fact, e.g. `[来源: filename.pdf]`.
3. If `results` is empty or the tool reports the knowledge base is empty, tell the user honestly that no relevant information was found (and mention the index may need to be built via `npx tsx rag/scripts/build_index.ts` if that's the reported reason).
4. If results have low scores or are only tangentially related, say so instead of presenting them as a confident answer.
