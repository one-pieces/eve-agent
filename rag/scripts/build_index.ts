/**
 * 一键建库脚本 —— 对应原 Python scripts/build_index.py
 *
 * 流程：加载文档 → 结构感知切分 → bge-m3 向量化 → 写入内存向量库
 * 建一次库即可，之后反复用 ask 提问，不必每次重建。
 *
 * 依赖：@huggingface/transformers（首次会下载 bge-m3 ONNX 模型）
 * 不需要 LLM API key（建库只用本地 Embedding 模型）。
 *
 * 用法：npx tsx rag/scripts/build_index.ts
 */

import { readdirSync } from "fs";
import { DATA_DIR } from "../src/config";
import { RAGPipeline } from "../src/pipeline";

async function main() {
  // 检查文档目录是否有文件
  let files: string[] = [];
  try {
    files = readdirSync(DATA_DIR).filter((f) =>
      /\.(pdf|txt|md|markdown)$/i.test(f),
    );
  } catch {
    // 目录不存在
  }

  if (files.length === 0) {
    console.error(
      `❌ ${DATA_DIR} 下没有可用文档（支持 .pdf / .txt / .md）\n` +
        `   请先将文档放入该目录`,
    );
    process.exit(1);
  }

  console.log("🔧 装配 pipeline（首次会加载 bge-m3，可能要等一会儿）…");
  const pipe = new RAGPipeline();

  console.log(`📚 从 ${DATA_DIR} 建库…`);
  const n = await pipe.buildIndex();
  const total = await pipe.chunkCount();

  console.log(`\n✅ 建库完成：本次写入 ${n} 个 chunk，库中共 ${total} 个。`);
  console.log(`\n下一步：npx tsx rag/scripts/ask.ts "你的问题"`);
}

main().catch((err) => {
  console.error("❌ 建库失败:", err);
  process.exit(1);
});
