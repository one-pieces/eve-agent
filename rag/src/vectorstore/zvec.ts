/**
 * Zvec 向量库实现 —— 对接 @zvec/zvec，进程内向量库，零 server 依赖，支持持久化
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ZVecCreateAndOpen,
  ZVecDataType,
  ZVecIndexType,
  ZVecMetricType,
  ZVecOpen,
  ZVecCollectionSchema,
  type ZVecCollection,
  type ZVecDoc,
} from "@zvec/zvec";
import type { Chunk } from "../types";
import type { VectorStore } from "./index";

export interface ZvecVectorStoreOptions {
  /** 集合在磁盘上的存储路径，默认 rag/data/zvec_data/<collection> */
  path?: string;
  /** 集合名，默认 rag_docs（仅在未指定 path 时用于生成默认路径） */
  collection?: string;
  /**
   * 向量维度。首次创建集合时必须已知：
   * - 若显式传入则直接使用
   * - 否则在首次 add() 时根据 embeddings[0].length 推断
   */
  dimension?: number;
}

const VECTOR_FIELD = "embedding";

/**
 * Zvec collection 句柄按磁盘路径进程级缓存。
 *
 * Zvec 底层通过 LOCK 文件互斥，同一路径在同一进程内重复 `ZVecOpen` 会因
 * 锁冲突而抛错。Next.js dev/生产 server 是长驻进程，若每次请求都各自
 * `ZVecOpen` 一个新句柄且从不 `closeSync()`，后续对同一路径的 open 就会
 * 失败（表现为“数据其实存在，但接口返回空”）。这里用一个共享缓存确保
 * 同一路径在进程内只打开一次，被 ZvecVectorStore 及只读查询接口复用。
 */
const collectionCache = new Map<string, ZVecCollection>();

function cacheKey(path: string, readOnly: boolean): string {
  return `${path}::${readOnly ? "ro" : "rw"}`;
}

/**
 * 打开（或复用已缓存的）zvec collection；集合不存在时返回 null。
 *
 * `readOnly=true` 时以只读模式打开：只读句柄不持有独占的读写锁，
 * 因此不会与其他进程（例如 Next.js server 与 agent 工具执行进程）
 * 已持有的读写句柄发生 "Can't lock read-write collection" 冲突。
 * 仅在确实需要写入时才使用 readOnly=false。
 */
export function openZvecCollectionCached(
  path: string,
  readOnly = false,
): ZVecCollection | null {
  const key = cacheKey(path, readOnly);
  const cached = collectionCache.get(key);
  if (cached) return cached;
  if (!existsSync(path)) return null;
  const col = ZVecOpen(path, { readOnly });
  collectionCache.set(key, col);
  return col;
}

/** 从缓存中移除给定路径的句柄（例如集合已被销毁）。 */
export function evictZvecCollectionCache(path: string): void {
  collectionCache.delete(cacheKey(path, false));
  collectionCache.delete(cacheKey(path, true));
}

export class ZvecVectorStore implements VectorStore {
  private path: string;
  private dimension?: number;

  constructor(options: ZvecVectorStoreOptions = {}) {
    this.path =
      options.path ??
      process.env.ZVEC_PATH ??
      resolve(
        process.cwd(),
        "rag",
        "data",
        "zvec_data",
        options.collection ?? "rag_docs",
      );
    this.dimension =
      options.dimension ??
      (process.env.ZVEC_DIMENSION
        ? Number(process.env.ZVEC_DIMENSION)
        : undefined);
  }

