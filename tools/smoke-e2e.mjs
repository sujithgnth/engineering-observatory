import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as tar from "tar";

const apiOrigin = process.env.OBSERVATORY_API_ORIGIN ?? "http://127.0.0.1:3333";
const fixtureRoot = path.resolve("fixtures/repositories/risky-fullstack");
const temporaryDirectory = await mkdtemp(
  path.join(tmpdir(), "observatory-smoke-"),
);
const archivePath = path.join(temporaryDirectory, "risky-fullstack.tgz");

async function request(route, init) {
  const response = await fetch(new URL(`/api/v1${route}`, apiOrigin), init);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `smoke_request_failed:${response.status}:${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function waitFor(route, terminalStates, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await request(route);
    if (terminalStates.includes(value.state)) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`smoke_timeout:${route}`);
}

try {
  await tar.create(
    { cwd: fixtureRoot, file: archivePath, gzip: true, portable: true },
    ["."],
  );
  const form = new FormData();
  form.set("displayName", "Automated risk fixture");
  form.set(
    "archive",
    new Blob([await readFile(archivePath)]),
    "risky-fullstack.tgz",
  );
  const source = await request("/repositories/archive", {
    method: "POST",
    body: form,
  });
  const queued = await request("/analyses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ snapshotId: source.snapshot.id }),
  });
  const analysis = await waitFor(`/analyses/${queued.analysisId}`, [
    "completed",
    "completed_with_warnings",
    "failed",
  ]);
  if (analysis.state === "failed") {
    throw new Error(`smoke_analysis_failed:${analysis.failureCode}`);
  }
  let dashboard = await request(`/analyses/${analysis.id}/dashboard`);
  const serialized = JSON.stringify(dashboard);
  if (serialized.includes("observatory-canary-not-a-real-key-12345")) {
    throw new Error("smoke_secret_redaction_failed");
  }
  if (dashboard.findings.length < 8) {
    throw new Error("smoke_expected_findings_missing");
  }
  if (dashboard.overallScore !== null) {
    throw new Error("smoke_overall_score_must_wait_for_measurement");
  }
  const architecture = await request(`/analyses/${analysis.id}/architecture`);
  if (
    architecture.schemaVersion !== "frontend-architecture-v1" ||
    architecture.files.length === 0 ||
    architecture.nodes.length === 0
  ) {
    throw new Error("smoke_architecture_graph_missing");
  }
  const impactNode = architecture.nodes.find((node) =>
    ["component", "page", "hook", "service"].includes(node.kind),
  );
  if (!impactNode) throw new Error("smoke_impact_node_missing");
  const impact = await request(
    `/analyses/${analysis.id}/impact?${new URLSearchParams({ nodeId: impactNode.id })}`,
  );
  if (!impact.selectedNodeIds.includes(impactNode.id)) {
    throw new Error("smoke_change_impact_missing");
  }
  const previewFile = architecture.files.find((file) => !file.test);
  if (!previewFile) throw new Error("smoke_source_file_missing");
  const sourcePreview = await request(
    `/analyses/${analysis.id}/source?${new URLSearchParams({ path: previewFile.path })}`,
  );
  if (
    sourcePreview.path !== previewFile.path ||
    sourcePreview.contentHash !== previewFile.contentHash
  ) {
    throw new Error("smoke_source_preview_mismatch");
  }

  if (process.env.RUN_PERFORMANCE_SMOKE === "true") {
    const run = await request("/performance-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: source.repository.id,
        analysisId: analysis.id,
        name: "Automated controlled measurement",
        tool: "autocannon",
        target: {
          origin: apiOrigin,
          path: "/api/v1/health/live",
          method: "GET",
          headers: {},
          body: null,
        },
        load: { connections: 5, durationSeconds: 1, pipelining: 1 },
        thresholds: { p95LatencyMs: 100, errorRatePercent: 1 },
        authorizationConfirmed: true,
      }),
    });
    const measurement = await waitFor(`/performance-runs/${run.id}`, [
      "completed",
      "failed",
      "rejected",
    ]);
    if (measurement.state !== "completed" || !measurement.metrics) {
      throw new Error(
        `smoke_performance_failed:${measurement.failureCode ?? measurement.state}`,
      );
    }
    dashboard = await request(`/analyses/${analysis.id}/dashboard`);
    if (dashboard.overallScore === null) {
      throw new Error("smoke_health_report_not_created");
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        analysisId: analysis.id,
        state: analysis.state,
        profile: dashboard.profile?.projects[0]?.kind ?? "unknown",
        findings: dashboard.findings.length,
        overallScore: dashboard.overallScore,
        aiAvailable: dashboard.aiAvailable,
        architecture: {
          files: architecture.files.length,
          nodes: architecture.nodes.length,
          edges: architecture.edges.length,
          impactNodes: impact.counts.totalNodes,
        },
        performance: dashboard.latestPerformanceRun?.metrics ?? null,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
