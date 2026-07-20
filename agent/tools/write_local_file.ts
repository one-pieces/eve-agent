import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

function unifiedDiff(oldText: string, newText: string, path: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  type Change = {
    type: " " | "-" | "+";
    oldNo?: number;
    newNo?: number;
    text: string;
  };
  const changes: Change[] = [];
  let i = 0,
    j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && oldLines[i] === newLines[j]) {
      changes.push({
        type: " ",
        oldNo: i + 1,
        newNo: j + 1,
        text: oldLines[i],
      });
      i++;
      j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      changes.push({ type: "+", newNo: j + 1, text: newLines[j] });
      j++;
    } else {
      changes.push({ type: "-", oldNo: i + 1, text: oldLines[i] });
      i++;
    }
  }

  // Build hunks with context (3 lines)
  const CTX = 3;
  const modified = changes
    .map((c, idx) => (c.type !== " " ? idx : -1))
    .filter((i) => i >= 0);
  if (modified.length === 0) return "(no changes)";

  const hunks: Change[][] = [];
  let hunkStart = Math.max(0, modified[0] - CTX);
  let hunkEnd = Math.min(changes.length - 1, modified[0] + CTX);
  for (let k = 1; k < modified.length; k++) {
    const start = Math.max(0, modified[k] - CTX);
    const end = Math.min(changes.length - 1, modified[k] + CTX);
    if (start <= hunkEnd + 1) {
      hunkEnd = end;
    } else {
      hunks.push(changes.slice(hunkStart, hunkEnd + 1));
      hunkStart = start;
      hunkEnd = end;
    }
  }
  hunks.push(changes.slice(hunkStart, hunkEnd + 1));

  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`];
  for (const hunk of hunks) {
    const oldStart = hunk.find((c) => c.oldNo)?.oldNo ?? 0;
    const newStart = hunk.find((c) => c.newNo)?.newNo ?? 0;
    const oldCount = hunk.filter((c) => c.type !== "+").length;
    const newCount = hunk.filter((c) => c.type !== "-").length;
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const c of hunk) {
      lines.push(`${c.type}${c.text}`);
    }
  }
  return lines.join("\n");
}

export default defineTool({
  description: "Write a file to the local host filesystem (outside sandbox).",
  inputSchema: z.object({
    path: z.string().min(1),
    content: z.string(),
  }),
  approval: always(),
  async execute({ path, content }) {
    let oldContent = "";
    let isNew = false;
    try {
      oldContent = await readFile(path, "utf-8");
    } catch {
      isNew = true;
    }

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf-8");

    console.log("File written to:", path);

    if (isNew) {
      const lines = content.split("\n");
      const preview = lines
        .slice(0, 20)
        .map((l, i) => `+${l}`)
        .join("\n");
      return {
        path,
        status: "created",
        lines: lines.length,
        diff: `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${preview}${lines.length > 20 ? `\n... (${lines.length - 20} more lines)` : ""}`,
      };
    }

    if (oldContent === content) {
      return { path, status: "unchanged" };
    }

    return {
      path,
      status: "modified",
      diff: unifiedDiff(oldContent, content, path),
    };
  },
});
