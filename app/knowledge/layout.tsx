import type { ReactNode } from "react";

export default function KnowledgeLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex h-full overflow-hidden bg-background text-foreground">
      {children}
    </div>
  );
}
