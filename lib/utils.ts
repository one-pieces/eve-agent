import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * 将知识库 ID 转换为 ChromaDB collection 名称。
 * 格式：kb_{uuid}，满足 ChromaDB 3–63 字符限制。
 * 传入空值时回退到全局默认 collection。
 */
export function collectionNameForKB(knowledgeBaseId?: string | null): string {
  if (!knowledgeBaseId) return "rag_docs";
  return `kb_${knowledgeBaseId}`;
}
