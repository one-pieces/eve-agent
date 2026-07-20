"use client";

import { cn } from "@/lib/utils";
import {
  MessageSquareIcon,
  PlusIcon,
  Trash2Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "lucide-react";
import { useState } from "react";
import type { SessionRecord } from "@/app/_hooks/use-session-list";
import { useLanguage } from "@/app/_context/language-context";

interface SessionSidebarProps {
  sessions: SessionRecord[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function SessionSidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: SessionSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { t } = useLanguage();

  if (collapsed) {
    return (
      <div className="flex h-full w-12 shrink-0 flex-col items-center border-r border-border bg-card pt-3 gap-3">
        <button
          onClick={() => setCollapsed(false)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          title={t("sidebar.expandSidebar")}
          type="button"
        >
          <PanelLeftOpenIcon className="size-4" />
        </button>
        <button
          onClick={onNew}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          title={t("sidebar.newConversation")}
          type="button"
        >
          <PlusIcon className="size-4" />
        </button>
      </div>
    );
  }

  const countKey =
    sessions.length === 1
      ? "sidebar.conversationCount"
      : "sidebar.conversationCountPlural";

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="flex h-14 items-center justify-between px-3">
        <span className="text-sm font-medium text-foreground">
          {t("sidebar.conversations")}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onNew}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title={t("sidebar.newConversation")}
            type="button"
          >
            <PlusIcon className="size-4" />
          </button>
          <button
            onClick={() => setCollapsed(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title={t("sidebar.collapseSidebar")}
            type="button"
          >
            <PanelLeftCloseIcon className="size-4" />
          </button>
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t("sidebar.noConversations")}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {sessions.map((session) => (
              <li key={session.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(session.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ")
                      onSelect(session.id);
                  }}
                  className={cn(
                    "group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                    activeId === session.id
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <MessageSquareIcon className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {session.title}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(session.id);
                    }}
                    className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                    title={t("sidebar.deleteConversation")}
                    type="button"
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border px-3 py-2">
        <p className="text-[10px] text-muted-foreground">
          {t(countKey, { count: sessions.length })}
        </p>
      </div>
    </div>
  );
}
