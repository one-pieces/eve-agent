/**
 * 文件加载模块 —— 对应原 Python src/loader.py
 * 支持 .txt / .md 纯文本加载；PDF 需安装 pdf-parse（可选依赖）
 */

import { readdir, readFile } from "fs/promises";
import { basename, extname, join } from "path";
import type { LoadedDoc } from "./types";

/** 支持的文件扩展名 */
const TEXT_EXTS = new Set([".txt", ".md", ".markdown"]);
const PDF_EXT = ".pdf";

/**
 * 清理文本中的非法字符：NUL 字节、C0 控制字符（保留 \n \t \r）以及未配对的
 * UTF-16 代理项。PDF 解析（尤其是扫描件/编码异常的 PDF）经常产出这类字符，
 * 会被下游向量库（如 Zvec）的字符串校验拒绝。
 */
function sanitizeText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x00 || code === 0x7f) continue;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i++;
      }
      continue; // 丢弃未配对的高位代理项
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue; // 丢弃未配对的低位代理项
    out += text[i];
  }
  return out;
}

/**
 * 加载单个文本文件
 */
async function loadTextFile(filePath: string): Promise<LoadedDoc> {
  const text = sanitizeText(await readFile(filePath, "utf-8"));
  return {
    source: basename(filePath),
    text,
    metadata: { numChars: text.length },
  };
}

/**
 * 加载单个 PDF 文件（需要 pdf-parse 可选依赖）
 */
async function loadPdfFile(filePath: string): Promise<LoadedDoc> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const buffer = await readFile(filePath);
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const textResult = await parser.getText();
    const info = await parser.getInfo();
    await parser.destroy();

    const text = sanitizeText(textResult.text);
    return {
      source: basename(filePath),
      text,
      metadata: { numPages: info.total, numChars: text.length },
    };
  } catch (error) {
    console.error("PDF 加载失败:", error);
    throw new Error(
      `PDF 加载失败：请安装 pdf-parse (npm install pdf-parse)，或将文件转为 txt/md 格式`,
    );
  }
}

/**
 * 加载单个文件（自动识别格式）
 */
export async function loadFile(filePath: string): Promise<LoadedDoc> {
  const ext = extname(filePath).toLowerCase();
  if (TEXT_EXTS.has(ext)) return loadTextFile(filePath);
  if (ext === PDF_EXT) return loadPdfFile(filePath);
  throw new Error(`不支持的文件格式: ${ext}（支持 txt, md, pdf）`);
}

/**
 * 加载目录下的所有支持格式的文件
 */
export async function loadDir(dirPath: string): Promise<LoadedDoc[]> {
  const entries = await readdir(dirPath).catch(() => [] as string[]);
  const supportedExts = new Set([...TEXT_EXTS, PDF_EXT]);
  const files = entries
    .filter((f) => supportedExts.has(extname(f).toLowerCase()))
    .sort();

  const docs: LoadedDoc[] = [];
  for (const file of files) {
    const doc = await loadFile(join(dirPath, file));
    if (doc.text.trim()) {
      docs.push(doc);
    }
  }
  return docs;
}
