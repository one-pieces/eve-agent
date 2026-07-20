import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { defaultSettingsMiddleware, wrapLanguageModel } from "ai";
import { defineAgent } from "eve";
import {
  readModelConfig,
  type ModelConfig,
} from "../lib/model-config";

const MODEL_REQUEST_LOG_DIR = join(process.cwd(), ".model-requests");

const loggingFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.toString();
  const body = init?.body;

  await mkdir(MODEL_REQUEST_LOG_DIR, { recursive: true });
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  await writeFile(
    join(MODEL_REQUEST_LOG_DIR, fileName),
    JSON.stringify(
      {
        url,
        method: init?.method,
        headers: init?.headers,
        body: typeof body === "string" ? JSON.parse(body) : body,
      },
      null,
      2,
    ),
  );

  const response = await fetch(input, init);

  const responseClone = response.clone();
  void (async () => {
    try {
      const rawText = await responseClone.text();
      await writeFile(
        join(
          MODEL_REQUEST_LOG_DIR,
          fileName.replace(/\.json$/, ".response.txt"),
        ),
        rawText,
      );
    } catch (error) {
      console.error("Failed to log model response", error);
    }
  })();

  return response;
};

function buildModel(config: ModelConfig) {
  const { provider, baseUrl, apiKey, model, guardrailIdentifier, guardrailVersion } = config;

  if (provider === "bedrock") {
    const anthropic = createAnthropic({
      baseURL: baseUrl || undefined,
      apiKey: apiKey || undefined,
      fetch: loggingFetch,
      headers: {
        "x-portkey-api-key": apiKey!,
        "x-portkey-provider": "bedrock",
        "x-portkey-forward-headers":
          "X-Amzn-Bedrock-GuardrailIdentifier,X-Amzn-Bedrock-GuardrailVersion",
        "X-Amzn-Bedrock-GuardrailIdentifier": guardrailIdentifier!,
        "X-Amzn-Bedrock-GuardrailVersion": guardrailVersion!,
      },
    });

    return wrapLanguageModel({
      model: anthropic(model),
      middleware: defaultSettingsMiddleware({
        settings: { maxOutputTokens: 128000 },
      }),
    });
  }

  // deepseek, LM Studio, Ollama – all use OpenAI-compatible APIs
  const openai = createOpenAI({
    baseURL: baseUrl || undefined,
    apiKey: apiKey || "not-needed",
    fetch: loggingFetch,
  });

  return openai.chat(model);
}

function getModelContextWindow(provider: ModelConfig["provider"]): number {
  switch (provider) {
    case "bedrock":
      return 200_000;
    case "deepseek":
      return 128_000;
    case "LM Studio":
    case "Ollama":
      return 32_768;
  }
}

/**
 * eve's module loader calls `materializeAuthoredModuleExport` which checks if
 * the default export is a function — if so, it calls `await fn()` to get the
 * config. This lets us rebuild the model on every resolution, picking up the
 * latest config without restarting the server.
 */
export default async function createAgentConfig() {
  const config = readModelConfig();

  console.log("===========agent called==========", config.provider);

  return defineAgent({
    model: buildModel(config),
    modelContextWindowTokens: getModelContextWindow(config.provider),
    compaction: {
      thresholdPercent: 0.75,
    },
  });
}
