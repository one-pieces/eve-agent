/**
 * RAG 模块公共导出
 */

// 核心类型
export type {
  LoadedDoc,
  Chunk,
  RetrievedChunk,
  ProcessedQuery,
  Answer,
  LLMMessage,
} from "./types";

// 管线
export { RAGPipeline } from "./pipeline";

// 各子模块（按需导入）
export { loadFile, loadDir } from "./loader";
export { chunkText, chunkDoc } from "./chunker";
export {
  type VectorStore,
  ChromaVectorStore,
  MemoryVectorStore,
  ZvecVectorStore,
  createVectorStore,
  type VectorStoreBackend,
  type CreateVectorStoreOptions,
  type ChromaVectorStoreOptions,
  type ZvecVectorStoreOptions,
} from "./vectorstore";
export { Retriever, type Embedder } from "./retriever";
export { CrossEncoderReranker, type Reranker } from "./reranker";
export { HFEmbedder } from "./embedder";
export { processQuery, allQueries } from "./query-processor";
export { generate, buildMessages } from "./generator";
export { llmCall } from "./llm";
export * as config from "./config";
