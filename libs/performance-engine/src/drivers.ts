import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import autocannon from "autocannon";

import type {
  PerformanceMetrics,
  PerformanceScenarioInput,
} from "@engineering-observatory/shared-types";

export type LoadDriverResult = {
  toolVersion: string;
  achievedLoad: Record<string, number>;
  metrics: PerformanceMetrics;
  runnerMetrics: Record<string, number>;
  limitations: string[];
};

export interface LoadDriver {
  run(
    scenario: PerformanceScenarioInput,
    target: URL,
  ): Promise<LoadDriverResult>;
}

function runnerMeasurement(startCpu: NodeJS.CpuUsage, startMemory: number) {
  const cpu = process.cpuUsage(startCpu);
  return {
    cpuUserMs: cpu.user / 1_000,
    cpuSystemMs: cpu.system / 1_000,
    heapDeltaBytes: process.memoryUsage().heapUsed - startMemory,
  };
}

export class AutocannonDriver implements LoadDriver {
  async run(
    scenario: PerformanceScenarioInput,
    target: URL,
  ): Promise<LoadDriverResult> {
    if (scenario.tool !== "autocannon")
      throw new Error("driver_scenario_mismatch");
    const startCpu = process.cpuUsage();
    const startMemory = process.memoryUsage().heapUsed;
    const result = await autocannon({
      url: target.toString(),
      connections: scenario.load.connections,
      duration: scenario.load.durationSeconds,
      pipelining: scenario.load.pipelining,
      method: scenario.target.method,
      headers: scenario.target.headers,
      body: scenario.target.body ?? undefined,
    });
    const completedRequests = Number(result.requests.total ?? 0);
    const errors = Number(result.errors ?? 0) + Number(result.non2xx ?? 0);
    const timeouts = Number(result.timeouts ?? 0);
    const require = createRequire(import.meta.url);
    const version = (require("autocannon/package.json") as { version: string })
      .version;
    return {
      toolVersion: version,
      achievedLoad: {
        peakConnections: scenario.load.connections,
        completedRequests,
      },
      metrics: {
        requestsPerSecond: Number(result.requests.average ?? 0),
        completedRequests,
        latencyMs: {
          p50: Number(result.latency.p50 ?? 0),
          p95: Number(
            result.latency.p90 +
              (result.latency.p97_5 - result.latency.p90) * (5 / 7.5),
          ),
          p99: Number(result.latency.p99 ?? 0),
        },
        errorRatePercent:
          completedRequests === 0
            ? 100
            : ((errors + timeouts) / completedRequests) * 100,
        errors,
        timeouts,
        droppedWork: 0,
      },
      runnerMetrics: runnerMeasurement(startCpu, startMemory),
      limitations: [
        "Autocannon reports HTTP client observations; it does not identify the server-side root cause.",
        "Connections are not equivalent to real concurrent users.",
        "Autocannon p95 is interpolated from its measured p90 and p97.5 histogram values.",
      ],
    };
  }
}

type K6Summary = {
  metrics?: Record<string, { values?: Record<string, number> }>;
};

function metric(summary: K6Summary, name: string, value: string): number {
  return Number(summary.metrics?.[name]?.values?.[value] ?? 0);
}

async function spawnK6(args: string[], timeoutMs: number) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("k6", args, {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4_000) stderr += chunk.toString("utf8");
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("k6_timeout"));
    }, timeoutMs);
    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      reject(
        new Error(
          error.code === "ENOENT" ? "k6_unavailable" : "k6_spawn_failed",
        ),
      );
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`k6_failed:${stderr.slice(0, 300)}`));
    });
  });
}

export class K6Driver implements LoadDriver {
  async run(
    scenario: PerformanceScenarioInput,
    target: URL,
  ): Promise<LoadDriverResult> {
    if (scenario.tool !== "k6") throw new Error("driver_scenario_mismatch");
    const directory = await mkdtemp(path.join(tmpdir(), "observatory-k6-"));
    const scriptPath = path.join(directory, "scenario.js");
    const summaryPath = path.join(directory, "summary.json");
    const startCpu = process.cpuUsage();
    const startMemory = process.memoryUsage().heapUsed;
    try {
      const requestBody =
        scenario.target.body === null
          ? "null"
          : JSON.stringify(scenario.target.body);
      const script = `import http from 'k6/http';
export const options = { vus: ${scenario.load.virtualUsers}, duration: '${scenario.load.durationSeconds}s', maxRedirects: 0 };
export default function () {
  http.request(${JSON.stringify(scenario.target.method)}, ${JSON.stringify(target.toString())}, ${requestBody}, { headers: ${JSON.stringify(scenario.target.headers)}, redirects: 0 });
}
`;
      await writeFile(scriptPath, script, { mode: 0o600 });
      await spawnK6(
        ["run", "--summary-export", summaryPath, scriptPath],
        (scenario.load.durationSeconds + 20) * 1_000,
      );
      const summary = JSON.parse(
        await readFile(summaryPath, "utf8"),
      ) as K6Summary;
      const completedRequests = metric(summary, "http_reqs", "count");
      const failureRate = metric(summary, "http_req_failed", "rate");
      const version = await k6Version();
      return {
        toolVersion: version,
        achievedLoad: {
          peakVirtualUsers:
            metric(summary, "vus_max", "max") || scenario.load.virtualUsers,
          completedRequests,
        },
        metrics: {
          requestsPerSecond: metric(summary, "http_reqs", "rate"),
          completedRequests: Math.round(completedRequests),
          latencyMs: {
            p50: metric(summary, "http_req_duration", "med"),
            p95: metric(summary, "http_req_duration", "p(95)"),
            p99: metric(summary, "http_req_duration", "p(99)"),
          },
          errorRatePercent: failureRate * 100,
          errors: Math.round(failureRate * completedRequests),
          timeouts: 0,
          droppedWork: Math.round(
            metric(summary, "dropped_iterations", "count"),
          ),
        },
        runnerMetrics: runnerMeasurement(startCpu, startMemory),
        limitations: [
          "k6 virtual users model scripted activity and are not a count of real production users.",
          "Client-side results need server telemetry to confirm a bottleneck root cause.",
        ],
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

async function k6Version(): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("k6", ["version"], {
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.on(
      "data",
      (chunk: Buffer) => (output += chunk.toString("utf8")),
    );
    child.once("error", () => resolve("unknown"));
    child.once("exit", () => resolve(output.trim().slice(0, 120) || "unknown"));
  });
}
