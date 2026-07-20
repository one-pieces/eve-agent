/**
 * 重排模块 —— 对应原 Python src/reranker.py
 *
 * 检索召回讲究「快而广」，难免混进不相关的块。重排用更重的 cross-encoder
 * 模型对候选逐一精算相关性，把真正相关的顶到前面，再喂给 LLM。
 */

import type { RetrievedChunk } from "./types";

// ─── 公共接口 ──────────────────────────────────────────────────────

export interface Reranker {
  rerank(
    query: string,
    candidates: RetrievedChunk[],
    topK?: number,
  ): Promise<RetrievedChunk[]>;
}

// ─── Cross-Encoder 实现（Transformers.js） ─────────────────────────

// 惰性缓存：避免重复加载模型
let _tokenizer: any = null;
let _model: any = null;
let _cachedModelName: string = "";

/**
 * 基于 cross-encoder 的重排器。
 * 使用 @huggingface/transformers 在 Node.js 本地推理，
 * 默认模型 BAAI/bge-reranker-v2-m3，和原 Python 版一致。
 *
 * 模型惰性加载，仅在第一次 rerank 时触发下载/加载。
 */
export class CrossEncoderReranker implements Reranker {
  private modelName: string;

  /**
   * @param modelName HuggingFace cross-encoder 模型名
   */
  constructor(modelName = "kftof/bge-reranker-v2-m3-onnx-int8-avx2") {
    this.modelName = modelName;
  }

  private async ensureModel() {
    if (_tokenizer && _model && _cachedModelName === this.modelName) {
      return { tokenizer: _tokenizer, model: _model };
    }

    const { AutoTokenizer, AutoModelForSequenceClassification } =
      await import("@huggingface/transformers");

    _tokenizer = await AutoTokenizer.from_pretrained(this.modelName);
    _model = await AutoModelForSequenceClassification.from_pretrained(
      this.modelName,
      { dtype: "fp32" },
    );
    _cachedModelName = this.modelName;
    return { tokenizer: _tokenizer, model: _model };
  }

  /**
   * 对候选 chunk 重新打分排序。
   *
   * @param query 用户查询
   * @param candidates 检索阶段召回的候选
   * @param topK 重排后保留数量，默认 5
   * @returns 按重排得分从高到低的 RetrievedChunk 列表
   */
  async rerank(
    query: string,
    candidates: RetrievedChunk[],
    topK = 5,
  ): Promise<RetrievedChunk[]> {
    if (candidates.length === 0) return [];

    const { tokenizer, model } = await this.ensureModel();

    // 批量推理：把 (query, doc) 对一次性喂进去
    const scores: number[] = [];
    for (const rc of candidates) {
      const inputs = tokenizer(query, {
        text_pair: rc.chunk.text,
        padding: true,
        truncation: true,
      });
      const output = await model(inputs);
      // cross-encoder 输出 logits，取 [0][0] 作为相关性得分
      const logits = output.logits.data as Float32Array;
      scores.push(logits[0]);
    }

    const reranked: RetrievedChunk[] = candidates.map((rc, i) => ({
      chunk: rc.chunk,
      score: scores[i],
    }));

    reranked.sort((a, b) => b.score - a.score);
    return reranked.slice(0, topK);
  }
}
