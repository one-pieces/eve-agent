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

/**
 * Per-request model configuration context.
 *
 * Uses Node.js AsyncLocalStorage so that concurrent requests each see their
 * own model config without interfering with each other. This is the key
 * mechanism for solving the multi-user shared-config problem.
 *
 * Usage:
 *   modelContext.run(config, () => {
 *     // code running here can read the per-request config
 *   });
 */
export { modelContext };

/**
 * Read the per-request model config, if one has been set.
 * Returns `null` when no per-request config is active (e.g. outside a request).
 */
export function getRequestModelConfig(): Partial<ModelConfig> | null {
  return modelContext.getStore() ?? null;
}
