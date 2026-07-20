"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BookOpenIcon,
  FileTextIcon,
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  FolderOpenIcon,
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
import { useKnowledgeList } from "@/app/_hooks/use-knowledge-list";
import {
  getFilesByKnowledgeBase,
  type KnowledgeBase,
  type VectorDbType,
} from "@/lib/knowledge-db";
import { useLanguage } from "@/app/_context/language-context";

export default function KnowledgePage() {
  const { t, locale } = useLanguage();
  const { bases, loading, create, update, remove } = useKnowledgeList();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeBase | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dbType, setDbType] = useState<VectorDbType>("chroma");
  const [rerank, setRerank] = useState(false);
  const [editingHasFiles, setEditingHasFiles] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeBase | null>(null);
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      bases.map(async (kb) => {
        const files = await getFilesByKnowledgeBase(kb.id);
        return [kb.id, files.length] as const;
      }),
    ).then((entries) => {
      if (!cancelled) setFileCounts(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [bases]);

  function openCreate() {
    setEditing(null);
    setName("");
    setDescription("");
    setDbType("chroma");
    setRerank(false);
    setEditingHasFiles(false);
    setDialogOpen(true);
  }

  async function openEdit(kb: KnowledgeBase) {
    setEditing(kb);
    setName(kb.name);
    setDescription(kb.description);
    setDbType(kb.vectorDbType ?? "chroma");
    setRerank(kb.useRerank ?? false);
    setEditingHasFiles(false);
    setDialogOpen(true);
    const files = await getFilesByKnowledgeBase(kb.id);
    setEditingHasFiles(files.length > 0);
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    if (editing) {
      await update(editing.id, {
        name: trimmedName,
        description: description.trim(),
        vectorDbType: dbType,
        useRerank: rerank,
      });
    } else {
      await create(trimmedName, description.trim(), dbType, rerank);
    }
    setDialogOpen(false);
  }

  function openDeleteConfirm(kb: KnowledgeBase) {
    setDeleteTarget(kb);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await remove(deleteTarget.id);
    setDeleteTarget(null);
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {t("knowledge.loading")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <BookOpenIcon className="size-5 text-foreground" />
          <h1 className="text-lg font-semibold">{t("knowledge.title")}</h1>
        </div>
        <Button size="sm" onClick={openCreate}>
          <PlusIcon className="size-4" />
          {t("knowledge.create")}
        </Button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-6">
        {bases.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <FolderOpenIcon className="size-12 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">
              {t("knowledge.empty")}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {bases.map((kb) => (
              <div
                key={kb.id}
                className="group relative flex flex-col gap-2 rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-md"
              >
                <Link
                  href={`/knowledge/${kb.id}`}
                  className="absolute inset-0 z-0 rounded-lg"
                />
                <div className="flex items-start justify-between">
                  <h2 className="text-sm font-medium text-foreground truncate pr-16">
                    {kb.name}
                  </h2>
                  <div className="relative z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        openEdit(kb);
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      title={t("knowledge.edit")}
                      type="button"
                    >
                      <PencilIcon className="size-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        openDeleteConfirm(kb);
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      title={t("knowledge.delete")}
                      type="button"
                    >
                      <Trash2Icon className="size-3.5" />
                    </button>
                  </div>
                </div>
                {kb.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {kb.description}
                  </p>
                )}
                <div className="mt-auto flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <FileTextIcon className="size-3" />
                    {t("knowledge.fileCount", {
                      count: fileCounts[kb.id] ?? 0,
                    })}
                  </span>
                  <span>
                    {t("knowledge.updatedAt")}{" "}
                    {new Date(kb.updatedAt).toLocaleString(locale)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? t("knowledge.editTitle") : t("knowledge.createTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("knowledge.name")}
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("knowledge.namePlaceholder")}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("knowledge.description")}
              </label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("knowledge.descriptionPlaceholder")}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">
                  {t("knowledge.vectorDbType")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {editingHasFiles
                    ? t("knowledge.vectorDbTypeLocked")
                    : t("knowledge.vectorDbTypeHint")}
                </p>
              </div>
              <select
                className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={dbType}
                onChange={(e) => setDbType(e.target.value as VectorDbType)}
                disabled={editingHasFiles}
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
                aria-checked={rerank}
                onClick={() => setRerank((v) => !v)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  rerank ? "bg-blue-500" : "bg-muted"
                }`}
              >
                <span
                  className={`pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform ${
                    rerank ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("knowledge.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={!name.trim()}>
              {editing ? t("knowledge.save") : t("knowledge.createButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("knowledge.deleteTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("knowledge.deleteConfirm", { name: deleteTarget?.name ?? "" })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("knowledge.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t("knowledge.deleteButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
