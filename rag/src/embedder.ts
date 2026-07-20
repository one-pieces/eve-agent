/**
 * Embedding 模块 —— 对应原 Python src/embedder.py
 *
 * 使用 @huggingface/transformers (Transformers.js) 在 Node.js 本地推理，
 * 默认模型 BAAI/bge-m3，和原 Python 版一致。
 */

import type { Embedder } from "./retriever";

// 惰性缓存：避免重复加载模型
let _pipeline: any = null;
let _modelName: string = "";

/**
 * 基于 HuggingFace Transformers.js 的本地 Embedding 实现
 */
export class HFEmbedder implements Embedder {
  private modelName: string;

  /**
   * @param modelName HuggingFace 模型名，默认 BAAI/bge-m3
   */
  constructor(modelName = "BAAI/bge-m3") {
    this.modelName = modelName;
  }

  private async ensurePipeline() {
    if (_pipeline && _modelName === this.modelName) return _pipeline;

    const { pipeline } = await import("@huggingface/transformers");
    _pipeline = await pipeline("feature-extraction", this.modelName, {
      dtype: "fp32",
    });
    _modelName = this.modelName;
    return _pipeline;
  }

  /**
   * 将文本列表转换为向量列表
   */
  async encode(texts: string[]): Promise<number[][]> {
    const pipe = await this.ensurePipeline();
    const results: number[][] = [];
    for (const text of texts) {
      const output = await pipe(text, { pooling: "cls", normalize: true });
      results.push(Array.from(output.data as Float32Array));
    }
    return results;
  }

  /**
   * 编码单条查询
   */
  async encodeQuery(query: string): Promise<number[]> {
    const results = await this.encode([query]);
    return results[0];
  }
}
