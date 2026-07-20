/**
 * IndexedDB storage for knowledge bases and their files.
 */

const DB_NAME = "eve-knowledge";
const DB_VERSION = 1;
const KB_STORE = "knowledgeBases";
const FILE_STORE = "knowledgeFiles";

/**
 * 向量库后端类型。与 rag/src/vectorstore.ts 中的 VectorStoreBackend 保持一致，
 * 此处独立定义为字符串字面量类型，避免把仅限 Node 运行时的 rag 模块
 * （依赖 chromadb / @zvec/zvec 等原生 / 网络能力）打包进浏览器端代码。
 */
export type VectorDbType = "chroma" | "zvec";

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  /** 是否启用 cross-encoder 重排，默认 false */
  useRerank?: boolean;
  /** 向量库类型，默认 "chroma" */
  vectorDbType?: VectorDbType;
}

export type IndexStatus = "none" | "building" | "done" | "error";

export interface KnowledgeFile {
  id: string;
  knowledgeBaseId: string;
  name: string;
  size: number;
  uploadedAt: string;
  indexStatus: IndexStatus;
  chunkCount: number;
  indexError?: string;
  /** 索引建立完成的时间 */
  indexedAt?: string;
  /** 建立索引所用时间（毫秒） */
  indexDurationMs?: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KB_STORE)) {
        db.createObjectStore(KB_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        const fileStore = db.createObjectStore(FILE_STORE, { keyPath: "id" });
        fileStore.createIndex("knowledgeBaseId", "knowledgeBaseId", {
          unique: false,
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ── Knowledge Base CRUD ──

export async function getAllKnowledgeBases(): Promise<KnowledgeBase[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KB_STORE, "readonly");
    const store = tx.objectStore(KB_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = req.result as KnowledgeBase[];
      items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getKnowledgeBase(
  id: string,
): Promise<KnowledgeBase | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KB_STORE, "readonly");
    const req = tx.objectStore(KB_STORE).get(id);
    req.onsuccess = () => resolve(req.result as KnowledgeBase | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function createKnowledgeBase(
  name: string,
  description: string,
  vectorDbType?: VectorDbType,
  useRerank?: boolean,
): Promise<KnowledgeBase> {
  const db = await openDB();
  const now = new Date().toISOString();
  const kb: KnowledgeBase = {
    id: crypto.randomUUID(),
    name,
    description,
    createdAt: now,
    updatedAt: now,
    vectorDbType: vectorDbType ?? "chroma",
    useRerank: useRerank ?? false,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KB_STORE, "readwrite");
    tx.objectStore(KB_STORE).put(kb);
    tx.oncomplete = () => resolve(kb);
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateKnowledgeBase(
  id: string,
  patch: Partial<
    Pick<KnowledgeBase, "name" | "description" | "useRerank" | "vectorDbType">
  >,
): Promise<KnowledgeBase> {
  const db = await openDB();
  const existing = await getKnowledgeBase(id);
  if (!existing) throw new Error("Knowledge base not found");
  const updated: KnowledgeBase = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KB_STORE, "readwrite");
    tx.objectStore(KB_STORE).put(updated);
    tx.oncomplete = () => resolve(updated);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteKnowledgeBase(id: string): Promise<void> {
  const db = await openDB();
  // Delete all files belonging to this KB
  const files = await getFilesByKnowledgeBase(id);
  return new Promise((resolve, reject) => {
    const tx = db.transaction([KB_STORE, FILE_STORE], "readwrite");
    tx.objectStore(KB_STORE).delete(id);
    const fileStore = tx.objectStore(FILE_STORE);
    for (const f of files) {
      fileStore.delete(f.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Knowledge File CRUD ──

export async function getFilesByKnowledgeBase(
  knowledgeBaseId: string,
): Promise<KnowledgeFile[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, "readonly");
    const index = tx.objectStore(FILE_STORE).index("knowledgeBaseId");
    const req = index.getAll(knowledgeBaseId);
    req.onsuccess = () => {
      const items = req.result as KnowledgeFile[];
      items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function addKnowledgeFile(file: KnowledgeFile): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, "readwrite");
    tx.objectStore(FILE_STORE).put(file);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateKnowledgeFile(
  id: string,
  patch: Partial<
    Pick<
      KnowledgeFile,
      | "indexStatus"
      | "chunkCount"
      | "indexError"
      | "indexedAt"
      | "indexDurationMs"
    >
  >,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, "readwrite");
    const store = tx.objectStore(FILE_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const existing = req.result as KnowledgeFile | undefined;
      if (!existing) {
        reject(new Error("File not found"));
        return;
      }
      store.put({ ...existing, ...patch });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteKnowledgeFile(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, "readwrite");
    tx.objectStore(FILE_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
