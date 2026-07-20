/**
 * 主流程 —— 对应原 Python src/pipeline.py
 *
 * 把 loader → chunker → retriever → query_processor → generator
 * 串成一条完整链路。
 *
 * buildIndex() 离线建库；ask() 在线问答。
 */

import * as config from "./config";
import { chunkDoc } from "./chunker";
import { HFEmbedder } from "./embedder";
import { generate } from "./generator";
import { loadDir } from "./loader";
import { allQueries, processQuery } from "./query-processor";
import { CrossEncoderReranker, type Reranker } from "./reranker";
import { Retriever, type Embedder } from "./retriever";
import {
  createVectorStore,
  type VectorStore,
  type VectorStoreBackend,
} from "./vectorstore";
import type { Answer, Chunk, RetrievedChunk } from "./types";

export interface RAGPipelineOptions {
  /** 自定义 Embedder 实现；默认使用 HFEmbedder("BAAI/bge-m3") */
  embedder?: Embedder | null;
  /** 设为 true 则不加载 embedding 模型，仅用 BM25 检索 */
  bm25Only?: boolean;
  /** 自定义 VectorStore 实例（传入后忽略下面的 backend 相关选项） */
  vectorStore?: VectorStore;
  /** 向量库后端；未指定时回退到环境变量 VECTOR_STORE_BACKEND，再回退到 "chroma" */
  vectorStoreBackend?: VectorStoreBackend;
  /** ChromaDB server 地址 */
  chromaHost?: string;
  /** 向量库集合名（chroma / zvec 共用） */
  collection?: string;
  /** zvec 集合的磁盘存储路径（backend="zvec" 时使用） */
  zvecPath?: string;
  /** zvec 向量维度（backend="zvec" 时，集合首次创建需要） */
  zvecDimension?: number;
  /** 自定义 Reranker 实现；默认根据 USE_RERANK 开关决定 */
  reranker?: Reranker | null;
  /** 是否启用重排（覆盖环境变量 USE_RERANK） */
  useRerank?: boolean;
}

export class RAGPipeline {
  private store: VectorStore;
  private embedder: Embedder | null;
  private reranker: Reranker | null;
  private retriever: Retriever;
  private allChunks: Chunk[] = [];

  constructor(options: RAGPipelineOptions = {}) {
    const { embedder, bm25Only = false } = options;
    this.store =
      options.vectorStore ??
      createVectorStore({
        backend: options.vectorStoreBackend,
        chromaHost: options.chromaHost,
        collection: options.collection,
        zvecPath: options.zvecPath,
        zvecDimension: options.zvecDimension,
      });
    this.embedder = bm25Only
      ? null
      : (embedder ??
        new HFEmbedder(process.env.EMBEDDING_MODEL || "BAAI/bge-m3"));

    const useRerank = options.useRerank ?? config.USE_RERANK;
    this.reranker =
      options.reranker !== undefined
        ? options.reranker
        : useRerank
          ? new CrossEncoderReranker(
              process.env.RERANK_MODEL ||
                "kftof/bge-reranker-v2-m3-onnx-int8-avx2",
            )
          : null;

    this.retriever = new Retriever([], this.store, this.embedder);
  }

  /**
   * 从向量库重建检索器（BM25 路需要全量文本）
   */
  private async refreshRetriever(): Promise<void> {
    this.allChunks = await this.store.allChunks();
    this.retriever = new Retriever(this.allChunks, this.store, this.embedder);
  }

  /**
   * 离线构建索引（加载文档 → 分块 → 向量化 → 入库）
   * @returns 插入的 chunk 数量
   */
  async buildIndex(docsDir?: string): Promise<number> {
    const docs = await loadDir(docsDir ?? config.DATA_DIR);
    const chunks: Chunk[] = [];
    for (const doc of docs) {
      chunks.push(...chunkDoc(doc, config.CHUNK_SIZE, config.CHUNK_OVERLAP));
    }

    if (chunks.length > 0) {
      if (this.embedder) {
        // 有 embedder 时做向量化入库
        const embeddings: number[][] = [];
        for (const c of chunks) {
          const vec = await this.embedder.encodeQuery(c.text);
          embeddings.push(vec);
        }
        await this.store.add(chunks, embeddings);
      } else {
        // 无 embedder 时，用零向量占位，仅靠 BM25 检索
        const zeros = chunks.map(() => [0]);
        await this.store.add(chunks, zeros);
      }
    }
    await this.refreshRetriever();
    return chunks.length;
  }

  /**
   * 直接添加文本块（不从文件加载，适合程序化添加内容）
   * @param onProgress 可选回调，参数为 (已完成数, 总数)
   */
  async addChunks(
    chunks: Chunk[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    if (chunks.length === 0) return;
    if (this.embedder) {
      const embeddings: number[][] = [];
      for (let i = 0; i < chunks.length; i++) {
        const vec = await this.embedder.encodeQuery(chunks[i].text);
        embeddings.push(vec);
        onProgress?.(i + 1, chunks.length);
      }
      await this.store.add(chunks, embeddings);
    } else {
      const zeros = chunks.map(() => [0]);
      await this.store.add(chunks, zeros);
    }
    await this.refreshRetriever();
  }

  /**
   * 仅检索：查询改写 → 双路检索（含扩展），返回候选 chunks（不调 LLM 生成）
   * 适合作为 agent tool 的后端，让 agent 自行整合上下文。
   */
  async retrieve(query: string, topK?: number): Promise<RetrievedChunk[]> {
    const pq = await processQuery(query);

    const pool = new Map<string, RetrievedChunk>();
    const queries = allQueries(pq).slice(0, 3);

    for (const q of queries) {
      const results = await this.retriever.retrieve(
        q,
        config.RETRIEVE_TOP_N,
        config.RETRIEVE_TOP_N,
      );
      for (const rc of results) {
        const key = `${rc.chunk.source}#${rc.chunk.chunkId}`;
        if (!pool.has(key) || rc.score > pool.get(key)!.score) {
          pool.set(key, rc);
        }
      }
    }

    const candidates = [...pool.values()].sort((a, b) => b.score - a.score);

    // 有 reranker 时做精排，否则直接按融合分截断
    if (this.reranker) {
      return this.reranker.rerank(
        query,
        candidates,
        topK ?? config.RERANK_TOP_K,
      );
    }
    return candidates.slice(0, topK ?? config.RERANK_TOP_K);
  }

  /**
   * 在线问答：查询改写 → 双路检索（含扩展）→ 带引用生成
   */
  async ask(query: string): Promise<Answer> {
    const contexts = await this.retrieve(query);
    return generate(query, contexts);
  }

  /**
   * 获取当前索引中的 chunk 数量
   */
  async chunkCount(): Promise<number> {
    return this.store.count();
  }
}
