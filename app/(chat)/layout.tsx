"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback, type ReactNode } from "react";
import { SessionSidebar } from "@/app/_components/session-sidebar";
import {
  SessionProvider,
  useSessionContext,
} from "@/app/_context/session-context";

function ChatLayoutInner({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { sessions, createSession, deleteSession } = useSessionContext();

  const match = pathname.match(/^\/session\/(.+)$/);
  const activeId = match ? match[1] : null;

  const handleNew = useCallback(() => {
    const id = createSession();
    router.push(`/session/${id}`);
  }, [createSession, router]);

  const handleSelect = useCallback(
    (id: string) => {
      router.push(`/session/${id}`);
    },
    [router],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteSession(id);
      if (activeId === id) {
        router.push("/");
      }
    },
    [deleteSession, activeId, router],
  );

  return (
    <main className="flex h-full overflow-hidden bg-background text-foreground">
      <SessionSidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
      />
      {children}
    </main>
  );
}

export default function ChatLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <SessionProvider>
      <ChatLayoutInner>{children}</ChatLayoutInner>
    </SessionProvider>
  );
}
