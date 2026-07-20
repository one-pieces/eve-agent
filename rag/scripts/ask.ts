/**
 * 完整版问答脚本 —— 对应原 Python scripts/ask.py
 *
 * 链路：Query 改写 → 向量+BM25 双路检索 → 带引用的答案生成
 *
 * 前置：
 *   1) npx tsx rag/scripts/build_index.ts   # 建向量库（只需一次）
 *   2) 配置 LLM 相关环境变量（生成答案需要）
 *
 * 用法：NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx --env-file=.env rag/scripts/ask.ts "等待期是多少天?"
 */

import { RAGPipeline } from "../src/pipeline";

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error('用法: npx tsx rag/scripts/ask.ts "你的问题"');
    process.exit(1);
  }

  console.log("🔧 装配 pipeline（首次会加载本地模型，稍候）…");
  const pipe = new RAGPipeline({ useRerank: true });

  const count = await pipe.chunkCount();
  if (count === 0) {
    console.error(
      "⚠️  向量库是空的，请先建库：npx tsx rag/scripts/build_index.ts",
    );
    process.exit(1);
  }

  console.log(`💬 提问：${query}\n`);
  const answer = await pipe.ask(query);

  console.log(`答案：\n${answer.text}\n`);
  if (answer.sources.length > 0) {
    console.log(`来源：${answer.sources.join(", ")}`);
  }
}

main().catch((err) => {
  console.error("❌ 问答失败:", err);
  process.exit(1);
});
