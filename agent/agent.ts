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
import { getRequestModelConfig } from "../lib/model-context";

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
 * Cached agent config, so workflow replay (which runs without an HTTP request
 * context and therefore without AsyncLocalStorage) reuses the same model object
 * that was resolved during the original execution. Without this cache,
 * `readModelConfig()` falls through to env-var defaults during replay and may
 * build a different model, causing the Workflow SDK to emit REPLAY_DIVERGENCE.
 */
let _cachedConfig: ReturnType<typeof defineAgent> | undefined;

/**
 * eve's module loader calls `materializeAuthedModuleExport` which checks if
 * the default export is a function — if so, it calls `await fn()` to get the
 * config. This lets us rebuild the model on every resolution, picking up the
 * latest config without restarting the server.
 */
export default async function createAgentConfig() {
  // During workflow replay there is no ALS context, so readModelConfig()
  // would return env-var or hard-coded defaults instead of the per-request
  // config.  Return the cached config to keep the model stable across replay.
  const alsConfig = getRequestModelConfig();
  if (_cachedConfig && !alsConfig) {
    return _cachedConfig;
  }

  const config = readModelConfig();

  console.log("===========agent called==========", config.provider);

  const agentConfig = defineAgent({
    model: buildModel(config),
    modelContextWindowTokens: getModelContextWindow(config.provider),
    compaction: {
      thresholdPercent: 0.75,
    },
    build: {
      externalDependencies: ["@zvec/zvec"],
    },
  });

  _cachedConfig = agentConfig;
  return agentConfig;
}
