/**
 * 答案生成模块 —— 对应原 Python src/generator.py
 *
 * 把检索到的上下文塞进 prompt，调 LLM 生成答案，
 * 并要求标注引用来源，做到「有据可查、不瞎编」。
 */

import { llmCall } from "./llm";
import type { Answer, LLMMessage, RetrievedChunk } from "./types";

const SYSTEM_PROMPT =
  "你是严谨的保险客服助手。请严格遵守：\n" +
  "1) 只能依据【参考资料】回答，资料里没有的信息，直接说「根据现有资料无法确定」，绝不编造；\n" +
  "2) 在用到资料的地方，用 [编号] 标注来源（对应资料前的序号），做到有据可查；\n" +
  "3) 回答简洁、用词通俗，面向没有保险背景的普通用户。";

/**
 * 将检索到的上下文格式化为带编号的字符串
 */
function formatContexts(contexts: RetrievedChunk[]): string {
  return contexts
    .map((rc, i) => `[${i}] (来源：${rc.chunk.source}) ${rc.chunk.text}`)
    .join("\n\n");
}

/**
 * 构建发送给 LLM 的消息列表
 */
export function buildMessages(
  query: string,
  contexts: RetrievedChunk[],
): LLMMessage[] {
  const user = `【参考资料】\n${formatContexts(contexts)}\n\n【问题】\n${query}`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

/**
 * 生成带引用的答案
 */
export async function generate(
  query: string,
  contexts: RetrievedChunk[],
): Promise<Answer> {
  if (contexts.length === 0) {
    return {
      text: "根据现有资料无法确定。没有检索到与该问题相关的内容。",
      sources: [],
    };
  }

  const text = await llmCall(buildMessages(query, contexts));
  const sources = [...new Set(contexts.map((rc) => rc.chunk.source))].sort();
  return { text, sources };
}
