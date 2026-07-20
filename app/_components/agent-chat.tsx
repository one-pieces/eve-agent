"use client";

import { useEveAgent } from "eve/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircleIcon,
  BookOpenIcon,
  ChevronDownIcon,
  GaugeIcon,
} from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/app/_context/language-context";
import { AgentMessage } from "./agent-message";
import type {
  SessionRecord,
  SessionTokenUsage,
} from "@/app/_hooks/use-session-list";
import {
  loadSessionMessages,
  loadSessionTokenUsage,
  saveSessionMessages,
  saveSessionTokenUsage,
} from "@/app/_hooks/use-session-list";
import { useKnowledgeList } from "@/app/_hooks/use-knowledge-list";

// ── Model-config header helper ──────────────────────────────────────────
const LS_KEY = "eve-model-config";
const HEADER_MODEL_CONFIG = "x-eve-model-config";

// ── Auth header cache (fetched once from server, not exposed in bundle) ──
let cachedAuthHeader: string | null = null;

// Fetch the auth header immediately at module load so it's cached before
// the first eve request (which may fire before the fetch completes).
const _authFetch = fetch("/api/auth/basic-token")
  .then((res) => (res.ok ? res.json() : null))
  .then((data) => {
    cachedAuthHeader = data?.token ?? null;
  })
  .catch(() => {
    cachedAuthHeader = null;
  });

/**
 * Read the user's model config from localStorage and return headers.
 * The auth token is fetched once at module load and cached thereafter.
 */
function readModelConfigHeader(): Record<string, string> {
  const headers: Record<string, string> = {};

  if (cachedAuthHeader) {
    headers["authorization"] = cachedAuthHeader;
  }

  // Attach model config from localStorage
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const modelHeader: Record<string, string> = {};
      const fields = ["provider", "baseUrl", "model", "guardrailIdentifier", "guardrailVersion"] as const;
      for (const key of fields) {
        const val = parsed[key];
        if (typeof val === "string" && val.length > 0) {
          modelHeader[key] = val;
        }
      }
      if (typeof parsed.apiKey === "string" && parsed.apiKey.length > 0) {
        modelHeader.apiKey = parsed.apiKey;
      }
      headers[HEADER_MODEL_CONFIG] = JSON.stringify(modelHeader);
    }
  } catch {
    // ignore
  }

  return headers;
}

const AGENT_NAME = "eve-agent";

type AgentStatus = ReturnType<typeof useEveAgent>["status"];

// Cache the model's context window size across the app lifetime so we only
// fetch `/eve/v1/info` once regardless of how many sessions get mounted.
let contextWindowPromise: Promise<number | null> | null = null;

