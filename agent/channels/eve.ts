import { defineChannel, GET, POST } from "eve/channels";
import { routeAuth, localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";
import {
  modelContext,
  setPendingModelConfig,
} from "../../lib/model-context";
import { readModelConfig, type ModelConfig } from "../../lib/model-config";

// ── Constants matching the original eve channel ───────────────────────
const SESSION_ID_HEADER = "x-eve-session-id";
const STREAM_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";
const STREAM_FORMAT = "ndjson";
const STREAM_VERSION = "16";
const EVE_CHANNEL_PREFIX = "eve";

const HEADER_MODEL_CONFIG = "x-eve-model-config";

const authChain = [
  localDev(),
  vercelOidc(),
  placeholderAuth(),
] as const;

// ── Helpers ───────────────────────────────────────────────────────────

function parseModelConfigFromHeaders(
  headers: Headers,
): Partial<ModelConfig> | null {
  const raw = headers.get(HEADER_MODEL_CONFIG);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const validProviders = ["bedrock", "deepseek", "LM Studio", "Ollama"];
    if (typeof parsed.provider === "string" && !validProviders.includes(parsed.provider)) {
      delete parsed.provider;
    }
    return parsed as Partial<ModelConfig>;
  } catch {
    return null;
  }
}

function parseMessageField(value: unknown): string | undefined {
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  return undefined;
}

