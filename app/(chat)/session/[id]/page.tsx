"use client";

import { useCallback } from "react";
import { useParams } from "next/navigation";
import { AgentChat } from "@/app/_components/agent-chat";
import { useSessionContext } from "@/app/_context/session-context";
import { useLanguage } from "@/app/_context/language-context";

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const { sessions, updateSession } = useSessionContext();
  const { t } = useLanguage();

  const activeSession = sessions.find((s) => s.id === params.id) ?? null;

  const handleSessionChange = useCallback(
    (sessionState: {
      sessionId: string;
      continuationToken?: string;
      streamIndex: number;
    }) => {
      if (params.id) {
        updateSession(params.id, { sessionState });
      }
    },
    [params.id, updateSession],
  );

  const handleFirstMessage = useCallback(
    (text: string) => {
      if (params.id) {
        updateSession(params.id, { title: text.slice(0, 60) });
      }
    },
    [params.id, updateSession],
  );

  const handleKnowledgeBaseIdsChange = useCallback(
    (knowledgeBaseIds: string[]) => {
      if (params.id) {
        updateSession(params.id, { knowledgeBaseIds });
      }
    },
    [params.id, updateSession],
  );

  if (!activeSession) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">
          {t("chat.sessionNotFound")}
        </p>
      </div>
    );
  }

  return (
    <AgentChat
      key={params.id}
      sessionRecord={activeSession}
      onSessionChange={handleSessionChange}
      onFirstMessage={handleFirstMessage}
      onKnowledgeBaseIdsChange={handleKnowledgeBaseIdsChange}
    />
  );
}