function useModelContextWindowTokens() {
  const [contextWindowTokens, setContextWindowTokens] = useState<number | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    if (!contextWindowPromise) {
      // Wait for the auth fetch to complete, then query /eve/v1/info
      contextWindowPromise = _authFetch.then(async () => {
        const headers: Record<string, string> = cachedAuthHeader
          ? { authorization: cachedAuthHeader }
          : {};
        try {
          const res = await fetch("/eve/v1/info", { headers });
          if (!res.ok) return null;
          const info = await res.json();
          return info?.agent?.model?.contextWindowTokens ?? null;
        } catch {
          return null;
        }
      });
    }
    contextWindowPromise.then((value) => {
      if (!cancelled) setContextWindowTokens(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return contextWindowTokens;
}

function emptyTokenUsage(): SessionTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

/**
 * Filter out incomplete tool calls from messages to prevent API errors.
 * Removes trailing assistant messages with tool_use if there's no corresponding tool_result.
 */
function filterIncompleteToolCalls(messages: readonly any[]): any[] {
  if (messages.length === 0) return [];

  const filtered = [...messages];

  // Check if the last message is an assistant message with tool_use
  const lastMsg = filtered[filtered.length - 1];
  if (lastMsg?.role === "assistant") {
    const hasToolUse = lastMsg.parts?.some((p: any) => p.type === "tool_use");
    if (hasToolUse) {
      // Remove this incomplete tool call
      filtered.pop();
    }
  }

  return filtered;
}

function tokenUsageTotal(usage: SessionTokenUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadTokens +
    usage.cacheWriteTokens
  );
}

interface AgentChatProps {
  sessionRecord: SessionRecord | null;
  onSessionChange?: (sessionState: SessionRecord["sessionState"]) => void;
  onFirstMessage?: (text: string) => void;
  onKnowledgeBaseIdsChange?: (knowledgeBaseIds: string[]) => void;
}

export function AgentChat({
  sessionRecord,
  onSessionChange,
  onFirstMessage,
  onKnowledgeBaseIdsChange,
}: AgentChatProps) {
  const { t } = useLanguage();
  const { bases: knowledgeBases } = useKnowledgeList();
  const selectedKnowledgeBaseIds = sessionRecord?.knowledgeBaseIds ?? [];
  const selectedKnowledgeBases = useMemo(
    () =>
      knowledgeBases.filter((kb) => selectedKnowledgeBaseIds.includes(kb.id)),
    [knowledgeBases, selectedKnowledgeBaseIds],
  );

  const toggleKnowledgeBase = useCallback(
    (id: string) => {
      const next = selectedKnowledgeBaseIds.includes(id)
        ? selectedKnowledgeBaseIds.filter((kbId) => kbId !== id)
        : [...selectedKnowledgeBaseIds, id];
      onKnowledgeBaseIdsChange?.(next);
    },
    [selectedKnowledgeBaseIds, onKnowledgeBaseIdsChange],
  );
  const initialSession = sessionRecord?.sessionState?.sessionId
    ? sessionRecord.sessionState
    : undefined;

  const contextWindowTokens = useModelContextWindowTokens();

  // Load previously saved messages for this session (displayed as history)
  const restoredMessages = useRef<any[]>([]);
  const restoredInit = useRef(false);
  if (!restoredInit.current && sessionRecord?.id) {
    const loaded = loadSessionMessages(sessionRecord.id) as any[];
    // Filter out incomplete tool calls to prevent API errors
    restoredMessages.current = filterIncompleteToolCalls(loaded);
    restoredInit.current = true;
  }

  // Token usage for the most recently completed model step, which
  // approximates how much of the context window the session currently
  // occupies. Restored from localStorage so it survives page reloads.
  const [tokenUsage, setTokenUsage] = useState<SessionTokenUsage>(
    () =>
      (sessionRecord?.id && loadSessionTokenUsage(sessionRecord.id)) ||
      emptyTokenUsage(),
  );

  // When a session restarts (server resets), inject previous conversation
  // history as clientContext so the agent has awareness of earlier messages.
  const historyInjected = useRef(false);

  const agent = useEveAgent({
    initialSession,
    // Send the user's model config as a custom header on every request.
    // The eve channel's onMessage hook reads this and stages it for the
    // agent model resolution, giving each user their own model config.
    headers: readModelConfigHeader,
    onEvent(event) {
      if (event.type === "step.completed" && event.data.usage) {
        const usage: SessionTokenUsage = {
          inputTokens: event.data.usage.inputTokens ?? 0,
          outputTokens: event.data.usage.outputTokens ?? 0,
          cacheReadTokens: event.data.usage.cacheReadTokens ?? 0,
          cacheWriteTokens: event.data.usage.cacheWriteTokens ?? 0,
        };
        setTokenUsage(usage);
        if (sessionRecord?.id) {
          saveSessionTokenUsage(sessionRecord.id, usage);
        }
      }
    },
    prepareSend(input) {
      const contextParts: string[] = [];

      if (!historyInjected.current && restoredMessages.current.length > 0) {
        historyInjected.current = true;
        const history = formatMessagesAsContext(restoredMessages.current);
        if (history) contextParts.push(history);
      }

      const kbContext = formatKnowledgeBaseContext(selectedKnowledgeBases);
      if (kbContext) contextParts.push(kbContext);

      if (contextParts.length > 0) {
        return { ...input, clientContext: contextParts };
      }
      return input;
    },
    onSessionChange(session) {
      onSessionChange?.(session as SessionRecord["sessionState"]);
    },
    onFinish(snapshot) {
      if (sessionRecord?.id) {
        // Merge restored + new messages and persist
        const allMsgs = mergeMessages(
          restoredMessages.current,
          snapshot.data.messages,
        );
        saveSessionMessages(sessionRecord.id, allMsgs);
        restoredMessages.current = allMsgs;
      }
    },
  });

  // Track locally deleted message ids
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  // Combine restored history with live messages from the hook
  const allMessages = mergeMessages(
    restoredMessages.current,
    agent.data.messages,
  ).filter((m: any) => !deletedIds.has(m.id));

  const isBusy = agent.status === "submitted" || agent.status === "streaming";

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      setDeletedIds((prev) => new Set(prev).add(messageId));
      if (sessionRecord?.id) {
        const updated = restoredMessages.current.filter(
          (m: any) => m.id !== messageId,
        );
        restoredMessages.current = updated;
        saveSessionMessages(sessionRecord.id, updated);
      }
    },
    [sessionRecord?.id],
  );
  const isEmpty = allMessages.length === 0;

  // Track whether we've already fired onFirstMessage for this session
  const firstMessageFired = useRef(false);
  useEffect(() => {
    firstMessageFired.current = false;
  }, [sessionRecord?.id]);

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text || isBusy) return;

    // Capture first user message as session title
    if (!firstMessageFired.current && onFirstMessage) {
      firstMessageFired.current = true;
      onFirstMessage(text);
    }

    await agent.send({ message: text });
  };

  const composer = (
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputTextarea placeholder={t("chat.sendPlaceholder")} />
      <PromptInputSubmit onStop={agent.stop} status={agent.status} />
    </PromptInput>
  );

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 pl-4 pr-2">
        {isEmpty ? (
          <span />
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-muted-foreground text-sm">
              {AGENT_NAME}
            </span>
            <StatusDot status={agent.status} />
          </span>
        )}
        <span className="flex items-center gap-2">
          <TokenUsageBadge
            usage={tokenUsage}
            contextWindowTokens={contextWindowTokens}
          />
          <KnowledgeBaseSelector
            bases={knowledgeBases}
            selectedIds={selectedKnowledgeBaseIds}
            onToggle={toggleKnowledgeBase}
          />
        </span>
      </header>

      {agent.error ? (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-2 sm:px-6">
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">{t("chat.requestFailed")}</p>
              <p className="mt-0.5 text-muted-foreground">
                {agent.error.message}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {isEmpty ? null : (
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-6 sm:px-6">
            {allMessages.map((message: any, index: number) => (
              <AgentMessage
                canRespond={!isBusy}
                isStreaming={
                  agent.status === "streaming" &&
                  index === allMessages.length - 1
                }
                key={message.id}
                message={message}
                onDelete={handleDeleteMessage}
                onInputResponses={(inputResponses) =>
                  agent.send({ inputResponses })
                }
                sessionId={agent.session.sessionId}
              />
            ))}
            {agent.status === "submitted" && <ThinkingIndicator />}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      <div
        className={cn(
          "mx-auto w-full px-4 sm:px-6",
          isEmpty
            ? "flex max-w-xl flex-1 flex-col items-center justify-center gap-8 pb-[10vh]"
            : "max-w-3xl shrink-0 pb-6",
        )}
      >
        {isEmpty ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="font-medium text-5xl tracking-tighter">
              {AGENT_NAME}
            </h1>
          </div>
        ) : null}
        <div className="w-full">{composer}</div>
      </div>
    </div>
  );
}

/**
 * Merge restored (localStorage) messages with live messages.
 *
 * When a session ends and a new one starts, the eve server resets its turn
 * counter.  This means the new session's messages can have the *same* IDs
 * (e.g. `turn_0:user`) as messages from a previous session.  A naïve
 * deduplicate-by-id would silently drop the older messages.
 *
 * To avoid that, we compare the first text content of colliding messages.
 * If the text differs, they are different messages that happen to share an
 * ID, so we keep the restored copy (with a disambiguated key) alongside
 * the live copy.
 */
function mergeMessages(restored: readonly any[], live: readonly any[]): any[] {
  if (live.length === 0) return [...restored];
  if (restored.length === 0) return [...live];

  const liveById = new Map<string, any>();
  for (const m of live) liveById.set(m.id, m);

  const kept: any[] = [];
  let seq = 0;

  for (const m of restored) {
    const liveMsg = liveById.get(m.id);
    if (!liveMsg) {
      // Not in live – keep as-is.
      kept.push(m);
    } else if (!messagesMatch(m, liveMsg)) {
      // ID collision with different content (turn-ID reuse across sessions).
      // Keep the restored copy with a unique id so React keys stay unique.
      seq++;
      kept.push({ ...m, id: `${m.id}__prev${seq}` });
    }
    // else: true duplicate – drop restored, live version wins.
  }

  return [...kept, ...live];
}

/**
 * Serialize restored messages into a text summary that can be passed as
 * `clientContext` so the agent knows about conversations from a prior session.
 */
function formatMessagesAsContext(messages: readonly any[]): string {
  // Filter out incomplete tool calls first
  const safeMessages = filterIncompleteToolCalls(messages);

  const lines: string[] = [];
  for (const m of safeMessages) {
    const text = m.parts?.find((p: any) => p.type === "text")?.text;
    if (text) {
      const role = m.role === "user" ? "User" : "Assistant";
      lines.push(`${role}: ${text}`);
    }
  }
  if (lines.length === 0) return "";
  // Keep context within a reasonable size — trim from the front if too long
  const MAX_CHARS = 12_000;
  let body = lines.join("\n\n");
  if (body.length > MAX_CHARS) {
    const trimmed: string[] = [];
    let len = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (len + lines[i].length > MAX_CHARS) break;
      trimmed.unshift(lines[i]);
      len += lines[i].length;
    }
    body = "[…earlier messages omitted…]\n\n" + trimmed.join("\n\n");
  }
  return (
    "Below is the conversation history from a previous session. " +
    "Use it as context to continue helping the user:\n\n" +
    body
  );
}

