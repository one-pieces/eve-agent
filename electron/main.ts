import { app, BrowserWindow, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const IS_DEV = !app.isPackaged;
const EVE_PORT = parseInt(process.env.EVE_NEXT_PRODUCTION_PORT ?? "4274", 10);
const NEXT_PORT = parseInt(process.env.NEXT_PORT ?? "3000", 10);

const children: ChildProcess[] = [];
let mainWindow: BrowserWindow | null = null;

async function waitForServer(url: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function startProductionServers(): Promise<void> {
  const appDir = join(process.resourcesPath, "app");
  const binDir = join(appDir, "node_modules", ".bin");

  const eve = spawn(
    join(binDir, "eve"),
    ["start", "--port", String(EVE_PORT)],
    {
      cwd: appDir,
      env: { ...process.env, PORT: String(EVE_PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(eve);

  await waitForServer(`http://127.0.0.1:${EVE_PORT}/eve/v1/health`);

  const next = spawn(
    join(binDir, "next"),
    ["start", "--port", String(NEXT_PORT)],
    {
      cwd: appDir,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(next);

  await waitForServer(`http://127.0.0.1:${NEXT_PORT}`);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 12 },
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${NEXT_PORT}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://localhost:${NEXT_PORT}`)) {
      return { action: "allow" };
    }
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function cleanup(): void {
  for (const proc of children) {
    proc.kill("SIGTERM");
  }
}

app.on("before-quit", cleanup);

app
  .whenReady()
  .then(async () => {
    if (!IS_DEV) {
      await startProductionServers();
    }

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((err: unknown) => {
    console.error("Failed to start Electron app:", err);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    cleanup();
    app.quit();
  }
});
