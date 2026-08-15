import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import type {
  AnalysisRecord,
  Finding,
  ProjectProfile,
  RepositoryRecord,
  Scorecard,
} from "@engineering-observatory/shared-types";

import type { ObservatoryReader } from "./api-client";
import { createObservatoryMcpServer } from "./server";

const repositoryId = "10000000-0000-4000-8000-000000000001";
const snapshotId = "20000000-0000-4000-8000-000000000001";
const analysisId = "30000000-0000-4000-8000-000000000001";
const createdAt = "2026-08-15T10:00:00.000Z";

const repository: RepositoryRecord = {
  id: repositoryId,
  displayName: "Checkout UI",
  sourceKind: "github",
  createdAt,
};
const analysis: AnalysisRecord = {
  id: analysisId,
  repositoryId,
  snapshotId,
  state: "completed",
  stage: null,
  ruleSetVersion: "rules-v1",
  scorePolicyVersion: "scores-v1",
  failureCode: null,
  warnings: [],
  createdAt,
  startedAt: createdAt,
  completedAt: createdAt,
};
const profile: ProjectProfile = {
  schemaVersion: "project-profile-v1",
  scannerVersion: "scanner-v1",
  snapshotId,
  repositoryRoot: ".",
  monorepo: false,
  workspaceTool: null,
  packageManager: "npm",
  projects: [],
  analyzedFileCount: 12,
  excludedFileCount: 3,
  analyzedBytes: 1234,
  architectureEdges: [],
  coverage: { completed: ["manifest"], skipped: [], warnings: [] },
};
const scorecards: Scorecard[] = [
  {
    dimension: "architecture",
    assessmentState: "assessed",
    score: 88,
    policyVersion: "scores-v1",
    deductions: [],
    coverage: { completedRules: ["component-size"], skippedRules: [] },
  },
];

function finding(severity: Finding["severity"], title: string): Finding {
  return {
    id: crypto.randomUUID(),
    fingerprint: `${severity}-finding-fingerprint-0001`,
    analyzerId: "frontend",
    analyzerVersion: "1.0.0",
    ruleId: "component-size",
    dimension: "architecture",
    severity,
    confidence: "high",
    title,
    description: `${title} description`,
    location: { path: "src/App.tsx", lineStart: 1, lineEnd: 20 },
    evidence: {
      kind: "ast",
      observed: "Component has 400 lines",
      values: { lines: 400 },
      limitations: [],
    },
    remediation: "Split cohesive responsibilities",
    scoreDeduction: 5,
  };
}

function reader(overrides: Partial<ObservatoryReader> = {}): ObservatoryReader {
  const unavailable = async (): Promise<never> => {
    throw new Error("Unexpected reader call");
  };
  return {
    listRepositories: unavailable,
    listAnalyses: unavailable,
    getAnalysis: unavailable,
    getProfile: unavailable,
    getFindings: unavailable,
    getScorecards: unavailable,
    getArchitecture: unavailable,
    getImpact: unavailable,
    ...overrides,
  };
}

async function connectedClient(observatoryReader: ObservatoryReader) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createObservatoryMcpServer(observatoryReader);
  const client = new Client({ name: "mcp-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

describe("Engineering Observatory MCP server", () => {
  it("exposes only bounded read-only evidence tools", async () => {
    const { client, server } = await connectedClient(
      reader({
        listRepositories: async () => [
          repository,
          { ...repository, id: "10000000-0000-4000-8000-000000000002" },
        ],
      }),
    );
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        "list_repositories",
        "list_analyses",
        "get_analysis_summary",
        "list_findings",
        "get_architecture_overview",
        "get_change_impact",
      ]);
      expect(
        listed.tools.every(
          (tool) =>
            tool.annotations?.readOnlyHint === true &&
            tool.annotations.destructiveHint === false &&
            tool.annotations.openWorldHint === false,
        ),
      ).toBe(true);

      const response = await client.callTool({
        name: "list_repositories",
        arguments: { limit: 1 },
      });
      expect(response.isError).not.toBe(true);
      expect(response.structuredContent).toEqual({
        repositories: [repository],
        total: 2,
        truncated: true,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("prioritizes existing deterministic findings without changing them", async () => {
    const findings = [
      finding("low", "Low finding"),
      finding("critical", "Critical finding"),
      finding("high", "High finding"),
    ];
    const { client, server } = await connectedClient(
      reader({
        getAnalysis: async () => analysis,
        getProfile: async () => profile,
        getScorecards: async () => scorecards,
        getFindings: async () => findings,
      }),
    );
    try {
      const response = await client.callTool({
        name: "get_analysis_summary",
        arguments: { analysisId, findingLimit: 2 },
      });
      expect(response.isError).not.toBe(true);
      const output = response.structuredContent as {
        findingCount: number;
        severityDistribution: Record<string, number>;
        topFindings: Finding[];
      };
      expect(output.findingCount).toBe(3);
      expect(output.severityDistribution).toMatchObject({
        critical: 1,
        high: 1,
        low: 1,
      });
      expect(output.topFindings.map((item) => item.title)).toEqual([
        "Critical finding",
        "High finding",
      ]);
      expect(findings.map((item) => item.title)).toEqual([
        "Low finding",
        "Critical finding",
        "High finding",
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
