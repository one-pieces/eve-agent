"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CpuIcon, SettingsIcon } from "lucide-react";
import { useLanguage } from "@/app/_context/language-context";
import type { ReactNode } from "react";

const sidebarItems = [
  {
    href: "/settings/model",
    labelKey: "settings.sidebar.model" as const,
    icon: CpuIcon,
  },
];

export default function SettingsLayout({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const { t } = useLanguage();

  const currentLabel =
    sidebarItems.find((item) => pathname.startsWith(item.href))?.labelKey ??
    "settings.title";

  return (
    <div className="flex h-full overflow-hidden bg-background text-foreground">
      {/* Left sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-4">
          <SettingsIcon className="size-5 text-foreground" />
          <h1 className="text-base font-semibold">{t("settings.title")}</h1>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-2">
          {sidebarItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <item.icon className="size-4 shrink-0" />
                <span>{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Right content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile header (visible when content is focused) */}
        <div className="hidden">
          <h2 className="text-base font-semibold">
            {typeof currentLabel === "string" ? currentLabel : t(currentLabel)}
          </h2>
        </div>
        {children}
      </main>
    </div>
  );
}
