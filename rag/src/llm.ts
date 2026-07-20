/**
 * LLM 调用封装 —— 对应原 Python src/llm.py
 * 复用 eve-agent 已有的 Anthropic + Portkey + Bedrock 配置
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { LLMMessage } from "./types";

let _model: ReturnType<ReturnType<typeof createAnthropic>> | null = null;

function getModel() {
  if (!_model) {
    const anthropic = createAnthropic({
      baseURL: process.env.BASE_URL,
      apiKey: process.env.API_KEY,
      headers: {
        "x-portkey-api-key": process.env.API_KEY!,
        "x-portkey-provider": process.env.PROVIDER!,
        "x-portkey-forward-headers":
          "X-Amzn-Bedrock-GuardrailIdentifier,X-Amzn-Bedrock-GuardrailVersion",
        "X-Amzn-Bedrock-GuardrailIdentifier":
          process.env.BEDROCK_GUARDRAIL_IDENTIFIER!,
        "X-Amzn-Bedrock-GuardrailVersion":
          process.env.BEDROCK_GUARDRAIL_VERSION!,
      },
    });
    _model = anthropic(process.env.BEDROCK_MODEL!);
  }
  return _model;
}

/**
 * 调用 LLM 生成文本
 * @param messages 消息列表（支持 system / user / assistant）
 * @returns 模型生成的文本
 */
export async function llmCall(messages: LLMMessage[]): Promise<string> {
  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystemMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const { text } = await generateText({
    model: getModel(),
    system: systemMessages.length > 0 ? systemMessages[0].content : undefined,
    messages: nonSystemMessages,
    maxOutputTokens: 1024,
  });

  return text;
}
