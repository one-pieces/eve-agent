/**
 * 检索模块 —— 对应原 Python src/retriever.py
 *
 * BM25 关键词检索 + 可选的向量检索，两路用 RRF 融合。
 * BM25 擅长「关键词精确命中」，向量路擅长「语义相近」，两者互补。
 */

import type { Chunk, RetrievedChunk } from "./types";
import type { VectorStore } from "./vectorstore";

// ─── 分词 ──────────────────────────────────────────────────────────
// 简易中文字级分词：按字拆分（去空白），对 BM25 已足够
function tokenize(text: string): string[] {
  return text.replace(/\s+/g, "").split("");
}

// ─── BM25 ──────────────────────────────────────────────────────────
class BM25 {
  private docs: string[][];
  private N: number;
  private avgdl: number;
  private df: Map<string, number> = new Map();
  private k1: number;
  private b: number;

  constructor(docsTokens: string[][], k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.docs = docsTokens;
    this.N = docsTokens.length;
    this.avgdl =
      this.N > 0
        ? docsTokens.reduce((sum, d) => sum + d.length, 0) / this.N
        : 0;

    // 计算文档频率
    for (const doc of docsTokens) {
      const unique = new Set(doc);
      for (const t of unique) {
        this.df.set(t, (this.df.get(t) ?? 0) + 1);
      }
    }
  }

  private idf(t: string): number {
    const n = this.df.get(t) ?? 0;
    return Math.log(1 + (this.N - n + 0.5) / (n + 0.5));
  }

  scores(query: string): number[] {
    const q = tokenize(query);
    return this.docs.map((doc) => {
      let score = 0;
      const dl = doc.length;
      for (const t of q) {
        const f = doc.filter((w) => w === t).length;
        if (!f) continue;
        const tf =
          (f * (this.k1 + 1)) /
          (f + this.k1 * (1 - this.b + (this.b * dl) / (this.avgdl || 1)));
        score += this.idf(t) * tf;
      }
      return score;
    });
  }
}

// ─── Embedder 接口 ─────────────────────────────────────────────────
/** 向量编码器接口，可由外部实现注入 */
export interface Embedder {
  encodeQuery(query: string): Promise<number[]>;
}

// ─── Retriever ─────────────────────────────────────────────────────
export class Retriever {
  private store: VectorStore | null;
  private embedder: Embedder | null;
  private chunks: Chunk[];
  private bm25: BM25 | null;

  constructor(
    chunks: Chunk[],
    store: VectorStore | null = null,
    embedder: Embedder | null = null,
  ) {
    this.store = store;
    this.embedder = embedder;
    this.chunks = chunks;
    this.bm25 =
      chunks.length > 0 ? new BM25(chunks.map((c) => tokenize(c.text))) : null;
  }

  private static key(c: Chunk): string {
    return `${c.source}#${c.chunkId}`;
  }

  /**
   * 混合检索：BM25 + 向量（可选）双路召回，用 RRF 融合
   */
  async retrieve(
    query: string,
    topK = 5,
    topN = 20,
    rrfK = 60,
  ): Promise<RetrievedChunk[]> {
    const rankedLists: Chunk[][] = [];

    // 向量路（有 store + embedder 时才启用）
    if (this.store && this.embedder) {
      try {
        const qv = await this.embedder.encodeQuery(query);
        rankedLists.push(await this.store.query(qv, topN));
      } catch {
        // 向量路失败不影响 BM25 路
      }
    }

    // BM25 路
    if (this.bm25) {
      const scores = this.bm25.scores(query);
      const order = scores
        .map((s, i) => ({ score: s, idx: i }))
        .sort((a, b) => b.score - a.score)
        .filter((x) => x.score > 0)
        .slice(0, topN);
      rankedLists.push(order.map((x) => this.chunks[x.idx]));
    }

    // RRF 融合
    const fused = new Map<string, number>();
    const byKey = new Map<string, Chunk>();
    for (const list of rankedLists) {
      for (let rank = 0; rank < list.length; rank++) {
        const c = list[rank];
        const k = Retriever.key(c);
        fused.set(k, (fused.get(k) ?? 0) + 1.0 / (rrfK + rank + 1));
        if (!byKey.has(k)) byKey.set(k, c);
      }
    }

    const ordered = [...fused.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);

    return ordered.map(([k, score]) => ({
      chunk: byKey.get(k)!,
      score,
    }));
  }
}
