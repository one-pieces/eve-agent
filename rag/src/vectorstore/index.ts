/**
 * 向量库模块 —— 对应原 Python src/vectorstore.py
 *
 * 提供统一的 VectorStore 接口和三种实现：
 * - MemoryVectorStore：纯内存，零依赖，适合开发/测试
 * - ChromaVectorStore：对接 ChromaDB server，支持持久化（对应原 Python 版）
 * - ZvecVectorStore：对接 @zvec/zvec，进程内向量库，零 server 依赖，支持持久化
 *
 * 通过 createVectorStore() 工厂函数按配置自动选择后端。
 */

import type { Chunk } from "../types";
import { ChromaVectorStore } from "./chroma";
import { MemoryVectorStore } from "./memory";
import { ZvecVectorStore } from "./zvec";

// ─── 公共接口 ──────────────────────────────────────────────────────

export interface VectorStore {
  add(chunks: Chunk[], embeddings: number[][]): Promise<void>;
  query(queryEmbedding: number[], topK?: number): Promise<Chunk[]>;
  allChunks(): Promise<Chunk[]>;
  count(): Promise<number>;
  deleteBySource(source: string): Promise<number>;
}

// ─── 三种后端实现 ──────────────────────────────────────────────────

export { ChromaVectorStore, type ChromaVectorStoreOptions } from "./chroma";
export { MemoryVectorStore } from "./memory";
export {
  ZvecVectorStore,
  type ZvecVectorStoreOptions,
  openZvecCollectionCached,
  evictZvecCollectionCache,
} from "./zvec";

// ─── 工厂函数 ──────────────────────────────────────────────────────

export type VectorStoreBackend = "chroma" | "memory" | "zvec";

export interface CreateVectorStoreOptions {
  /** 显式指定后端；未指定时回退到环境变量 VECTOR_STORE_BACKEND，再回退到 "chroma" */
  backend?: VectorStoreBackend;
  chromaHost?: string;
  collection?: string;
  /** zvec 集合的磁盘存储路径 */
  zvecPath?: string;
  /** zvec 向量维度（集合首次创建时需要） */
  zvecDimension?: number;
}

/**
 * 根据配置创建向量库实例
 * - backend="chroma"（默认）：连接 ChromaDB server，支持持久化
 * - backend="memory"：纯内存，零依赖
 * - backend="zvec"：@zvec/zvec 进程内向量库，零 server 依赖，支持持久化
 *
 * 优先级：options.backend > 环境变量 VECTOR_STORE_BACKEND > 默认值 "chroma"
 */
export function createVectorStore(
  options: CreateVectorStoreOptions = {},
): VectorStore {
  const backend =
    options.backend ??
    (process.env.VECTOR_STORE_BACKEND as VectorStoreBackend | undefined) ??
    "chroma";

  if (backend === "chroma") {
    return new ChromaVectorStore({
      host: options.chromaHost,
      collection: options.collection,
    });
  }
  if (backend === "zvec") {
    return new ZvecVectorStore({
      path: options.zvecPath,
      collection: options.collection,
      dimension: options.zvecDimension,
    });
  }
  return new MemoryVectorStore();
}