function parseClientContextField(value: unknown): string[] | undefined {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

function parseContinuationToken(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseStartIndex(url: URL): number | undefined {
  const raw = url.searchParams.get("startIndex");
  if (raw === null) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

// ── Channel definition ───────────────────────────────────────────────

export default defineChannel({
  routes: [
    // ── Create session ───────────────────────────────────────────────
    POST("/eve/v1/session", async (req, { send }) => {
      const authResult = await routeAuth(req, authChain);
      if (authResult instanceof Response) return authResult;

      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "Invalid JSON body.", ok: false }, { status: 400 });
      }

      if (typeof body !== "object" || !body) {
        return Response.json({ error: "Expected a JSON object.", ok: false }, { status: 400 });
      }

      const message = parseMessageField(body.message);
      if (message === undefined) {
        return Response.json({ error: "Missing or empty 'message' field.", ok: false }, { status: 400 });
      }

      const clientContext = parseClientContextField(body.clientContext);
      const outputSchema =
        body.outputSchema != null ? (body.outputSchema as Record<string, unknown>) : undefined;
      const mode: "conversation" | "task" = body.mode === "task" ? "task" : "conversation";

      // Extract model config from request headers
      const modelConfig = parseModelConfigFromHeaders(req.headers);

      const continuationToken = `${EVE_CHANNEL_PREFIX}:${crypto.randomUUID()}`;

      const doSend = async () => {
        const hasContext = clientContext !== undefined;
        const hasOutputSchema = outputSchema !== undefined;
        const payload = hasContext || hasOutputSchema
          ? ({ message, ...(hasContext ? { context: clientContext } : {}), ...(hasOutputSchema ? { outputSchema } : {}) } as Record<string, unknown>)
          : message;
        const session = await send(payload, {
          auth: authResult,
          continuationToken,
          mode,
        });
        return Response.json(
          { continuationToken: session.continuationToken, ok: true, sessionId: session.id },
          {
            headers: { "cache-control": "no-store", [SESSION_ID_HEADER]: session.id },
            status: 202,
          },
        );
      };

      // 🎯 在 ALS 上下文中执行 send()，使模型解析时 readModelConfig() 能获取到该用户的配置
      //    同时设置全局 fallback（生产构建中 workflow SDK 会丢失 ALS 上下文）
      if (modelConfig) {
        setPendingModelConfig(modelConfig);
        return modelContext.run(modelConfig, doSend);
      }
      return doSend();
    }),

    // ── Continue session ─────────────────────────────────────────────
    POST("/eve/v1/session/:sessionId", async (req, { send, getSession, params }) => {
      const authResult = await routeAuth(req, authChain);
      if (authResult instanceof Response) return authResult;

      const sessionId = params.sessionId;
      if (!sessionId) {
        return Response.json({ error: "Missing session id.", ok: false }, { status: 400 });
      }

      // Verify session exists
      try {
        getSession(sessionId);
      } catch {
        return Response.json({ error: "Session not found.", ok: false }, { status: 404 });
      }

      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "Invalid JSON body.", ok: false }, { status: 400 });
      }

      if (typeof body !== "object" || !body) {
        return Response.json({ error: "Expected a JSON object.", ok: false }, { status: 400 });
      }

      const continuationToken = parseContinuationToken(body.continuationToken);
      if (continuationToken === undefined) {
        return Response.json({ error: "Missing or empty 'continuationToken' field.", ok: false }, { status: 400 });
      }

      const message = parseMessageField(body.message);
      const clientContext = parseClientContextField(body.clientContext);
      const outputSchema =
        body.outputSchema != null ? (body.outputSchema as Record<string, unknown>) : undefined;

      // Extract model config from request headers
      const modelConfig = parseModelConfigFromHeaders(req.headers);

      const doSend = async () => {
        const payload: Record<string, unknown> = {};
        if (message !== undefined) payload.message = message;
        if (clientContext !== undefined) payload.context = clientContext;
        if (outputSchema !== undefined) payload.outputSchema = outputSchema;

        const session = await send(payload, {
          auth: authResult,
          continuationToken,
        });

        return Response.json(
          { ok: true, sessionId: session.id },
          {
            headers: { "cache-control": "no-store", [SESSION_ID_HEADER]: session.id },
            status: 200,
          },
        );
      };

      if (modelConfig) {
        setPendingModelConfig(modelConfig);
        return modelContext.run(modelConfig, doSend);
      }
      return doSend();
    }),

    // ── Stream events ────────────────────────────────────────────────
    GET("/eve/v1/session/:sessionId/stream", async (req, { getSession, params }) => {
      const authResult = await routeAuth(req, authChain);
      if (authResult instanceof Response) return authResult;

      const sessionId = params.sessionId;
      if (!sessionId) {
        return Response.json({ error: "Missing session id.", ok: false }, { status: 400 });
      }

      const startIndex = parseStartIndex(new URL(req.url));

      try {
        const eventStream = await getSession(sessionId).getEventStream(
          startIndex !== undefined ? { startIndex } : undefined,
        );
        // Serialize event objects as NDJSON (newline-delimited JSON) bytes
        const encoder = new TextEncoder();
        const ndjsonStream = eventStream.pipeThrough(
          new TransformStream({
            transform(event, controller) {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            },
          }),
        );
        return new Response(ndjsonStream, {
          headers: {
            "cache-control": "no-store, no-transform",
            "content-type": STREAM_CONTENT_TYPE,
            "x-accel-buffering": "no",
            [SESSION_ID_HEADER]: sessionId,
            "x-eve-stream-format": STREAM_FORMAT,
            "x-eve-stream-version": STREAM_VERSION,
          },
        });
      } catch {
        return Response.json({ error: "Session not found.", ok: false }, { status: 404 });
      }
    }),

    // ── Health check ─────────────────────────────────────────────────
    GET("/eve/v1/health", async () => {
      return Response.json({ ok: true });
    }),

    // ── Debug: echo request headers ──────────────────────────────────
    GET("/eve/v1/debug/headers", async (req) => {
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return Response.json({
        headers,
        hasModelConfig: headers[HEADER_MODEL_CONFIG] !== undefined,
        modelConfigRaw: headers[HEADER_MODEL_CONFIG] ?? null,
      });
    }),

    // ── Agent info ───────────────────────────────────────────────────
    GET("/eve/v1/info", async (req) => {
      const authResult = await routeAuth(req, authChain);
      if (authResult instanceof Response) return authResult;

      const config = readModelConfig();

      return Response.json({
        agent: {
          model: {
            contextWindowTokens: getModelContextWindow(config.provider),
            id: config.model || undefined,
            provider: config.provider,
          },
        },
      });
    }),
  ],
});

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