/**
 * Serialize the knowledge bases bound to this conversation into a clientContext
 * message that instructs the model to scope `rag_search` calls to them.
 */
function formatKnowledgeBaseContext(
  bases: readonly { id: string; name: string; vectorDbType?: string }[],
): string {
  if (bases.length === 0) return "";
  const list = bases
    .map(
      (kb) =>
        `- ${kb.name} (id: ${kb.id}, vectorDbType: ${kb.vectorDbType ?? "chroma"})`,
    )
    .join("\n");
  return (
    "This conversation is bound to the following knowledge base(s). " +
    "When calling the rag_search tool, always pass their id(s) via " +
    "knowledgeBaseId (or knowledgeBaseIds when there is more than one) " +
    "and their matching vectorDbType (or vectorDbTypes, same order as knowledgeBaseIds) " +
    "instead of searching the global default collection:\n\n" +
    list
  );
}

/** Two messages "match" when they have the same role and the same leading text. */
function messagesMatch(a: any, b: any): boolean {
  if (a.role !== b.role) return false;
  const aText = a.parts?.find((p: any) => p.type === "text")?.text;
  const bText = b.parts?.find((p: any) => p.type === "text")?.text;
  if (aText != null && bText != null) return aText === bText;
  // Cannot distinguish by text – treat as same to be safe.
  return true;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return `${tokens}`;
}

