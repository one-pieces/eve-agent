import { en } from "./en";
import { zh } from "./zh";

export type Lang = "en" | "zh";

export const translations = { en, zh } as const;

export type Translations = typeof en;

// Dot-notation key type for the translation object
type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}${"" extends P ? "" : "."}${P}`
    : never
  : never;

type Leaves<T> = T extends object
  ? { [K in keyof T]-?: Join<K, Leaves<T[K]>> }[keyof T]
  : "";

export type TranslationKey = Leaves<Translations>;

function getNestedValue(obj: Record<string, unknown>, key: string): string {
  const parts = key.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return key;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : key;
}

export function createT(lang: Lang) {
  const dict = translations[lang] as unknown as Record<string, unknown>;
  return function t(
    key: TranslationKey,
    params?: Record<string, string | number>,
  ): string {
    const raw = getNestedValue(dict, key);
    if (!params) return raw;
    return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k] ?? ""));
  };
}

export const dateLocale: Record<Lang, string> = {
  en: "en-US",
  zh: "zh-CN",
};
