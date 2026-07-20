"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useSessionList } from "@/app/_hooks/use-session-list";

type SessionContextType = ReturnType<typeof useSessionList>;

const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const sessionList = useSessionList();
  return (
    <SessionContext.Provider value={sessionList}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionContext() {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSessionContext must be used within SessionProvider");
  }
  return ctx;
}