function TokenUsageBadge({
  usage,
  contextWindowTokens,
}: {
  readonly usage: SessionTokenUsage;
  readonly contextWindowTokens: number | null;
}) {
  const { t } = useLanguage();
  const usedTokens = tokenUsageTotal(usage);
  if (usedTokens === 0) return null;

  const percent = contextWindowTokens
    ? Math.min(100, Math.round((usedTokens / contextWindowTokens) * 100))
    : null;
  const tone =
    percent !== null && percent >= 90
      ? "text-destructive"
      : percent !== null && percent >= 75
        ? "text-amber-500"
        : "text-muted-foreground";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs",
            tone,
          )}
        >
          <GaugeIcon className="size-3.5" />
          <span>
            {formatTokenCount(usedTokens)}
            {contextWindowTokens
              ? ` / ${formatTokenCount(contextWindowTokens)}`
              : ""}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="text-left">
        <p>
          {t("chat.tokenUsage", {
            percent: percent !== null ? `：${percent}%` : "",
          })}
        </p>
        <p className="mt-1 text-background/80">
          {t("chat.tokenUsageDetail", {
            input: usage.inputTokens,
            output: usage.outputTokens,
            cacheRead: usage.cacheReadTokens,
            cacheWrite: usage.cacheWriteTokens,
          })}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function KnowledgeBaseSelector({
  bases,
  selectedIds,
  onToggle,
}: {
  readonly bases: { id: string; name: string }[];
  readonly selectedIds: string[];
  readonly onToggle: (id: string) => void;
}) {
  const { t } = useLanguage();
  const label =
    selectedIds.length === 0
      ? t("chat.allKnowledgeBases")
      : selectedIds.length === 1
        ? (bases.find((kb) => kb.id === selectedIds[0])?.name ??
          t("chat.knowledgeBase", { count: 1 }))
        : t("chat.knowledgeBases", { count: selectedIds.length });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <BookOpenIcon className="size-3.5" />
          <span className="max-w-32 truncate">{label}</span>
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t("chat.selectKnowledgeBase")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {bases.length === 0 ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            {t("chat.noKnowledgeBases")}
          </div>
        ) : (
          bases.map((kb) => (
            <DropdownMenuCheckboxItem
              key={kb.id}
              checked={selectedIds.includes(kb.id)}
              onCheckedChange={() => onToggle(kb.id)}
              onSelect={(e) => e.preventDefault()}
            >
              <span className="truncate">{kb.name}</span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThinkingIndicator() {
  const { t } = useLanguage();
  return (
    <div className="flex w-full max-w-[95%] flex-col gap-2">
      <div className="flex w-fit min-w-0 max-w-full items-center gap-1.5 text-sm text-muted-foreground">
        <span className="inline-flex gap-1">
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
        </span>
        <span className="text-xs">{t("chat.thinking")}</span>
      </div>
    </div>
  );
}

function StatusDot({ status }: { readonly status: AgentStatus }) {
  const isLive = status === "submitted" || status === "streaming";
  const tone =
    status === "error"
      ? "bg-destructive"
      : isLive
        ? "bg-emerald-500"
        : status === "ready"
          ? "bg-muted-foreground"
          : "bg-muted-foreground/50";

  return (
    <span className="relative flex size-1">
      {isLive ? (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-75",
            tone,
          )}
        />
      ) : null}
      <span
        className={cn(
          "relative inline-flex size-1 rounded-full transition-colors",
          tone,
        )}
      />
    </span>
  );
}
