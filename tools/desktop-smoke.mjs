import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const executable = path.join(
  workspaceRoot,
  "node_modules/.bin",
  process.platform === "win32" ? "electron.cmd" : "electron",
);

await run(process.platform === "win32" ? "npm.cmd" : "npm", [
  "run",
  "desktop:prepare",
]);
await run(executable, ["."], {
  ...process.env,
  DESKTOP_SMOKE_TEST: "1",
});
const runtimeDiscovery = path.join(
  homedir(),
  ".engineering-observatory",
  "desktop-runtime.json",
);
try {
  await access(runtimeDiscovery);
  throw new Error("Electron left a stale MCP runtime discovery file");
} catch (error) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    error.code !== "ENOENT"
  ) {
    throw error;
  }
}

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out`));
    }, 90_000);
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stderr.write(text);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(
          new Error(
            `${command} exited with ${code ?? `signal ${signal ?? "unknown"}`}`,
          ),
        );
        return;
      }
      if (command === executable && !output.includes("DESKTOP_SMOKE_READY")) {
        reject(new Error("Electron exited without reaching the ready state"));
        return;
      }
      resolve();
    });
  });
}
