/**
 * RAG 系统共享类型定义
 * 对应原 Python 项目中分散在各模块的 dataclass
 */

/** 加载后的单篇文档 */
export interface LoadedDoc {
  /** 文件名，用于溯源 */
  source: string;
  /** 抽取出的全文纯文本 */
  text: string;
  /** 页数、字数等附加信息 */
  metadata: Record<string, unknown>;
}

/** 切分后的一个文本块 */
export interface Chunk {
  /** 这一块的文本 */
  text: string;
  /** 来源文件名（溯源用） */
  source: string;
  /** 在所属文档内的序号 */
  chunkId: number;
  /** 附加元数据 */
  metadata: Record<string, unknown>;
}

/** 检索结果：一个 chunk 加上它的相关性得分 */
export interface RetrievedChunk {
  chunk: Chunk;
  /** RRF 融合分 / 重排分 */
  score: number;
}

/** 处理后的查询 */
export interface ProcessedQuery {
  /** 用户原始问题 */
  original: string;
  /** 改写后的规范查询 */
  rewritten: string;
  /** 同义 / 多角度扩展查询 */
  expansions: string[];
}

/** 生成的答案 + 引用来源 */
export interface Answer {
  /** 答案正文 */
  text: string;
  /** 引用到的来源文件名 */
  sources: string[];
}

/** LLM 消息格式 */
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
