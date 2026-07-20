"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useSessionContext } from "@/app/_context/session-context";
import { useLanguage } from "@/app/_context/language-context";

export default function Page() {
  const router = useRouter();
  const { createSession } = useSessionContext();
  const { t } = useLanguage();

  const handleNew = useCallback(() => {
    const id = createSession();
    router.push(`/session/${id}`);
  }, [createSession, router]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="font-medium text-4xl tracking-tighter">eve-agent</h1>
        <p className="text-muted-foreground text-sm">{t("chat.selectOrNew")}</p>
        <button
          onClick={handleNew}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          type="button"
        >
          {t("chat.newConversation")}
        </button>
      </div>
    </div>
  );
}
