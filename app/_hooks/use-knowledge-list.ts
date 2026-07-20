"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAllKnowledgeBases,
  createKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
  getFilesByKnowledgeBase,
  addKnowledgeFile,
  updateKnowledgeFile,
  deleteKnowledgeFile,
  type KnowledgeBase,
  type KnowledgeFile,
} from "@/lib/knowledge-db";

export function useKnowledgeList() {
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const items = await getAllKnowledgeBases();
    setBases(items);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (
      name: string,
      description: string,
      vectorDbType?: KnowledgeBase["vectorDbType"],
      useRerank?: boolean,
    ) => {
      const kb = await createKnowledgeBase(
        name,
        description,
        vectorDbType,
        useRerank,
      );
      await refresh();
      return kb;
    },
    [refresh],
  );

  const update = useCallback(
    async (
      id: string,
      patch: Partial<
        Pick<
          KnowledgeBase,
          "name" | "description" | "vectorDbType" | "useRerank"
        >
      >,
    ) => {
      const kb = await updateKnowledgeBase(id, patch);
      await refresh();
      return kb;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      // Delete the entire per-KB vector store collection
      try {
        const kb = bases.find((b) => b.id === id);
        const params = new URLSearchParams({
          knowledgeBaseId: id,
          vectorDbType: kb?.vectorDbType ?? "chroma",
        });
        const res = await fetch(`/api/knowledge/vector-index?${params}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        // best-effort cleanup, but surface the failure so an orphaned
        // Chroma collection is not silently left behind
        console.error("Failed to delete vector store collection:", id, err);
      }
      await deleteKnowledgeBase(id);
      await refresh();
    },
    [bases, refresh],
  );

  return { bases, loading, refresh, create, update, remove };
}

export function useKnowledgeFiles(knowledgeBaseId: string) {
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const items = await getFilesByKnowledgeBase(knowledgeBaseId);
    setFiles(items);
    setLoading(false);
  }, [knowledgeBaseId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(
    async (file: KnowledgeFile) => {
      await addKnowledgeFile(file);
      await refresh();
    },
    [refresh],
  );

  const update = useCallback(
    async (
      id: string,
      patch: Partial<
        Pick<
          KnowledgeFile,
          | "indexStatus"
          | "chunkCount"
          | "indexError"
          | "indexedAt"
          | "indexDurationMs"
        >
      >,
    ) => {
      await updateKnowledgeFile(id, patch);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteKnowledgeFile(id);
      await refresh();
    },
    [refresh],
  );

  return { files, loading, refresh, add, update, remove };
}
