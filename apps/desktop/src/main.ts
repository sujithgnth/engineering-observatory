import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer, request as createProxyRequest } from "node:http";
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import path from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  session,
} from "electron";
import { Pool } from "pg";

import {
  DesktopRuntimeDiscoverySchema,
  type DesktopRuntimeDiscovery,
} from "@engineering-observatory/shared-types";

import type { DesktopGithubStatus, DesktopRuntimeInfo } from "./contracts";
import { createDesktopRepositoryArchive } from "./local-repository";

const developmentRoot = path.resolve(__dirname, "../../..");
const defaultDatabaseUrl =
  "postgres://observatory:observatory@127.0.0.1:5432/observatory";
const selectedRepositories = new Map<string, { path: string; name: string }>();
let mainWindow: BrowserWindow | null = null;
let apiPort = 0;
let uiPort = 0;
let backendProcess: ChildProcess | null = null;
let workerProcess: ChildProcess | null = null;
let performanceProcess: ChildProcess | null = null;
let uiServer: ReturnType<typeof createServer> | null = null;
let stopping = false;

app.enableSandbox();

function loadDevelopmentEnvironment() {
  if (app.isPackaged) return;
  try {
    process.loadEnvFile?.(path.join(developmentRoot, ".env"));
  } catch {
    // Desktop development also supports environment injection.
  }
}

function servicePath(service: string) {
  return app.isPackaged
    ? path.join(process.resourcesPath, "services", service, "main.js")
    : path.join(developmentRoot, "dist/apps", service, "main.js");
}

function frontendPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "frontend")
    : path.join(developmentRoot, "dist/apps/frontend");
}

function migrationsPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "migrations")
    : path.join(developmentRoot, "libs/persistence/src/migrations");
}

function credentialPath() {
  return path.join(app.getPath("userData"), "credentials/github-token.bin");
}

function runtimeDiscoveryPath() {
  return path.join(
    homedir(),
    ".engineering-observatory",
    "desktop-runtime.json",
  );
}

async function writeRuntimeDiscovery() {
  const runtime: DesktopRuntimeDiscovery = {
    schemaVersion: "engineering-observatory-desktop-runtime-v1",
    pid: process.pid,
    apiBaseUrl: `http://127.0.0.1:${apiPort}/api/v1`,
    updatedAt: new Date().toISOString(),
  };
  const target = runtimeDiscoveryPath();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(runtime)}\n`, { mode: 0o600 });
}

async function readStoredGithubToken() {
  if (!(await secureCredentialStorageAvailable())) return null;
  try {
    const encrypted = await readFile(credentialPath());
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    if (decrypted.shouldReEncrypt) {
      await writeFile(
        credentialPath(),
        await safeStorage.encryptStringAsync(decrypted.result),
        { mode: 0o600 },
      );
    }
    return decrypted.result;
  } catch {
    return null;
  }
}

async function secureCredentialStorageAvailable() {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
  return !(
    process.platform === "linux" &&
    safeStorage.getSelectedStorageBackend() === "basic_text"
  );
}

async function githubStatus(): Promise<DesktopGithubStatus> {
  const stored = await readStoredGithubToken();
  return {
    configured: Boolean(stored || process.env.GITHUB_TOKEN),
    source: stored
      ? "secure-store"
      : process.env.GITHUB_TOKEN
        ? "environment"
        : "none",
    encryptionAvailable: await secureCredentialStorageAvailable(),
  };
}

async function migrateDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? defaultDatabaseUrl,
    max: 2,
  });
  try {
    const files = (await readdir(migrationsPath()))
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort();
    for (const file of files) {
      await pool.query(
        await readFile(path.join(migrationsPath(), file), "utf8"),
      );
    }
  } finally {
    await pool.end();
  }
}

function serviceEnvironment(extra: NodeJS.ProcessEnv = {}) {
  return {
    ...process.env,
    ...extra,
    NODE_ENV: "production",
    DATABASE_URL: process.env.DATABASE_URL ?? defaultDatabaseUrl,
    ARTIFACT_ROOT: path.join(app.getPath("userData"), "artifacts"),
    ELECTRON_RUN_AS_NODE: "1",
  };
}

function spawnService(
  service: string,
  extraEnvironment: NodeJS.ProcessEnv = {},
) {
  const child = spawn(process.execPath, [servicePath(service)], {
    cwd: app.getPath("userData"),
    env: serviceEnvironment(extraEnvironment),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) =>
    process.stdout.write(`[${service}] ${String(chunk)}`),
  );
  child.stderr?.on("data", (chunk) =>
    process.stderr.write(`[${service}] ${String(chunk)}`),
  );
  child.on("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      process.stderr.write(
        `${service} exited with ${code ?? `signal ${signal ?? "unknown"}`}\n`,
      );
    }
  });
  return child;
}

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitForBackend(child: ChildProcess) {
  const url = `http://127.0.0.1:${apiPort}/api/v1/health/ready`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error("The desktop API stopped during startup");
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The API or PostgreSQL is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    "The desktop API could not reach PostgreSQL. Start the configured database and try again.",
  );
}

