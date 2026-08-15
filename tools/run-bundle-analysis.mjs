import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const artifactDirectory = path.join(workspaceRoot, "artifacts/bundle");

await mkdir(artifactDirectory, { recursive: true });
await run(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["nx", "run", "frontend:build", "--skip-nx-cache"],
  {
    ...process.env,
    ANALYZE_BUNDLE: "true",
  },
);

for (const filename of ["treemap.html", "raw-data.json", "report.md"]) {
  await access(path.join(artifactDirectory, filename));
}

console.log(`Bundle evidence written to ${artifactDirectory}`);

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} exited with ${code ?? `signal ${signal ?? "unknown"}`}`,
        ),
      );
    });
  });
}
