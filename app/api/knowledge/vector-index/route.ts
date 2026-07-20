import { NextResponse } from "next/server";
import { collectionNameForKB } from "@/lib/utils";
import { getChroma, deleteChroma } from "./chroma";
import { getZvec, deleteZvec } from "./zvec";

type VectorDbType = "chroma" | "zvec";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const knowledgeBaseId = searchParams.get("knowledgeBaseId");
    const collection =
      searchParams.get("collection") ?? collectionNameForKB(knowledgeBaseId);
    const offset = parseInt(searchParams.get("offset") ?? "0", 10);
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);
    const source = searchParams.get("source") ?? "";
    const vectorDbType = (searchParams.get("vectorDbType") ??
      "chroma") as VectorDbType;

    const { total, sources, items } =
      vectorDbType === "zvec"
        ? await getZvec(collection, source, offset, limit)
        : await getChroma(collection, source, offset, limit);

    return NextResponse.json({
      collection,
      total,
      offset,
      limit,
      sources,
      items,
    });
  } catch (err) {
    console.error("Vector index query failed:", err);
    const message =
      err instanceof Error ? err.message : "Vector index query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const knowledgeBaseId = searchParams.get("knowledgeBaseId");
    const collection =
      searchParams.get("collection") ?? collectionNameForKB(knowledgeBaseId);
    const source = searchParams.get("source") ?? "";
    const vectorDbType = (searchParams.get("vectorDbType") ??
      "chroma") as VectorDbType;

    const result =
      vectorDbType === "zvec"
        ? await deleteZvec(collection, source)
        : await deleteChroma(collection, source);

    return NextResponse.json(result);
  } catch (err) {
    console.error("Vector index delete failed:", err);
    const message =
      err instanceof Error ? err.message : "Vector index delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
