import { getRequestModelConfig } from "./model-context";

export interface ModelConfig {
  provider: "bedrock" | "deepseek" | "LM Studio" | "Ollama";
  baseUrl: string;
  model: string;
  apiKey: string;
  guardrailIdentifier: string;
  guardrailVersion: string;
}

const DEFAULTS: ModelConfig = {
  provider: "bedrock",
  baseUrl: "",
  model: "",
  apiKey: "",
  guardrailIdentifier: "",
  guardrailVersion: "",
};

/**
 * In-memory server-level default override.
 * Set via the settings API (`POST /api/settings/model`) so the GET endpoint
 * returns a meaningful value.
 */
let _serverDefault: Partial<ModelConfig> | null = null;

export function readModelConfig(): ModelConfig {
  // 1️⃣ AsyncLocalStorage — set by the custom eve channel's route handler
  //     before calling send().  This is the multi-user path: each HTTP
  //     request gets its own ALS context, so concurrent users never collide.
  const alsConfig = getRequestModelConfig();
  if (alsConfig) {
    return { ...DEFAULTS, ...alsConfig };
  }

  // 2️⃣ Server-level in-memory override (set via settings API, lost on restart).
  if (_serverDefault) {
    return { ...DEFAULTS, ..._serverDefault };
  }

  // 3️⃣ Environment variables (for headless / production deployment).
  const envConfig = readModelConfigFromEnv();
  if (envConfig) {
    return { ...DEFAULTS, ...envConfig };
  }

  // 4️⃣ Hard-coded defaults (last resort).
  return { ...DEFAULTS };
}

/**
 * Read model config from environment variables.
 * Useful for production deployments that want a fixed default model.
 *
 * Supported env vars:
 *   EVE_MODEL_PROVIDER  — "bedrock" | "deepseek" | "LM Studio" | "Ollama"
 *   EVE_MODEL_BASE_URL  — base URL for the provider API
 *   EVE_MODEL_NAME      — model name / ID
 *   EVE_MODEL_API_KEY   — API key
 */
function readModelConfigFromEnv(): Partial<ModelConfig> | null {
  const provider = process.env.EVE_MODEL_PROVIDER;
  const baseUrl = process.env.EVE_MODEL_BASE_URL;
  const model = process.env.EVE_MODEL_NAME;
  const apiKey = process.env.EVE_MODEL_API_KEY;

  if (!provider && !baseUrl && !model && !apiKey) return null;

  const cfg: Partial<ModelConfig> = {};
  if (provider === "bedrock" || provider === "deepseek" || provider === "LM Studio" || provider === "Ollama") {
    cfg.provider = provider;
  }
  if (baseUrl) cfg.baseUrl = baseUrl;
  if (model) cfg.model = model;
  if (apiKey) cfg.apiKey = apiKey;
  return cfg;
}
