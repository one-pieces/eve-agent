import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelConfig } from "./model-config";

/**
 * Global symbol key so that Next.js and Nitro bundles share the same
 * AsyncLocalStorage instance.  Without this, each bundle creates its own
 * ALS and the value set by the channel handler (Next.js) is invisible to
 * the agent runtime (Nitro), even though they're in the same process.
 */
const GLOBAL_ALS_KEY = Symbol.for("eve.model-config-context");

const globalContainer = globalThis as Record<symbol, unknown>;
if (globalContainer[GLOBAL_ALS_KEY] === undefined) {
  globalContainer[GLOBAL_ALS_KEY] = new AsyncLocalStorage<Partial<ModelConfig>>();
}
const modelContext = globalContainer[GLOBAL_ALS_KEY] as AsyncLocalStorage<Partial<ModelConfig>>;

export { modelContext };

/**
 * Fallback global variable for model config passing.
 *
 * AsyncLocalStorage context is NOT preserved across the workflow SDK's async
 * execution boundary (the Nitro production build).  As a workaround, the
 * channel handler stores the parsed model config here before calling send(),
 * and createAgentConfig() reads it as the first source before falling back
 * to ALS or env vars.
 *
 * Since createAgentConfig() is called once and cached, and JavaScript is
 * single-threaded, a simple variable is sufficient: the first request sets
 * it synchronously before the first `await`, and createAgentConfig() reads
 * it synchronously before any interleaving can occur.
 *
 * For the true multi-user case (different model per request), the cached
 * agent config is recreated on each request when ALS context is available.
 * This global is only the fallback for when ALS is broken.
 */
let _pendingModelConfig: Partial<ModelConfig> | null = null;

/**
 * Store a model config for the upcoming agent resolution.
 * Must be paired with a call to {@link consumePendingModelConfig} or
 * {@link clearPendingModelConfig}.
 */
export function setPendingModelConfig(config: Partial<ModelConfig>): void {
  _pendingModelConfig = config;
}

/**
 * Read and clear the pending model config.
 */
export function consumePendingModelConfig(): Partial<ModelConfig> | null {
  const config = _pendingModelConfig;
  _pendingModelConfig = null;
  return config;
}

/**
 * Read the per-request model config, if one has been set.
 * Returns `null` when no per-request config is active (e.g. outside a request).
 *
 * Priority:
 *   1. Pending model config (set by channel handler as ALS fallback)
 *   2. ALS context (works in dev mode)
 *   3. null (caller falls through to env/defaults)
 */
export function getRequestModelConfig(): Partial<ModelConfig> | null {
  // First check the pending global (works across workflow SDK async boundary).
  // AsyncLocalStorage is not preserved by the workflow SDK's internal async
  // execution chain in the production Nitro build, so we use a plain global
  // variable as a reliable fallback.
  if (_pendingModelConfig) return _pendingModelConfig;
  // Then check ALS (works in dev mode where source files are loaded directly)
  return modelContext.getStore() ?? null;
}
