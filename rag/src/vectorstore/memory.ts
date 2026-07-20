/**
 * 内存向量库实现（开发/测试用）—— 纯内存，零依赖
 */

import type { Chunk } from "../types";
import type { VectorStore } from "./index";

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

interface StoredEntry {
  id: string;
  chunk: Chunk;
  embedding: number[];
}

export class MemoryVectorStore implements VectorStore {
  private entries: StoredEntry[] = [];

  async add(chunks: Chunk[], embeddings: number[][]): Promise<void> {
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const id = `${c.source}#${c.chunkId}`;
      const existIdx = this.entries.findIndex((e) => e.id === id);
      const entry: StoredEntry = { id, chunk: c, embedding: embeddings[i] };
      if (existIdx >= 0) {
        this.entries[existIdx] = entry;
      } else {
        this.entries.push(entry);
      }
    }
  }

  async query(queryEmbedding: number[], topK = 5): Promise<Chunk[]> {
    const scored = this.entries.map((e) => ({
      chunk: e.chunk,
      score: cosineSimilarity(queryEmbedding, e.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.chunk);
  }

  async allChunks(): Promise<Chunk[]> {
    return this.entries.map((e) => e.chunk);
  }

  async count(): Promise<number> {
    return this.entries.length;
  }

  async deleteBySource(source: string): Promise<number> {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.chunk.source !== source);
    return before - this.entries.length;
  }
}
