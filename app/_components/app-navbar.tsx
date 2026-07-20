"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { MessageSquareIcon, BookOpenIcon, SettingsIcon } from "lucide-react";
import { useLanguage } from "@/app/_context/language-context";
import type { Lang } from "@/app/_locales";

const navItems = [
  {
    href: "/",
    labelKey: "nav.chat" as const,
    icon: MessageSquareIcon,
    match: (p: string) => p === "/" || p.startsWith("/session"),
  },
  {
    href: "/knowledge",
    labelKey: "nav.knowledge" as const,
    icon: BookOpenIcon,
    match: (p: string) => p.startsWith("/knowledge"),
  },
  {
    href: "/settings",
    labelKey: "nav.settings" as const,
    icon: SettingsIcon,
    match: (p: string) => p.startsWith("/settings"),
  },
];

const LANG_OPTIONS: { value: Lang; label: string }[] = [
  { value: "zh", label: "中" },
  { value: "en", label: "EN" },
];

export function AppNavbar() {
  const pathname = usePathname();
  const { t, lang, setLang } = useLanguage();

  return (
    <nav className="flex h-full w-14 shrink-0 flex-col items-center border-r border-border bg-card py-3 gap-1">
      {navItems.map((item) => {
        const active = item.match(pathname);
        const label = t(item.labelKey);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-2 text-[10px] transition-colors w-12",
              active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
            title={label}
          >
            <item.icon className="size-5" />
            <span className="leading-none">{label}</span>
          </Link>
        );
      })}

      <div className="mt-auto flex flex-col gap-1">
        {LANG_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setLang(opt.value)}
            className={cn(
              "flex items-center justify-center rounded-lg px-2 py-1.5 text-[10px] font-medium transition-colors w-12",
              lang === opt.value
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
