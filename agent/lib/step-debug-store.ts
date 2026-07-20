/**
 * Disk-backed store that captures, per model-call step, the exact request
 * sent to the model and the response produced for it, so the frontend can
 * show a "step debug" popup with the raw JSON.
 *
 * Writers (`agent/instrumentation.ts`, `agent/hooks/step-debug-capture.ts`)
 * run inside the agent runtime bundle, while the reader
 * (`app/api/debug/step/route.ts`) runs inside the Next.js app bundle. Those
 * two bundles do not share module state (and may even run in separate
 * processes for durable/workflow execution), so an in-memory `Map` is not
 * visible across that boundary. Persisting each record to its own file on
 * disk — the same pattern `agent/agent.ts` already uses for
 * `.model-requests/` — works regardless of process/bundle topology as long
 * as both sides share a filesystem, which is true for local dev.
 *
 * This is a best-effort dev/debug aid: entries are capped at `MAX_ENTRIES`
 * (oldest files evicted first) and are not meant to survive indefinitely.
 */

import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

export interface StepDebugRequest {
  readonly instructions?: unknown;
  readonly messages?: unknown;
}

export interface StepDebugUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

export interface StepDebugResponse {
  text?: string | null;
  reasoning?: string;
  finishReason?: string;
  usage?: StepDebugUsage;
  actions?: unknown;
  actionResults?: unknown[];
  failed?: { code: string; message: string; details?: unknown };
}

export interface StepDebugRecord {
  readonly sessionId: string;
  readonly turnId: string;
  readonly stepIndex: number;
  request?: StepDebugRequest;
  response?: StepDebugResponse;
  updatedAt: number;
}

const STORE_DIR = join(process.cwd(), ".eve-step-debug");
const MAX_ENTRIES = 500;

function fileNameFor(
  sessionId: string,
  turnId: string,
  stepIndex: number,
): string {
  return `${encodeURIComponent(sessionId)}__${encodeURIComponent(turnId)}__${stepIndex}.json`;
}

function filePathFor(
  sessionId: string,
  turnId: string,
  stepIndex: number,
): string {
  return join(STORE_DIR, fileNameFor(sessionId, turnId, stepIndex));
}

function jsonReplacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return `<binary ${value.length} bytes>`;
  return value;
}

// Serializes writes to the same file within this process so concurrent
// hook/instrumentation callbacks don't clobber each other's read-modify-write.
const writeQueues = new Map<string, Promise<unknown>>();

async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prior = writeQueues.get(filePath) ?? Promise.resolve();
  const task = prior.then(fn, fn);
  writeQueues.set(
    filePath,
    task.catch(() => undefined),
  );
  return task;
}

async function readRecord(
  filePath: string,
): Promise<StepDebugRecord | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as StepDebugRecord;
  } catch {
    return undefined;
  }
}

async function writeRecord(
  filePath: string,
  record: StepDebugRecord,
): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(record, jsonReplacer, 2), "utf8");
  await rename(tmpPath, filePath);
}

let evictionInFlight = false;
function scheduleEviction() {
  if (evictionInFlight) return;
  evictionInFlight = true;
  void evictIfNeeded().finally(() => {
    evictionInFlight = false;
  });
}

async function evictIfNeeded(): Promise<void> {
  try {
    const entries = await readdir(STORE_DIR);
    const jsonFiles = entries.filter((name) => name.endsWith(".json"));
    if (jsonFiles.length <= MAX_ENTRIES) return;

    const withStats = await Promise.all(
      jsonFiles.map(async (name) => {
        const filePath = join(STORE_DIR, name);
        const info = await stat(filePath).catch(() => undefined);
        return { filePath, mtimeMs: info?.mtimeMs ?? 0 };
      }),
    );
    withStats.sort((a, b) => a.mtimeMs - b.mtimeMs);

    const excess = withStats.length - MAX_ENTRIES;
    await Promise.all(
      withStats
        .slice(0, excess)
        .map((entry) => unlink(entry.filePath).catch(() => undefined)),
    );
  } catch {
    // Best-effort cleanup; ignore errors (e.g. directory not created yet).
  }
}

async function updateRecord(
  sessionId: string,
  turnId: string,
  stepIndex: number,
  mutate: (record: StepDebugRecord) => void,
): Promise<void> {
  const filePath = filePathFor(sessionId, turnId, stepIndex);
  await withFileLock(filePath, async () => {
    const existing =
      (await readRecord(filePath)) ??
      ({
        sessionId,
        turnId,
        stepIndex,
        updatedAt: Date.now(),
      } satisfies StepDebugRecord);
    mutate(existing);
    existing.updatedAt = Date.now();
    await writeRecord(filePath, existing);
  });
  scheduleEviction();
}

export async function recordStepRequest(input: {
  readonly sessionId: string;
  readonly turnId: string;
  readonly stepIndex: number;
  readonly instructions?: unknown;
  readonly messages?: unknown;
}): Promise<void> {
  await updateRecord(
    input.sessionId,
    input.turnId,
    input.stepIndex,
    (record) => {
      record.request = {
        instructions: input.instructions,
        messages: input.messages,
      };
    },
  );
}

export async function recordStepResponsePatch(
  sessionId: string,
  turnId: string,
  stepIndex: number,
  patch: StepDebugResponse,
): Promise<void> {
  await updateRecord(sessionId, turnId, stepIndex, (record) => {
    record.response = { ...record.response, ...patch };
  });
}

export async function appendActionResult(
  sessionId: string,
  turnId: string,
  stepIndex: number,
  result: unknown,
): Promise<void> {
  await updateRecord(sessionId, turnId, stepIndex, (record) => {
    const actionResults = record.response?.actionResults ?? [];
    record.response = {
      ...record.response,
      actionResults: [...actionResults, result],
    };
  });
}

export async function getStepDebugRecord(
  sessionId: string,
  turnId: string,
  stepIndex: number,
): Promise<StepDebugRecord | undefined> {
  return readRecord(filePathFor(sessionId, turnId, stepIndex));
}
