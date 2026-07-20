"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeftIcon,
  UploadIcon,
  FileTextIcon,
  Trash2Icon,
  PencilIcon,
  Loader2Icon,
  DatabaseIcon,
  EyeIcon,
  CheckCircle2Icon,
  XCircleIcon,
  ListIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  getKnowledgeBase,
  updateKnowledgeBase,
  type KnowledgeBase,
  type KnowledgeFile,
  type VectorDbType,
} from "@/lib/knowledge-db";
import { useKnowledgeFiles } from "@/app/_hooks/use-knowledge-list";
import { useLanguage } from "@/app/_context/language-context";

interface VectorIndexItem {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
  embeddingDim: number;
  embeddingPreview: string[];
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function KnowledgeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t, locale } = useLanguage();

  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editRerank, setEditRerank] = useState(false);
  const [editDbType, setEditDbType] = useState<VectorDbType>("chroma");
  // Per-file build progress: fileId → percent (0–100)
  const [buildProgress, setBuildProgress] = useState<Record<string, number>>(
    {},
  );

  // Vector index viewer state
  const [vecOpen, setVecOpen] = useState(false);
  const [vecLoading, setVecLoading] = useState(false);
  const [vecItems, setVecItems] = useState<VectorIndexItem[]>([]);
  const [vecTotal, setVecTotal] = useState(0);
  const [vecOffset, setVecOffset] = useState(0);
  const [vecError, setVecError] = useState("");
  const VEC_LIMIT = 50;
  const [vecExpandedId, setVecExpandedId] = useState<string | null>(null);
  const [vecSources, setVecSources] = useState<string[]>([]);
  const [vecSourceFilter, setVecSourceFilter] = useState("");

  const {
    files,
    loading: filesLoading,
    add,
    update: updateFile,
    remove,
  } = useKnowledgeFiles(id);

  const loadKb = useCallback(async () => {
    const data = await getKnowledgeBase(id);
    setKb(data ?? null);
    setPageLoading(false);
  }, [id]);

  useEffect(() => {
    loadKb();
  }, [loadKb]);

  function openEdit() {
    if (!kb) return;
    setEditName(kb.name);
    setEditDesc(kb.description);
    setEditRerank(kb.useRerank ?? false);
    setEditDbType(kb.vectorDbType ?? "chroma");
    setEditOpen(true);
  }

  async function handleEditSave() {
    if (!kb || !editName.trim()) return;
    const updated = await updateKnowledgeBase(kb.id, {
      name: editName.trim(),
      description: editDesc.trim(),
      useRerank: editRerank,
      vectorDbType: editDbType,
    });
    setKb(updated);
    setEditOpen(false);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setUploading(true);
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (!file.name.toLowerCase().endsWith(".pdf")) continue;

      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/api/knowledge/upload", {
          method: "POST",
          body: formData,
        });

        if (res.ok) {
          const record: KnowledgeFile = {
            id: crypto.randomUUID(),
            knowledgeBaseId: id,
            name: file.name,
            size: file.size,
            uploadedAt: new Date().toISOString(),
            indexStatus: "none",
            chunkCount: 0,
          };
          await add(record);
        }
      } catch (err) {
        console.error("Upload error:", err);
      }
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleBuildIndex(file: KnowledgeFile) {
    await updateFile(file.id, {
      indexStatus: "building",
      chunkCount: 0,
      indexError: undefined,
    });
    setBuildProgress((prev) => ({ ...prev, [file.id]: 0 }));
    const startTime = Date.now();

    try {
      const res = await fetch("/api/knowledge/build-index-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          knowledgeBaseId: id,
          vectorDbType: kb?.vectorDbType ?? "chroma",
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Build failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream body");

      const decoder = new TextDecoder();
      let buffer = "";
      let chunkCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE messages from buffer
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part.split("\n");
          let eventType = "";
          let eventData = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7);
            else if (line.startsWith("data: ")) eventData = line.slice(6);
          }
          if (!eventData) continue;

          const payload = JSON.parse(eventData);
          if (eventType === "progress") {
            setBuildProgress((prev) => ({
              ...prev,
              [file.id]: payload.percent,
            }));
          } else if (eventType === "done") {
            chunkCount = payload.chunkCount ?? 0;
            setBuildProgress((prev) => ({ ...prev, [file.id]: 100 }));
          } else if (eventType === "error") {
            throw new Error(payload.message || "Build failed");
          }
        }
      }

      await updateFile(file.id, {
        indexStatus: "done",
        chunkCount,
        indexedAt: new Date().toISOString(),
        indexDurationMs: Date.now() - startTime,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Build failed";
      await updateFile(file.id, { indexStatus: "error", indexError: message });
    } finally {
      setBuildProgress((prev) => {
        const next = { ...prev };
        delete next[file.id];
        return next;
      });
    }
  }

  function handleViewFile(fileName: string) {
    const url = `/api/knowledge/file?name=${encodeURIComponent(fileName)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleViewChunks(fileName: string) {
    setVecOpen(true);
    setVecExpandedId(null);
    setVecSourceFilter(fileName);
    loadVectorIndex(0, fileName);
  }

  const loadVectorIndex = useCallback(
    async (offset: number, source = "") => {
      setVecLoading(true);
      setVecError("");
      try {
        const params = new URLSearchParams({
          offset: String(offset),
          limit: String(VEC_LIMIT),
          knowledgeBaseId: id,
          vectorDbType: kb?.vectorDbType ?? "chroma",
        });
        if (source) params.set("source", source);
        const res = await fetch(`/api/knowledge/vector-index?${params}`);
        if (!res.ok) throw new Error("Failed to load vector index");
        const data = await res.json();
        setVecItems(data.items ?? []);
        setVecTotal(data.total ?? 0);
        setVecOffset(offset);
        if (data.sources) setVecSources(data.sources);
      } catch (err) {
        console.error("Load vector index error:", err);
        setVecError(
          err instanceof Error ? err.message : "Failed to load vector index",
        );
      } finally {
        setVecLoading(false);
      }
    },
    [VEC_LIMIT, kb?.vectorDbType, id],
  );

  function handleOpenVectorIndex() {
    setVecOpen(true);
    setVecExpandedId(null);
    setVecSourceFilter("");
    loadVectorIndex(0, "");
  }

  function handleVecSourceChange(source: string) {
    setVecSourceFilter(source);
    setVecExpandedId(null);
    loadVectorIndex(0, source);
  }

  async function handleDeleteFile(fileId: string, fileName: string) {
    // Clean up corresponding vectors in ChromaDB
    try {
      const params = new URLSearchParams({
        source: fileName,
        knowledgeBaseId: id,
        vectorDbType: kb?.vectorDbType ?? "chroma",
      });
      console.log("========params========", params);
      const res = await fetch(`/api/knowledge/vector-index?${params}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      console.error("Failed to delete vectors for file:", fileName, err);
    }
    await remove(fileId);
  }

  if (pageLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {t("knowledge.loading")}
        </p>
      </div>
    );
  }

  if (!kb) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">
          {t("knowledge.notFound")}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/knowledge")}
        >
          {t("knowledge.backToList")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Link
          href="/knowledge"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          title={t("knowledge.backToList")}
        >
          <ArrowLeftIcon className="size-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold truncate">{kb.name}</h1>
            <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {kb.vectorDbType === "zvec" ? "Zvec" : "ChromaDB"}
            </span>
          </div>
          {kb.description && (
            <p className="text-xs text-muted-foreground truncate">
              {kb.description}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenVectorIndex}
          title={t("knowledge.viewVectorIndex")}
        >
          <ListIcon className="size-4" />
          {t("knowledge.vectorIndex")}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={openEdit}
          title={t("knowledge.editInfo")}
        >
          <PencilIcon className="size-4" />
        </Button>
        <Button
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <UploadIcon className="size-4" />
          )}
          {t("knowledge.uploadPdf")}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
          onChange={handleUpload}
        />
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto p-6">
        {filesLoading ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            {t("knowledge.loadingFiles")}
          </p>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <FileTextIcon className="size-12 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">
              {t("knowledge.noFiles")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {files.map((f) => (
              <div
                key={f.id}
                className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-shadow hover:shadow-sm"
              >
                <FileTextIcon className="size-5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{f.name}</p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{formatBytes(f.size)}</span>
                    <span>·</span>
                    <span>{new Date(f.uploadedAt).toLocaleString(locale)}</span>
                    {f.indexStatus === "done" && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2Icon className="size-3" />
                          {t("knowledge.indexed", { count: f.chunkCount })}
                        </span>
                        {f.indexedAt && (
                          <>
                            <span>·</span>
                            <span>
                              {t("knowledge.indexedAt")}{" "}
                              {new Date(f.indexedAt).toLocaleString(locale)}
                            </span>
                          </>
                        )}
                        {f.indexDurationMs !== undefined && (
                          <>
                            <span>·</span>
                            <span>
                              {t("knowledge.duration", {
                                duration: formatDuration(f.indexDurationMs),
                              })}
                            </span>
                          </>
                        )}
                      </>
                    )}
                    {f.indexStatus === "error" && (
                      <>
                        <span>·</span>
                        <span
                          className="inline-flex items-center gap-0.5 text-destructive"
                          title={f.indexError}
                        >
                          <XCircleIcon className="size-3" />
                          {t("knowledge.indexFailed")}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Index action buttons */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => handleViewFile(f.name)}
                  >
                    <ExternalLinkIcon className="size-3" />
                    {t("knowledge.viewFile")}
                  </Button>

                  {f.indexStatus === "building" ? (
                    <div className="flex items-center gap-2">
                      <div className="relative h-5 w-28 rounded-full bg-muted overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-blue-400 transition-all duration-300 ease-out"
                          style={{ width: `${buildProgress[f.id] ?? 0}%` }}
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium tabular-nums">
                          {buildProgress[f.id] ?? 0}%
                        </span>
                      </div>
                      <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
                    </div>
                  ) : f.indexStatus === "done" ? (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => handleViewChunks(f.name)}
                    >
                      <EyeIcon className="size-3" />
                      {t("knowledge.viewIndex")}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => handleBuildIndex(f)}
                    >
                      <DatabaseIcon className="size-3" />
                      {t("knowledge.buildIndex")}
                    </Button>
                  )}

                  {f.indexStatus === "done" && (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => handleBuildIndex(f)}
                    >
                      <DatabaseIcon className="size-3" />
                      {t("knowledge.rebuild")}
                    </Button>
                  )}

                  <button
                    onClick={() => handleDeleteFile(f.id, f.name)}
                    className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                    title={t("knowledge.deleteFile")}
                    type="button"
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("knowledge.editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("knowledge.name")}
              </label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={t("knowledge.name")}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("knowledge.description")}
              </label>
              <Input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder={t("knowledge.descriptionPlaceholder")}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">
                  {t("knowledge.vectorDbType")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {files.length > 0
                    ? t("knowledge.vectorDbTypeLocked")
                    : t("knowledge.vectorDbTypeHint")}
                </p>
              </div>
              <select
                className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={editDbType}
                onChange={(e) => setEditDbType(e.target.value as VectorDbType)}
                disabled={files.length > 0}
              >
                <option value="chroma">ChromaDB</option>
                <option value="zvec">Zvec</option>
              </select>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">{t("knowledge.reranker")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("knowledge.rerankerHint")}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={editRerank}
                onClick={() => setEditRerank((v) => !v)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  editRerank ? "bg-blue-500" : "bg-muted"
                }`}
              >
                <span
                  className={`pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform ${
                    editRerank ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              {t("knowledge.cancel")}
            </Button>
            <Button onClick={handleEditSave} disabled={!editName.trim()}>
              {t("knowledge.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vector Index Viewer Dialog */}
      <Dialog open={vecOpen} onOpenChange={setVecOpen}>
        <DialogContent
          className="max-h-[85vh] flex flex-col"
          style={{ maxWidth: 1000 }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DatabaseIcon className="size-5" />
              {t("knowledge.vectorIndexTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto -mx-6 px-6">
            {vecLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">
                  {t("knowledge.loadingVectorIndex")}
                </span>
              </div>
            ) : vecError ? (
              <div className="py-16 text-center">
                <XCircleIcon className="mx-auto size-8 text-destructive mb-2" />
                <p className="text-sm text-destructive">{vecError}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {kb.vectorDbType === "zvec"
                    ? t("knowledge.vectorIndexZvecHint")
                    : t("knowledge.vectorIndexChromaHint")}
                </p>
              </div>
            ) : vecItems.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-16">
                {t("knowledge.vectorIndexEmpty")}
              </p>
            ) : (
              <div className="pb-4">
                {/* Filter + Summary */}
                <div className="flex items-center gap-3 mb-3">
                  <select
                    className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
                    value={vecSourceFilter}
                    onChange={(e) => handleVecSourceChange(e.target.value)}
                  >
                    <option value="">{t("knowledge.allFiles")}</option>
                    {vecSources.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground flex-1">
                    <span className="font-medium text-foreground">
                      {t("knowledge.totalRecords", { count: vecTotal })}
                    </span>
                    {vecTotal > VEC_LIMIT && (
                      <span>
                        {" "}
                        {t("knowledge.currentRange", {
                          start: vecOffset + 1,
                          end: Math.min(vecOffset + VEC_LIMIT, vecTotal),
                        })}
                      </span>
                    )}
                  </p>
                  {/* Pagination */}
                  {vecTotal > VEC_LIMIT && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={vecOffset === 0 || vecLoading}
                        onClick={() =>
                          loadVectorIndex(
                            Math.max(0, vecOffset - VEC_LIMIT),
                            vecSourceFilter,
                          )
                        }
                      >
                        <ChevronLeftIcon className="size-3" />
                        {t("knowledge.prevPage")}
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={
                          vecOffset + VEC_LIMIT >= vecTotal || vecLoading
                        }
                        onClick={() =>
                          loadVectorIndex(
                            vecOffset + VEC_LIMIT,
                            vecSourceFilter,
                          )
                        }
                      >
                        {t("knowledge.nextPage")}
                        <ChevronRightIcon className="size-3" />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Table */}
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/60">
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground w-10">
                          #
                        </th>
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground w-48">
                          ID
                        </th>
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                          {t("knowledge.textContent")}
                        </th>
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground w-44">
                          Embedding
                        </th>
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground w-36">
                          Metadata
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {vecItems.map((item, idx) => {
                        const isExpanded = vecExpandedId === item.id;
                        const textPreview =
                          item.text.length > 120
                            ? item.text.slice(0, 120) + "…"
                            : item.text;
                        return (
                          <tr
                            key={item.id}
                            className="border-t border-border hover:bg-muted/30 cursor-pointer transition-colors"
                            onClick={() =>
                              setVecExpandedId(isExpanded ? null : item.id)
                            }
                          >
                            <td className="px-3 py-2 text-muted-foreground align-top">
                              {vecOffset + idx + 1}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] align-top break-all">
                              {item.id}
                            </td>
                            <td className="px-3 py-2 align-top">
                              <p className="whitespace-pre-wrap break-words leading-relaxed">
                                {isExpanded ? item.text : textPreview}
                              </p>
                              {item.text.length > 120 && (
                                <span className="text-[10px] text-muted-foreground">
                                  {item.text.length} chars
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-[10px] text-indigo-500 dark:text-indigo-400 align-top">
                              {item.embeddingDim > 0 ? (
                                <>
                                  [{item.embeddingPreview.join(", ")}, …]
                                  <br />
                                  <span className="text-muted-foreground">
                                    dim={item.embeddingDim}
                                  </span>
                                </>
                              ) : (
                                <span className="text-muted-foreground">
                                  {t("knowledge.none")}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 align-top">
                              <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-words">
                                {JSON.stringify(item.metadata, null, 1)}
                              </pre>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Bottom pagination */}
                {vecTotal > VEC_LIMIT && (
                  <div className="flex justify-end mt-3">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={vecOffset === 0 || vecLoading}
                        onClick={() =>
                          loadVectorIndex(
                            Math.max(0, vecOffset - VEC_LIMIT),
                            vecSourceFilter,
                          )
                        }
                      >
                        <ChevronLeftIcon className="size-3" />
                        {t("knowledge.prevPage")}
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={
                          vecOffset + VEC_LIMIT >= vecTotal || vecLoading
                        }
                        onClick={() =>
                          loadVectorIndex(
                            vecOffset + VEC_LIMIT,
                            vecSourceFilter,
                          )
                        }
                      >
                        {t("knowledge.nextPage")}
                        <ChevronRightIcon className="size-3" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setVecOpen(false)}>
              {t("knowledge.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
