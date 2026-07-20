/**
 * RAG 配置模块 —— 对应原 Python src/config.py
 * 从环境变量读取配置，提供合理默认值
 */

import { resolve } from "path";

// ─── 路径 ─────────────────────────────────────────────────────────
export const PROJECT_ROOT = resolve(process.cwd());
export const DATA_DIR = resolve(PROJECT_ROOT, "rag", "data", "sample_docs");

// ─── 切分 / 检索 / 重排默认值 ────────────────────────────────────
/** 每个 chunk 目标字符数 */
export const CHUNK_SIZE = 512;
/** 相邻 chunk 重叠字符数，避免把一句话拦腰切断 */
export const CHUNK_OVERLAP = 50;
/** 召回候选池大小：双路各取前 N 再融合 */
export const RETRIEVE_TOP_N = 20;
/** 重排后保留、最终喂给 LLM 的条数 */
export const RERANK_TOP_K = 5;
/** 不开重排时，检索直接返回的条数 */
export const TOP_K = 5;

// ─── 开关 ─────────────────────────────────────────────────────────
const envBool = (key: string, fallback: boolean): boolean => {
  const v = process.env[key]?.toLowerCase();
  if (!v) return fallback;
  return !["0", "false", "no"].includes(v);
};

export const USE_QUERY_REWRITE = envBool("USE_QUERY_REWRITE", true);
/** 是否启用 cross-encoder 重排（默认关闭，首次启用需下载 ~2GB 模型） */
export const USE_RERANK = envBool("USE_RERANK", false);
