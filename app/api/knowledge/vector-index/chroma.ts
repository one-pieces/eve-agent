import { ChromaClient, type Collection } from "chromadb";
import { sortItemsByNaturalId } from "./zvec";

export function getChromaClient() {
  const raw = process.env.CHROMA_HOST ?? "http://localhost:8000";
  let host = "localhost";
  let port = 8000;
  let ssl = false;
  try {
    const u = new URL(raw);
    host = u.hostname;
    port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 8000;
    ssl = u.protocol === "https:";
  } catch {
    host = raw;
  }
  return new ChromaClient({ host, port, ssl });
}

export async function getChroma(
  collection: string,
  source: string,
  offset: number,
  limit: number,
) {
  const client = getChromaClient();
  const col = await client.getOrCreateCollection({
    name: collection,
    embeddingFunction: null,
  });

  // Fetch all metadatas to extract distinct sources
  const allMeta = await col.get({ include: ["metadatas"] });
  const allMetas = allMeta.metadatas ?? [];
  const sourcesSet = new Set<string>();
  for (const m of allMetas) {
    if (m && typeof m.source === "string" && m.source) {
      sourcesSet.add(m.source);
    }
  }
  const sources = Array.from(sourcesSet).sort();

  const whereFilter = source ? { source: { $eq: source } } : undefined;

  let total: number;
  if (whereFilter) {
    const filtered = await col.get({ where: whereFilter as never });
    total = filtered.ids.length;
  } else {
    total = await col.count();
  }

  const getOptions: Record<string, unknown> = {
    include: ["documents", "metadatas", "embeddings"],
    limit,
    offset,
  };
  if (whereFilter) {
    getOptions.where = whereFilter;
  }
  const data = await col.get(getOptions as never);

  const ids = data.ids ?? [];
  const docs = data.documents ?? [];
  const metas = data.metadatas ?? [];
  const embeds = data.embeddings ?? [];

  const items = ids.map((id, i) => {
    const emb = embeds[i] as number[] | null;
    return {
      id,
      text: docs[i] ?? "",
      metadata: metas[i] ?? {},
      embeddingDim: emb ? emb.length : 0,
      embeddingPreview: emb ? emb.slice(0, 8).map((v) => v.toFixed(4)) : [],
    };
  });

  return { total, sources, items: sortItemsByNaturalId(items) };
}

export async function deleteChroma(collection: string, source: string) {
  const client = getChromaClient();

  if (!source) {
    // No source specified — delete the entire collection
    try {
      await client.deleteCollection({ name: collection });
    } catch {
      // Collection doesn't exist (e.g. no file was ever indexed) — nothing to delete
      return {
        success: true,
        deleted: "collection",
        collection,
        deletedCount: 0,
      };
    }
    return { success: true, deleted: "collection", collection };
  }

  // Delete all vectors matching the given source
  let col: Collection;
  try {
    col = await client.getCollection({
      name: collection,
    });
  } catch {
    // Collection doesn't exist, nothing to delete
    return { success: true, deletedCount: 0 };
  }

  const res = await col.get({ where: { source: { $eq: source } } as never });
  const ids = res.ids ?? [];
  if (ids.length > 0) {
    await col.delete({ ids });
  }

  return { success: true, deletedCount: ids.length, source };
}