  /**
   * 打开已存在的集合；不存在时按需创建（需已知向量维度）。
   * `readOnly=true` 时仅打开只读句柄，用于纯查询场景，避免与其他进程
   * （如 Next.js server 与 agent 工具执行进程）持有的读写句柄发生锁冲突。
   * 集合不存在时，无论 readOnly 与否都会按读写模式创建（创建本身即是写操作）。
   */
  private col(dimensionHint?: number, readOnly = false): ZVecCollection {
    const existing = openZvecCollectionCached(this.path, readOnly);
    if (existing) return existing;
    if (readOnly) {
      // 只读场景下集合不存在，不应触发创建；退回到共享的读写句柄（如果已被
      // 其他调用打开），否则视为空集合的调用方需自行处理不存在的情况。
      const rw = openZvecCollectionCached(this.path, false);
      if (rw) return rw;
    }
    const dimension = this.dimension ?? dimensionHint;
    if (!dimension) {
      throw new Error(
        "ZvecVectorStore: 集合不存在且无法确定向量维度，请传入 `dimension` 选项，或先调用 add() 传入非空 embeddings",
      );
    }
    mkdirSync(dirname(this.path), { recursive: true });
    const schema = new ZVecCollectionSchema({
      name: "rag_docs",
      vectors: {
        name: VECTOR_FIELD,
        dataType: ZVecDataType.VECTOR_FP32,
        dimension,
        indexParams: {
          indexType: ZVecIndexType.HNSW,
          metricType: ZVecMetricType.COSINE,
        },
      },
      fields: [
        { name: "text", dataType: ZVecDataType.STRING },
        { name: "source", dataType: ZVecDataType.STRING },
        { name: "chunk_id", dataType: ZVecDataType.INT64 },
      ],
    });
    const col = ZVecCreateAndOpen(this.path, schema);
    collectionCache.set(cacheKey(this.path, false), col);
    return col;
  }

  private toChunk(d: ZVecDoc): Chunk {
    return {
      text: String(d.fields.text ?? ""),
      source: String(d.fields.source ?? ""),
      chunkId: Number(d.fields.chunk_id ?? 0),
      metadata: d.fields as Record<string, unknown>,
    };
  }

  private escapeFilterValue(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  /**
   * Zvec 的文档 id 只允许受限字符集且长度 <= 64，而 source 文件名可能包含
   * 空格、中文、# 等字符，且十六进制编码后长度可能超限，因此不能直接用作
   * id。这里改用 sha1 摘要（40 位十六进制，确定性，满足长度限制），保证
   * 同一 source+chunkId 始终映射到同一 id（支持 upsert 语义）。真实的
   * source/chunk_id 仍作为独立字段存储，供过滤查询使用。
   */
  private docId(source: string, chunkId: number): string {
    return createHash("sha1").update(`${source}#${chunkId}`).digest("hex");
  }

  async add(chunks: Chunk[], embeddings: number[][]): Promise<void> {
    if (chunks.length === 0) return;
    const col = this.col(embeddings[0]?.length);
    col.upsertSync(
      chunks.map((c, i) => ({
        id: this.docId(c.source, c.chunkId),
        vectors: { [VECTOR_FIELD]: embeddings[i] },
        fields: { text: c.text, source: c.source, chunk_id: c.chunkId },
      })),
    );
  }

  async query(queryEmbedding: number[], topK = 5): Promise<Chunk[]> {
    const col = this.col(undefined, true);
    const docs = await col.query({
      fieldName: VECTOR_FIELD,
      vector: queryEmbedding,
      topk: topK,
    });
    return docs.map((d) => this.toChunk(d));
  }

  async allChunks(): Promise<Chunk[]> {
    const col = this.col(undefined, true);
    const total = col.stats.docCount;
    if (total === 0) return [];
    const docs = await col.query({ filter: "chunk_id >= 0", topk: total });
    return docs.map((d) => this.toChunk(d));
  }

  async count(): Promise<number> {
    return this.col(undefined, true).stats.docCount;
  }

  async deleteBySource(source: string): Promise<number> {
    const col = this.col();
    const filter = `source = "${this.escapeFilterValue(source)}"`;
    const total = col.stats.docCount;
    if (total === 0) return 0;
    const matches = await col.query({ filter, topk: total });
    if (matches.length > 0) {
      await col.deleteByFilter(filter);
    }
    return matches.length;
  }

  /** 彻底删除该集合的磁盘数据，之后不应再使用该实例 */
  destroyCollection(): void {
    this.col().destroySync();
    evictZvecCollectionCache(this.path);
  }
}
