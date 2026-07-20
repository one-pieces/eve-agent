import { defineTool } from "eve/tools";
import { z } from "zod";
import { readFile } from "fs/promises";

export default defineTool({
  description: "Read a file from the local filesystem.",
  inputSchema: z.object({
    path: z.string().min(1),
  }),
  execute: async ({ path }) => {
    const content = await readFile(path, "utf-8");
    return { path, content };
  },
});