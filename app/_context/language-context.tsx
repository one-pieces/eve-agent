"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  createT,
  dateLocale,
  type Lang,
  type TranslationKey,
} from "@/app/_locales";

const STORAGE_KEY = "eve-agent-lang";

function getInitialLang(): Lang {
  if (typeof window === "undefined") return "zh";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "zh") return stored;
  const browser = navigator.language.toLowerCase();
  return browser.startsWith("zh") ? "zh" : "en";
}

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  locale: string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { readonly children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("zh");

  useEffect(() => {
    setLangState(getInitialLang());
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) =>
      createT(lang)(key, params),
    [lang],
  );

  return (
    <LanguageContext.Provider
      value={{ lang, setLang, t, locale: dateLocale[lang] }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
