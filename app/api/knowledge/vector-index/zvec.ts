import { resolve } from "node:path";
import type { ZVecDoc, ZVecCollection } from "@zvec/zvec";
import {
  openZvecCollectionCached,
  evictZvecCollectionCache,
} from "../../../../rag/src/vectorstore";

export function zvecPathForCollection(collection: string): string {
  return (
    process.env.ZVEC_PATH ??
    resolve(process.cwd(), "rag", "data", "zvec_data", collection)
  );
}

function zvecDocToItem(d: ZVecDoc) {
  const emb = d.vectors?.embedding as number[] | undefined;
  // Zvec 的内部文档 id 是 sha1 摘要（用于满足其长度/字符集限制），不便于
  // 展示。这里改用 source#chunk_id 拼出可读的展示 id，与 ChromaDB 路径
  // 保持一致，同时也让 sortItemsByNaturalId 能正常按文件名+序号排序。
  const source = String(d.fields.source ?? "");
  const chunkId = String(d.fields.chunk_id ?? "");
  return {
    id: `${source}#${chunkId}`,
    text: String(d.fields.text ?? ""),
    metadata: d.fields as Record<string, unknown>,
    embeddingDim: emb ? emb.length : 0,
    embeddingPreview: emb ? emb.slice(0, 8).map((v) => v.toFixed(4)) : [],
  };
}

export function sortItemsByNaturalId<T extends { id: string }>(
  items: T[],
): T[] {
  const parse = (s: string) => {
    const idx = s.lastIndexOf("#");
    if (idx < 0) return { prefix: s, num: 0 };
    const prefix = s.slice(0, idx);
    const num = parseInt(s.slice(idx + 1), 10);
    return { prefix, num: isNaN(num) ? 0 : num };
  };
  return items.sort((a, b) => {
    const pa = parse(a.id);
    const pb = parse(b.id);
    if (pa.prefix !== pb.prefix) return pa.prefix.localeCompare(pb.prefix);
    return pa.num - pb.num;
  });
}

export async function getZvec(
  collection: string,
  source: string,
  offset: number,
  limit: number,
) {
  const path = zvecPathForCollection(collection);
  let col: ZVecCollection | null;
  try {
    col = openZvecCollectionCached(path, true);
  } catch {
    // Directory exists but is not a valid/complete zvec collection
    // (e.g. left behind by an aborted ingestion).
    return { total: 0, sources: [] as string[], items: [] };
  }
  if (!col) {
    return { total: 0, sources: [] as string[], items: [] };
  }
  const totalDocs = col.stats.docCount;
  if (totalDocs === 0) {
    return { total: 0, sources: [] as string[], items: [] };
  }

  const all = await col.query({
    filter: "chunk_id >= 0",
    topk: totalDocs,
    includeVector: true,
  });
  const sourcesSet = new Set<string>();
  for (const d of all) {
    const s = d.fields.source;
    if (typeof s === "string" && s) sourcesSet.add(s);
  }
  const sources = Array.from(sourcesSet).sort();

  const filtered = source ? all.filter((d) => d.fields.source === source) : all;
  const items = sortItemsByNaturalId(filtered.map(zvecDocToItem));

  return {
    total: items.length,
    sources,
    items: items.slice(offset, offset + limit),
  };
}

export async function deleteZvec(collection: string, source: string) {
  const path = zvecPathForCollection(collection);
  let col: ZVecCollection | null;
  try {
    col = openZvecCollectionCached(path);
  } catch {
    // Directory exists but is not a valid/complete zvec collection
    // (e.g. left behind by an aborted ingestion).
    return { success: true, deletedCount: 0 };
  }
  if (!col) {
    return { success: true, deletedCount: 0 };
  }

  if (!source) {
    col.destroySync();
    evictZvecCollectionCache(path);
    return { success: true, deleted: "collection", collection };
  }

  const filter = `source = "${source.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const matches = await col.query({
    filter,
    topk: col.stats.docCount,
  });
  if (matches.length > 0) {
    await col.deleteByFilter(filter);
  }
  return { success: true, deletedCount: matches.length, source };
}
