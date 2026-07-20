import { defineTool } from "eve/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export default defineTool({
  description:
    "Run a shell command on the local host filesystem (outside sandbox). Use for file listing, searching, etc.",
  inputSchema: z.object({
    command: z.string().min(1),
    cwd: z.string().optional(),
  }),
  async execute({ command, cwd }) {
    const MAX_BUFFER = 50 * 1024 * 1024; // 50 MB
    const MAX_OUTPUT = 100_000; // chars returned to the model
    const TIMEOUT_MS = 60_000; // 60 seconds
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: cwd ?? process.env.HOME,
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
      });
      return {
        stdout:
          stdout.length > MAX_OUTPUT
            ? stdout.slice(0, MAX_OUTPUT) +
              `\n...[truncated – ${stdout.length} total chars]`
            : stdout,
        stderr,
      };
    } catch (err: any) {
      if (err?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        const partial = (err.stdout ?? "").slice(0, MAX_OUTPUT);
        return {
          stdout:
            partial + `\n...[truncated – output exceeded ${MAX_BUFFER} bytes]`,
          stderr: err.stderr ?? "",
        };
      }
      if (err?.killed && err?.signal === "SIGTERM") {
        throw new Error(
          `Command timed out after ${TIMEOUT_MS / 1000}s: ${command}\n` +
            `Consider using a more specific search path or increasing the timeout.`,
        );
      }
      throw err;
    }
  },
});
