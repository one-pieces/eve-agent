import { defineTool } from "eve/tools";
import { z } from "zod";
import { RAGPipeline } from "../../rag/src/pipeline";
import type { VectorStoreBackend } from "../../rag/src/vectorstore";
import { collectionNameForKB } from "../../lib/utils";

// 按知识库 ID + 后端类型缓存 pipeline 实例，避免每次调用重新初始化
const _pipelines = new Map<string, RAGPipeline>();

function getPipeline(
  knowledgeBaseId?: string,
  vectorDbType?: VectorStoreBackend,
): RAGPipeline {
  const key = `${knowledgeBaseId ?? "__global__"}::${vectorDbType ?? "chroma"}`;
  let pipeline = _pipelines.get(key);
  if (!pipeline) {
    pipeline = new RAGPipeline({
      useRerank: true,
      collection: collectionNameForKB(knowledgeBaseId),
      vectorStoreBackend: vectorDbType,
    });
    _pipelines.set(key, pipeline);
  }
  return pipeline;
}

export default defineTool({
  description:
    "Search the RAG knowledge base for relevant documents. " +
    "Use this tool when the user asks questions that might be answered " +
    "by the indexed documents (e.g. insurance policies, internal docs). " +
    "Returns relevant text chunks with source references. " +
    "Synthesize your answer based on the returned chunks and cite sources. " +
    "If the conversation context specifies knowledge base(s) this conversation " +
    "is bound to, always pass their id(s) via knowledgeBaseId/knowledgeBaseIds, " +
    "along with the matching vectorDbType/vectorDbTypes if the context specifies one " +
    "(each knowledge base may use a different vector DB backend).",
  inputSchema: z.object({
    query: z.string().min(1).describe("The search query or user question"),
    topK: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Number of results to return (default 5)"),
    knowledgeBaseId: z
      .string()
      .optional()
      .describe(
        "Knowledge base ID to search in. If omitted, searches the global default collection.",
      ),
    knowledgeBaseIds: z
      .array(z.string())
      .optional()
      .describe(
        "Multiple knowledge base IDs to search in and merge results from. " +
          "Use this when the conversation is bound to more than one knowledge base.",
      ),
    vectorDbType: z
      .enum(["chroma", "zvec"])
      .optional()
      .describe(
        'Vector DB backend for knowledgeBaseId. Defaults to "chroma" if omitted.',
      ),
    vectorDbTypes: z
      .array(z.enum(["chroma", "zvec"]))
      .optional()
      .describe(
        "Vector DB backend for each entry in knowledgeBaseIds, in the same order. " +
          'Defaults to "chroma" for any entry left unspecified.',
      ),
  }),
  async execute({
    query,
    topK = 5,
    knowledgeBaseId,
    knowledgeBaseIds,
    vectorDbType,
    vectorDbTypes,
  }) {
    const ids = knowledgeBaseIds?.length ? knowledgeBaseIds : [knowledgeBaseId];
    const types = knowledgeBaseIds?.length
      ? knowledgeBaseIds.map((_, i) => vectorDbTypes?.[i])
      : [vectorDbType];

    const perBase = await Promise.all(
      ids.map(async (id, i) => {
        const pipeline = getPipeline(id, types[i]);
        const count = await pipeline.chunkCount();
        if (count === 0) return { id, count, candidates: [] };
        const candidates = await pipeline.retrieve(query, topK);
        return { id, count, candidates };
      }),
    );

    const totalChunksInIndex = perBase.reduce((sum, b) => sum + b.count, 0);
    if (totalChunksInIndex === 0) {
      return {
        results: [],
        message:
          "Knowledge base is empty. Please build the index first: npx tsx rag/scripts/build_index.ts",
      };
    }

    const results = perBase
      .flatMap((b) =>
        b.candidates.map((rc) => ({
          text: rc.chunk.text,
          source: rc.chunk.source,
          chunkId: rc.chunk.chunkId,
          score: Math.round(rc.score * 1000) / 1000,
          knowledgeBaseId: b.id ?? null,
        })),
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return {
      results,
      totalChunksInIndex,
    };
  },
});
