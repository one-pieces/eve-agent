"use client";

import { useLanguage } from "@/app/_context/language-context";

import { useEffect, useState, useCallback } from "react";
import { InfoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const LS_KEY = "eve-model-config";

type Provider = "bedrock" | "deepseek" | "LM Studio" | "Ollama";

interface FormState {
  provider: Provider;
  baseUrl: string;
  model: string;
  apiKey: string;
  guardrailIdentifier: string;
  guardrailVersion: string;
}

const PROVIDER_OPTIONS: Provider[] = [
  "bedrock",
  "deepseek",
  "LM Studio",
  "Ollama",
];

const PROVIDER_DEFAULTS: Record<Provider, { baseUrl: string; modelHint: string; needsApiKey: boolean }> =
  {
    bedrock: {
      baseUrl: "",
      modelHint: "e.g. anthropic.claude-sonnet-4-20250514",
      needsApiKey: true,
    },
    deepseek: {
      baseUrl: "https://api.deepseek.com",
      modelHint: "e.g. deepseek-chat",
      needsApiKey: true,
    },
    "LM Studio": {
      baseUrl: "http://localhost:1234/v1",
      modelHint: "e.g. local-model",
      needsApiKey: false,
    },
    Ollama: {
      baseUrl: "http://localhost:11434/v1",
      modelHint: "e.g. llama3.2",
      needsApiKey: false,
    },
  };

const PROVIDER_LABELS: Record<Provider, string> = {
  bedrock: "Bedrock",
  deepseek: "DeepSeek",
  "LM Studio": "LM Studio",
  Ollama: "Ollama",
};

function loadFromStorage(): FormState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FormState;
  } catch {
    return null;
  }
}

function saveToStorage(state: FormState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

type SaveState = "idle" | "saving" | "saved" | "error";

function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 4) return "*".repeat(key.length);
  return `${"*".repeat(key.length - 4)}${key.slice(-4)}`;
}

const EMPTY_FORM: FormState = {
  provider: "bedrock",
  baseUrl: "",
  model: "",
  apiKey: "",
  guardrailIdentifier: "",
  guardrailVersion: "",
};

export default function ModelSettingsPage() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState(false);

  const defaults = PROVIDER_DEFAULTS[form.provider];

  // 初始化：直接从 localStorage 读取（每个用户的配置独立保存在浏览器中）
  // 只有点击"保存"按钮时才会写入 localStorage
  useEffect(() => {
    const stored = loadFromStorage();
    setForm(stored ?? EMPTY_FORM);
    setLoading(false);
  }, []);

  const updateField = useCallback(<K extends keyof FormState>(
    key: K,
    value: FormState[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  // When provider changes, apply its default baseUrl if the current one is empty or matches a different provider's default
  const handleProviderChange = useCallback((value: string) => {
    const newProvider = value as Provider;
    setForm((prev) => {
      const prevDefaults = PROVIDER_DEFAULTS[prev.provider];
      const newDefaults = PROVIDER_DEFAULTS[newProvider];
      // Reset baseUrl to the new provider's default if user hadn't customized it
      const currentBaseUrl = prev.baseUrl;
      const isUsingPrevDefault = currentBaseUrl === prevDefaults.baseUrl;
      return {
        ...prev,
        provider: newProvider,
        baseUrl: isUsingPrevDefault ? newDefaults.baseUrl : currentBaseUrl,
        model: "",
        apiKey: "",
        guardrailIdentifier: "",
        guardrailVersion: "",
      };
    });
  }, []);

  async function handleSave() {
    setSaveState("saving");
    setSaveError(false);

    // 保存到 localStorage（每个用户独立的配置来源）
    saveToStorage(form);

    // 保存后清空 API Key 字段（仅显示脱敏占位符）
    setForm((prev) => ({ ...prev, apiKey: "" }));
    setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 2000);
  }

  // 从 localStorage 中读取真实 apiKey 并计算脱敏值用于显示
  const hasStoredKey = (() => {
    const stored = loadFromStorage();
    return !!(stored?.apiKey);
  })();
  const apiKeyMasked = hasStoredKey
    ? maskApiKey(loadFromStorage()?.apiKey ?? "")
    : "";

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("settings.loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h2 className="text-base font-semibold">{t("settings.sidebar.model")}</h2>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saveState === "saving"}
        >
          {saveState === "saving" ? t("settings.saving") : t("settings.save")}
        </Button>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-xl flex-col gap-5">
          <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
            <InfoIcon className="size-4 shrink-0 mt-0.5" />
            <p>{t("settings.localStorageHint")}</p>
          </div>

          {/* Provider – dropdown, always at the top */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("settings.provider")}
            </label>
            <Select
              value={form.provider}
              onValueChange={handleProviderChange}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("settings.provider")} />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_OPTIONS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PROVIDER_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Base URL</label>
            <Input
              value={form.baseUrl}
              onChange={(e) => updateField("baseUrl", e.target.value)}
              placeholder={defaults.baseUrl || "https://api.example.com"}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("settings.modelName")}
            </label>
            <Input
              value={form.model}
              onChange={(e) => updateField("model", e.target.value)}
              placeholder={defaults.modelHint}
            />
          </div>

          {defaults.needsApiKey && (
            <div>
              <label className="mb-1 block text-sm font-medium">API Key</label>
              <Input
                type="password"
                value={form.apiKey}
                onChange={(e) => updateField("apiKey", e.target.value)}
                placeholder={
                  apiKeyMasked
                    ? t("settings.apiKeyCurrentValue", { masked: apiKeyMasked })
                    : t("settings.apiKeyPlaceholder")
                }
              />
            </div>
          )}

          {/* Bedrock-specific fields */}
          {form.provider === "bedrock" && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Guardrail Identifier
                </label>
                <Input
                  value={form.guardrailIdentifier}
                  onChange={(e) =>
                    updateField("guardrailIdentifier", e.target.value)
                  }
                  placeholder={t("settings.optional")}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Guardrail Version
                </label>
                <Input
                  value={form.guardrailVersion}
                  onChange={(e) =>
                    updateField("guardrailVersion", e.target.value)
                  }
                  placeholder={t("settings.optional")}
                />
              </div>
            </>
          )}

          {saveState === "saved" && (
            <p className="text-sm text-green-600">{t("settings.saved")}</p>
          )}
          {saveError && (
            <p className="text-sm text-destructive">
              {t("settings.saveFailed")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
