/**
 * ChromaDB 向量库实现 —— 对接 ChromaDB server，支持持久化（对应原 Python 版）
 */

import { ChromaClient, type Collection } from "chromadb";
import type { Chunk } from "../types";
import type { VectorStore } from "./index";

export interface ChromaVectorStoreOptions {
  /** ChromaDB server 地址，默认 http://localhost:8000 */
  host?: string;
  /** 集合名，默认 rag_docs */
  collection?: string;
}

export class ChromaVectorStore implements VectorStore {
  private client: ChromaClient;
  private collectionName: string;
  private _col: Collection | null = null;

  constructor(options: ChromaVectorStoreOptions = {}) {
    const raw =
      options.host ?? process.env.CHROMA_HOST ?? "http://localhost:8000";
    // chromadb v3.x expects host/port/ssl separately, not a URL
    let host = "localhost";
    let port = 8000;
    let ssl = false;
    try {
      const u = new URL(raw);
      host = u.hostname;
      port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 8000;
      ssl = u.protocol === "https:";
    } catch {
      host = raw;
    }
    this.collectionName = options.collection ?? "rag_docs";
    this.client = new ChromaClient({ host, port, ssl });
  }

  private async col(): Promise<Collection> {
    if (!this._col) {
      this._col = await this.client.getOrCreateCollection({
        name: this.collectionName,
        embeddingFunction: null,
        metadata: { "hnsw:space": "cosine" },
      });
    }
    return this._col;
  }

  async add(chunks: Chunk[], embeddings: number[][]): Promise<void> {
    if (chunks.length === 0) return;
    const col = await this.col();
    const ids = chunks.map((c) => `${c.source}#${c.chunkId}`);
    await col.upsert({
      ids,
      embeddings,
      documents: chunks.map((c) => c.text),
      metadatas: chunks.map((c) => ({
        source: c.source,
        chunk_id: c.chunkId,
      })),
    });
  }

  async query(queryEmbedding: number[], topK = 5): Promise<Chunk[]> {
    const col = await this.col();
    const res = await col.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
    });
    const docs = res.documents?.[0] ?? [];
    const metas = res.metadatas?.[0] ?? [];
    return docs.map((d, i) => {
      const m = metas[i] ?? {};
      return {
        text: d ?? "",
        source: String(m.source ?? ""),
        chunkId: Number(m.chunk_id ?? 0),
        metadata: m as Record<string, unknown>,
      };
    });
  }

  async allChunks(): Promise<Chunk[]> {
    const col = await this.col();
    const res = await col.get({ include: ["documents", "metadatas"] });
    const docs = res.documents ?? [];
    const metas = res.metadatas ?? [];
    return docs.map((d, i) => {
      const m = metas[i] ?? {};
      return {
        text: d ?? "",
        source: String(m.source ?? ""),
        chunkId: Number(m.chunk_id ?? 0),
        metadata: m as Record<string, unknown>,
      };
    });
  }

  async count(): Promise<number> {
    const col = await this.col();
    return col.count();
  }

  async deleteBySource(source: string): Promise<number> {
    const col = await this.col();
    const res = await col.get({ where: { source: { $eq: source } } as never });
    const ids = res.ids ?? [];
    if (ids.length > 0) {
      await col.delete({ ids });
    }
    return ids.length;
  }

  async deleteCollection(): Promise<void> {
    await this.client.deleteCollection({ name: this.collectionName });
    this._col = null;
  }
}
