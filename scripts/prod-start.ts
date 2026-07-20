/**
 * Production start script.
 *
 * Starts the built eve server and Next.js production server together.
 * The eve server must be built first via `eve build`.
 *
 * Usage: tsx scripts/prod-start.ts
 *
 * Environment variables:
 *   EVE_NEXT_PRODUCTION_PORT  — eve server port (default: 4274)
 *   NEXT_PORT                 — Next.js port (default: 3000)
 */

import { spawn } from "node:child_process";
import { once } from "node:events";

const EVE_PORT = parseInt(process.env.EVE_NEXT_PRODUCTION_PORT || "4274", 10);
const NEXT_PORT = parseInt(process.env.NEXT_PORT || "3000", 10);

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server at ${url} did not become healthy within ${timeoutMs}ms`);
}

async function main() {
  // 1. Start eve production server
  console.log(`Starting eve server on port ${EVE_PORT}...`);
  const eve = spawn("npx", ["eve", "start", "--port", String(EVE_PORT)], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, PORT: String(EVE_PORT) },
    shell: true,
  });

  // 2. Wait for eve to be healthy
  await waitForServer(`http://127.0.0.1:${EVE_PORT}/eve/v1/health`);
  console.log("Eve server is ready.");

  // 3. Start Next.js
  console.log("Starting Next.js production server...");
  const next = spawn("npx", ["next", "start", "--port", String(NEXT_PORT)], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env },
    shell: true,
  });

  // 4. Handle shutdown
  const cleanup = () => {
    eve.kill("SIGTERM");
    next.kill("SIGTERM");
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // 5. Wait for either process to exit
  const [code, signal] = await Promise.race([
    once(eve, "exit").then(([c, s]) => ["eve", c, s]),
    once(next, "exit").then(([c, s]) => ["next", c, s]),
  ]);

  console.log(`${code[0]} exited (code=${code[1]}, signal=${code[2]})`);
  cleanup();
  process.exit(code[1] ?? 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
