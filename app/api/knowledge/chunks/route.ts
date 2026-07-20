import { NextResponse } from "next/server";
import { join } from "node:path";
import { loadFile } from "../../../../rag/src/loader";
import { chunkDoc } from "../../../../rag/src/chunker";
import { CHUNK_SIZE, CHUNK_OVERLAP } from "../../../../rag/src/config";

const DOCS_DIR = join(process.cwd(), "rag", "data", "sample_docs");

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get("fileName");
    if (!fileName) {
      return NextResponse.json(
        { error: "fileName query param is required" },
        { status: 400 },
      );
    }

    const filePath = join(DOCS_DIR, fileName);
    const doc = await loadFile(filePath);
    const chunks = chunkDoc(doc, CHUNK_SIZE, CHUNK_OVERLAP);

    const result = chunks.map((c, i) => ({
      chunkId: i,
      source: c.source,
      text: c.text,
    }));

    return NextResponse.json({
      fileName,
      chunkCount: chunks.length,
      chunks: result,
    });
  } catch (err) {
    console.error("Get chunks failed:", err);
    const message = err instanceof Error ? err.message : "Get chunks failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
