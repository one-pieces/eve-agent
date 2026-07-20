"use client";

import { useEffect, useState } from "react";
import { Loader2Icon, CodeIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  CodeBlock,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockActions,
} from "@/components/ai-elements/code-block";

interface StepDebugRecord {
  readonly sessionId: string;
  readonly turnId: string;
  readonly stepIndex: number;
  readonly request?: unknown;
  readonly response?: unknown;
  readonly updatedAt?: number;
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_key, val) => (typeof val === "bigint" ? val.toString() : val),
      2,
    );
  } catch {
    return String(value);
  }
}

function JsonSection({ title, value }: { title: string; value: unknown }) {
  const code =
    value === undefined ? "// not captured yet" : stringifyJson(value);
  return (
    <div className="flex flex-col gap-1.5">
      <CodeBlock code={code} language="json" className="max-h-80 overflow-auto">
        <CodeBlockHeader>
          <CodeBlockTitle>{title}</CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>
    </div>
  );
}

export function StepDebugTrigger({
  sessionId,
  turnId,
  stepIndex,
}: {
  readonly sessionId: string | undefined;
  readonly turnId: string;
  readonly stepIndex: number;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<StepDebugRecord | null>(null);

  useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      sessionId,
      turnId,
      stepIndex: String(stepIndex),
    });
    fetch(`/api/debug/step?${params.toString()}`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error ?? "Failed to load step debug data");
          setRecord(null);
          return;
        }
        setRecord(body);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, turnId, stepIndex]);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <button
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/60 uppercase tracking-widest transition-colors hover:bg-accent hover:text-foreground"
        disabled={!sessionId}
        onClick={() => setOpen(true)}
        title="View step request/response"
        type="button"
      >
        <CodeIcon className="size-3" />
        Step {stepIndex + 1}
      </button>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Step {stepIndex + 1} details</DialogTitle>
          <DialogDescription>
            Raw model request and response captured for this step.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
            <Loader2Icon className="size-4 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <JsonSection title="Request" value={record?.request} />
            <JsonSection title="Response" value={record?.response} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
