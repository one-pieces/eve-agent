/**
 * Query 理解与改写模块 —— 对应原 Python src/query_processor.py
 *
 * 用户原始问题往往口语、含糊。先做改写 / 扩展，再去检索，召回率能明显提升。
 * - 有 LLM → 调 LLM 做规范化改写 + 同义扩展
 * - 无 LLM → 规则兜底：去掉口语词
 */

import { llmCall } from "./llm";
import type { ProcessedQuery } from "./types";

// 口语 / 无意义词，规则兜底时删掉
const FILLER = [
  "请问",
  "麻烦问下",
  "我想问一下",
  "想了解一下",
  "一下",
  "请",
  "啊",
  "呢",
  "呀",
  "吧",
  "哈",
];

/**
 * 规则兜底改写：删口语词、去首尾标点空白
 */
function ruleRewrite(query: string): string {
  let q = query;
  for (const f of FILLER) {
    q = q.replaceAll(f, "");
  }
  return q.replace(/^[\s?？!!。,,]+|[\s?？!!。,,]+$/g, "") || query.trim();
}

/**
 * 调 LLM 做改写 + 扩展
 */
async function llmRewrite(query: string): Promise<ProcessedQuery> {
  const prompt =
    "你是检索查询改写器。把用户问题改写成更书面、更贴近文档表达的一句话，" +
    "并给出 1-3 个同义/不同角度的扩展查询（用于提高召回）。\n" +
    '只输出 JSON，格式：{"rewritten": "...", "expansions": ["...", "..."]}\n\n' +
    `用户问题：${query}`;

  try {
    const raw = await llmCall([{ role: "user", content: prompt }]);
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const data = JSON.parse(m[0]);
      const rewritten =
        (data.rewritten as string)?.trim() || ruleRewrite(query);
      const expansions = ((data.expansions as string[]) || [])
        .map((e: string) => e.trim())
        .filter(Boolean)
        .slice(0, 3);
      return { original: query, rewritten, expansions };
    }
  } catch {
    // LLM 调用失败，回退规则版
  }
  return { original: query, rewritten: ruleRewrite(query), expansions: [] };
}

/**
 * 对原始查询做理解、改写与扩展
 */
export async function processQuery(query: string): Promise<ProcessedQuery> {
  return llmRewrite(query);
}

/**
 * 获取所有查询变体（主查询 + 扩展去重）
 */
export function allQueries(pq: ProcessedQuery): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of [pq.rewritten, ...pq.expansions, pq.original]) {
    const trimmed = q.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}
