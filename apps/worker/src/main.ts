import { setTimeout as delay } from "node:timers/promises";

import {
  ArchitectureGraphStore,
  ObservatoryStore,
} from "@engineering-observatory/persistence";

import { AnalysisWorker } from "./analysis-worker";

function loadLocalEnvironment() {
  try {
    process.loadEnvFile?.(".env");
  } catch {
    // A local .env file is optional; deployment environments inject variables.
  }
}

export async function runWorker(signal?: AbortSignal) {
  const store = ObservatoryStore.fromEnvironment();
  const architectureStore = ArchitectureGraphStore.fromEnvironment();
  const worker = new AnalysisWorker(
    store,
    architectureStore,
    process.env.WORKER_ID ?? `analysis-${process.pid}`,
  );
  const pollMs = Number(process.env.WORKER_POLL_MS ?? 1_000);
  try {
    while (!signal?.aborted) {
      const processed = await worker.runOnce();
      if (!processed)
        await delay(pollMs, undefined, { signal }).catch(() => undefined);
    }
  } finally {
    await Promise.all([store.close(), architectureStore.close()]);
  }
}

async function main() {
  loadLocalEnvironment();
  const abort = new AbortController();
  process.once("SIGINT", () => abort.abort());
  process.once("SIGTERM", () => abort.abort());
  await runWorker(abort.signal);
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown worker failure";
    process.stderr.write(`Analysis worker stopped: ${message}\n`);
    process.exitCode = 1;
  });
}
