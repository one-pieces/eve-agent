import { join } from "node:path";
import { loadFile } from "../../../../rag/src/loader";
import { chunkDoc } from "../../../../rag/src/chunker";
import { CHUNK_SIZE, CHUNK_OVERLAP } from "../../../../rag/src/config";
import { RAGPipeline } from "../../../../rag/src/pipeline";
import { collectionNameForKB } from "@/lib/utils";

const DOCS_DIR = join(process.cwd(), "rag", "data", "sample_docs");

export async function POST(request: Request) {
  let fileName: string;
  let knowledgeBaseId: string | undefined;
  let vectorDbType: "chroma" | "zvec" | undefined;
  try {
    const body = (await request.json()) as {
      fileName?: string;
      knowledgeBaseId?: string;
      vectorDbType?: "chroma" | "zvec";
    };
    if (!body.fileName) {
      return new Response(JSON.stringify({ error: "fileName is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    fileName = body.fileName;
    knowledgeBaseId = body.knowledgeBaseId;
    vectorDbType = body.vectorDbType;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        // Phase 1: loading & chunking
        send("progress", {
          phase: "chunking",
          percent: 0,
          message: "正在解析文档…",
        });

        const filePath = join(DOCS_DIR, fileName);
        const doc = await loadFile(filePath);
        const chunks = chunkDoc(doc, CHUNK_SIZE, CHUNK_OVERLAP);

        send("progress", {
          phase: "chunking",
          percent: 5,
          message: `文档解析完成，共 ${chunks.length} 个分块`,
        });

        // Phase 2: embedding + indexing (5% → 95%)
        const pipe = new RAGPipeline({
          vectorStoreBackend: vectorDbType,
          collection: collectionNameForKB(knowledgeBaseId),
        });
        await pipe.addChunks(chunks, (done, total) => {
          const percent = Math.round(5 + (done / total) * 90);
          send("progress", {
            phase: "embedding",
            percent,
            done,
            total,
            message: `向量化中 ${done}/${total}`,
          });
        });

        // Phase 3: done
        const totalInStore = await pipe.chunkCount();
        send("done", {
          percent: 100,
          chunkCount: chunks.length,
          totalChunks: totalInStore,
          message: "索引构建完成",
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Build index failed";
        send("error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