async function startBackend() {
  const token = (await readStoredGithubToken()) ?? process.env.GITHUB_TOKEN;
  const child = spawnService("backend", {
    PORT: String(apiPort),
    ...(token ? { GITHUB_TOKEN: token } : {}),
  });
  backendProcess = child;
  await waitForBackend(child);
}

async function stopProcess(child: ChildProcess | null) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function restartBackend() {
  await stopProcess(backendProcess);
  backendProcess = null;
  await startBackend();
}

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function securityHeaders() {
  return {
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

async function serveFrontend(
  requestPath: string,
  method: string | undefined,
  response: ServerResponse,
) {
  const root = path.resolve(frontendPath());
  let pathname: string;
  try {
    pathname = decodeURIComponent(
      new URL(requestPath, "http://desktop").pathname,
    );
  } catch {
    response.writeHead(400, securityHeaders()).end("Bad request");
    return;
  }
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  let candidate = path.resolve(root, requested);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    response.writeHead(403, securityHeaders()).end("Forbidden");
    return;
  }
  try {
    if (!(await stat(candidate)).isFile()) throw new Error("not_file");
  } catch {
    candidate = path.join(root, "index.html");
  }
  const headers = {
    ...securityHeaders(),
    "Content-Type":
      mimeTypes[path.extname(candidate)] ?? "application/octet-stream",
  };
  response.writeHead(200, headers);
  if (method === "HEAD") response.end();
  else createReadStream(candidate).pipe(response);
}

async function startUiServer() {
  uiServer = createServer((request, response) => {
    const requestPath = request.url ?? "/";
    if (requestPath.startsWith("/api/")) {
      const proxy = createProxyRequest(
        {
          hostname: "127.0.0.1",
          port: apiPort,
          path: requestPath,
          method: request.method,
          headers: { ...request.headers, host: `127.0.0.1:${apiPort}` },
        },
        (proxyResponse) => {
          response.writeHead(
            proxyResponse.statusCode ?? 502,
            proxyResponse.headers,
          );
          proxyResponse.pipe(response);
        },
      );
      proxy.on("error", () => {
        if (!response.headersSent) response.writeHead(502, securityHeaders());
        response.end("Desktop API unavailable");
      });
      request.pipe(proxy);
      return;
    }
    void serveFrontend(requestPath, request.method, response).catch(() => {
      if (!response.headersSent) response.writeHead(500, securityHeaders());
      response.end("Desktop UI unavailable");
    });
  });
  await new Promise<void>((resolve, reject) => {
    uiServer!.once("error", reject);
    uiServer!.listen(0, "127.0.0.1", resolve);
  });
  uiPort = (uiServer.address() as AddressInfo).port;
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent) {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
    throw new Error("Untrusted desktop IPC sender");
  }
  const expected = `http://127.0.0.1:${uiPort}`;
  if (!event.senderFrame?.url.startsWith(expected)) {
    throw new Error("Untrusted desktop IPC frame");
  }
}

async function uploadSelectedRepository(
  selectionId: string,
  displayName: string,
) {
  const selected = selectedRepositories.get(selectionId);
  if (!selected) throw new Error("Choose the project folder again");
  const archive = await createDesktopRepositoryArchive(selected.path);
  try {
    const form = new FormData();
    form.set("displayName", displayName.trim() || selected.name);
    form.set(
      "archive",
      new Blob([await readFile(archive.archivePath)]),
      `${selected.name}.tar.gz`,
    );
    const response = await fetch(
      `http://127.0.0.1:${apiPort}/api/v1/repositories/archive`,
      { method: "POST", body: form },
    );
    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as {
        detail?: string;
        title?: string;
      };
      throw new Error(
        problem.detail ??
          problem.title ??
          `Repository upload failed with ${response.status}`,
      );
    }
    selectedRepositories.delete(selectionId);
    return response.json();
  } finally {
    await rm(archive.temporaryDirectory, { recursive: true, force: true });
  }
}

