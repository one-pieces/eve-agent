"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "eve-session-list";
const MESSAGES_KEY_PREFIX = "eve-session-messages-";
const TOKEN_USAGE_KEY_PREFIX = "eve-session-token-usage-";

export interface SessionRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sessionState: {
    sessionId: string;
    continuationToken?: string;
    streamIndex: number;
  };
  /** Knowledge base IDs this conversation is bound to. Empty/undefined = search all. */
  knowledgeBaseIds?: string[];
}

function loadSessions(): SessionRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: SessionRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function loadSessionMessages(id: string): unknown[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MESSAGES_KEY_PREFIX + id);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSessionMessages(id: string, messages: unknown[]) {
  try {
    localStorage.setItem(MESSAGES_KEY_PREFIX + id, JSON.stringify(messages));
  } catch {
    // localStorage might be full; silently drop
  }
}

function deleteSessionMessages(id: string) {
  localStorage.removeItem(MESSAGES_KEY_PREFIX + id);
}

export interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function loadSessionTokenUsage(id: string): SessionTokenUsage | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TOKEN_USAGE_KEY_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSessionTokenUsage(id: string, usage: SessionTokenUsage) {
  try {
    localStorage.setItem(TOKEN_USAGE_KEY_PREFIX + id, JSON.stringify(usage));
  } catch {
    // localStorage might be full; silently drop
  }
}

function deleteSessionTokenUsage(id: string) {
  localStorage.removeItem(TOKEN_USAGE_KEY_PREFIX + id);
}

export function useSessionList() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    const loaded = loadSessions();
    setSessions(loaded);
  }, []);

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  const createSession = useCallback(() => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id,
      title: "New conversation",
      createdAt: now,
      updatedAt: now,
      sessionState: {
        sessionId: "",
        continuationToken: undefined,
        streamIndex: 0,
      },
      knowledgeBaseIds: [],
    };
    setSessions((prev) => {
      const next = [record, ...prev];
      saveSessions(next);
      return next;
    });
    setActiveId(id);
    return id;
  }, []);

  const updateSession = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<SessionRecord, "title" | "sessionState" | "knowledgeBaseIds">
      >,
    ) => {
      setSessions((prev) => {
        const next = prev.map((s) =>
          s.id === id
            ? { ...s, ...patch, updatedAt: new Date().toISOString() }
            : s,
        );
        saveSessions(next);
        return next;
      });
    },
    [],
  );

  const deleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        saveSessions(next);
        return next;
      });
      deleteSessionMessages(id);
      deleteSessionTokenUsage(id);
      if (activeId === id) {
        setActiveId(null);
      }
    },
    [activeId],
  );

  const selectSession = useCallback((id: string | null) => {
    setActiveId(id);
  }, []);

  return {
    sessions,
    activeId,
    activeSession,
    createSession,
    updateSession,
    deleteSession,
    selectSession,
  };
}
