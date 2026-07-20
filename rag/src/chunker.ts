/**
 * 文档切分模块 —— 对应原 Python src/chunker.py
 *
 * 结构感知 + 语义边界切分：
 * 优先在「第 N 条 / 标题 / 段落」边界处下刀，装不下再退到句子边界，
 * overlap 也对齐到完整句子，尽量不把一句话拦腰切断。
 */

import type { Chunk, LoadedDoc } from "./types";

// 结构边界：中文条款常见的「第N条 / 一、/(一)/ 1.」等
const HEADING_RE =
  /(?=第[一二三四五六七八九十百零\d]+条)|(?=^[一二三四五六七八九十]+、)|(?=^（[一二三四五六七八九十\d]+）)/gm;

// 句子边界
const SENT_RE = /(?<=[。!?；!?;\n])/g;

/**
 * 先按结构边界切成「语义单元」，过长的单元再按句子切碎
 */
function splitUnits(text: string): string[] {
  const units: string[] = [];
  // split by heading regex
  const blocks = text.split(HEADING_RE).filter((b) => b.trim());
  for (const block of blocks) {
    if (block.length <= 1024) {
      units.push(block);
    } else {
      // 按句子拆
      const sentences = block.split(SENT_RE).filter((s) => s.trim());
      units.push(...sentences);
    }
  }
  return units;
}

/**
 * 取一段文本结尾的 overlap 个字符，并裁齐到最近的句子边界
 */
function tailOverlap(text: string, overlap: number): string {
  if (overlap <= 0) return "";
  if (text.length <= overlap) return text;
  const tail = text.slice(-overlap);
  const m = tail.match(/[。!?；!?;\n]/);
  return m && m.index !== undefined ? tail.slice(m.index + 1) : tail;
}

/**
 * 把一段文本切成 Chunk 列表
 */
export function chunkText(
  text: string,
  chunkSize = 512,
  chunkOverlap = 50,
  source = "",
): Chunk[] {
  const chunks: Chunk[] = [];
  let buf = "";

  const flush = () => {
    if (buf.trim()) {
      chunks.push({
        text: buf.trim(),
        source,
        chunkId: chunks.length,
        metadata: { source },
      });
    }
    buf = "";
  };

  for (const unit of splitUnits(text)) {
    // 装得下就继续累积；装不下就先把当前块收口，再带 overlap 开新块
    if (buf && buf.length + unit.length > chunkSize) {
      const prev = buf;
      flush();
      buf = tailOverlap(prev, chunkOverlap);
    }
    buf += unit;

    // 累积后仍超长，直接收口
    while (buf.length > chunkSize) {
      const cut = buf.slice(0, chunkSize);
      // 在句子边界切
      const matches = [...cut.matchAll(SENT_RE)];
      const splitAt =
        matches.length > 0 ? matches[matches.length - 1].index! : chunkSize;
      chunks.push({
        text: buf.slice(0, splitAt).trim(),
        source,
        chunkId: chunks.length,
        metadata: { source },
      });
      buf =
        tailOverlap(buf.slice(0, splitAt), chunkOverlap) + buf.slice(splitAt);
    }
  }
  flush();
  return chunks;
}

/**
 * 切分一篇已加载的文档
 */
export function chunkDoc(
  doc: LoadedDoc,
  chunkSize = 512,
  chunkOverlap = 50,
): Chunk[] {
  return chunkText(doc.text, chunkSize, chunkOverlap, doc.source);
}