function registerDesktopIpc() {
  ipcMain.handle("desktop:choose-repository", async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Choose a repository to analyze",
      buttonLabel: "Analyze this folder",
      properties: ["openDirectory"],
    });
    const selectedPath = result.filePaths[0];
    if (result.canceled || !selectedPath) return null;
    const id = randomUUID();
    const name = path.basename(selectedPath);
    selectedRepositories.set(id, { path: selectedPath, name });
    return { id, name };
  });
  ipcMain.handle(
    "desktop:upload-repository",
    async (event, selectionId: unknown, displayName: unknown) => {
      assertTrustedSender(event);
      if (typeof selectionId !== "string" || selectionId.length > 100) {
        throw new Error("Invalid repository selection");
      }
      if (typeof displayName !== "string" || displayName.length > 200) {
        throw new Error("Invalid project name");
      }
      return uploadSelectedRepository(selectionId, displayName);
    },
  );
  ipcMain.handle("desktop:github-status", async (event) => {
    assertTrustedSender(event);
    return githubStatus();
  });
  ipcMain.handle(
    "desktop:configure-github-token",
    async (event, token: unknown) => {
      assertTrustedSender(event);
      if (
        typeof token !== "string" ||
        token.length < 20 ||
        token.length > 500
      ) {
        throw new Error("Enter a valid GitHub access token");
      }
      if (!(await secureCredentialStorageAvailable())) {
        throw new Error(
          "Secure credential storage is unavailable on this system; use GITHUB_TOKEN in the launch environment",
        );
      }
      await mkdir(path.dirname(credentialPath()), { recursive: true });
      await writeFile(
        credentialPath(),
        await safeStorage.encryptStringAsync(token),
        { mode: 0o600 },
      );
      await restartBackend();
      return githubStatus();
    },
  );
  ipcMain.handle("desktop:clear-github-token", async (event) => {
    assertTrustedSender(event);
    await rm(credentialPath(), { force: true });
    await restartBackend();
    return githubStatus();
  });
  ipcMain.handle("desktop:runtime-info", (event): DesktopRuntimeInfo => {
    assertTrustedSender(event);
    return {
      apiOrigin: `http://127.0.0.1:${apiPort}`,
      platform: process.platform,
      version: app.getVersion(),
    };
  });
}

async function createWindow() {
  const preload = path.join(__dirname, "preload.cjs");
  const rendererErrors: string[] = [];
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 680,
    backgroundColor: "#030718",
    title: "Engineering Observatory",
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
      webSecurity: true,
    },
  });
  const allowedOrigin = `http://127.0.0.1:${uiPort}`;
  mainWindow.webContents.on("console-message", (details) => {
    if (details.level === "error") {
      rendererErrors.push(
        `${details.sourceId}:${details.lineNumber} ${details.message}`,
      );
    }
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(allowedOrigin)) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  await mainWindow.loadURL(`${allowedOrigin}/`);
  if (process.env.DESKTOP_SMOKE_TEST === "1") {
    const rendered = (await mainWindow.webContents.executeJavaScript(
      `(() => ({
        title: document.title,
        hasBridge: Boolean(window.engineeringObservatory),
        hasSourceControl: document.body.textContent?.includes("GitHub URL") === true
      }))()`,
      true,
    )) as {
      title: string;
      hasBridge: boolean;
      hasSourceControl: boolean;
    };
    if (
      rendered.title !== "Engineering Observatory" ||
      !rendered.hasBridge ||
      !rendered.hasSourceControl ||
      rendererErrors.length > 0
    ) {
      throw new Error(
        `Desktop renderer smoke failed: ${JSON.stringify({ rendered, rendererErrors })}`,
      );
    }
    const runtime = DesktopRuntimeDiscoverySchema.parse(
      JSON.parse(await readFile(runtimeDiscoveryPath(), "utf8")),
    );
    if (
      runtime.pid !== process.pid ||
      runtime.apiBaseUrl !== `http://127.0.0.1:${apiPort}/api/v1`
    ) {
      throw new Error(
        "Desktop MCP runtime discovery does not match the active API",
      );
    }
    process.stdout.write(
      `DESKTOP_SMOKE_RENDERER ${JSON.stringify(rendered)}\n`,
    );
    process.stdout.write("DESKTOP_SMOKE_READY\n");
    setTimeout(() => app.quit(), 250);
  }
}

async function bootstrap() {
  loadDevelopmentEnvironment();
  await migrateDatabase();
  apiPort = await freePort();
  await startBackend();
  await writeRuntimeDiscovery();
  workerProcess = spawnService("worker");
  performanceProcess = spawnService("performance-runner");
  await startUiServer();
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  registerDesktopIpc();
  await createWindow();
}

async function shutdown() {
  stopping = true;
  ipcMain.removeHandler("desktop:choose-repository");
  ipcMain.removeHandler("desktop:upload-repository");
  ipcMain.removeHandler("desktop:github-status");
  ipcMain.removeHandler("desktop:configure-github-token");
  ipcMain.removeHandler("desktop:clear-github-token");
  ipcMain.removeHandler("desktop:runtime-info");
  await Promise.all([
    stopProcess(backendProcess),
    stopProcess(workerProcess),
    stopProcess(performanceProcess),
    rm(runtimeDiscoveryPath(), { force: true }),
    uiServer
      ? new Promise<void>((resolve) => uiServer!.close(() => resolve()))
      : Promise.resolve(),
  ]);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  app.on("before-quit", (event) => {
    if (stopping) return;
    event.preventDefault();
    void shutdown().finally(() => app.quit());
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
  void app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown desktop startup error";
      dialog.showErrorBox("Engineering Observatory could not start", message);
      stopping = true;
      void shutdown().finally(() => app.quit());
    });
}
