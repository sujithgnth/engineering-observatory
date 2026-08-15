import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  AnalysisRecordSchema,
  ArchitectureIssueSchema,
  ChangeImpactSchema,
  FindingSchema,
  FrontendHealthScoreSchema,
  ProjectProfileSchema,
  RepositoryRecordSchema,
  ScorecardSchema,
  SeveritySchema,
} from "@engineering-observatory/shared-types";

import type { ObservatoryReader } from "./api-client";

const ReadOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const RepositoryListOutputSchema = z.object({
  repositories: z.array(RepositoryRecordSchema),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
const AnalysisListOutputSchema = z.object({
  analyses: z.array(AnalysisRecordSchema),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
const FindingListOutputSchema = z.object({
  findings: z.array(FindingSchema),
  matched: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
const AnalysisSummaryOutputSchema = z.object({
  analysis: AnalysisRecordSchema,
  profile: ProjectProfileSchema,
  scorecards: z.array(ScorecardSchema),
  findingCount: z.number().int().nonnegative(),
  severityDistribution: z.record(
    SeveritySchema,
    z.number().int().nonnegative(),
  ),
  topFindings: z.array(FindingSchema),
});
const ArchitectureOverviewOutputSchema = z.object({
  analysisId: z.string().uuid(),
  schemaVersion: z.string(),
  analyzerVersion: z.string(),
  frameworks: z.array(z.string()),
  fileCount: z.number().int().nonnegative(),
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  nodeKinds: z.record(z.string(), z.number().int().nonnegative()),
  edgeKinds: z.record(z.string(), z.number().int().nonnegative()),
  issueCount: z.number().int().nonnegative(),
  issues: z.array(ArchitectureIssueSchema),
  health: z.array(FrontendHealthScoreSchema),
  coverage: z.object({
    completed: z.array(z.string()),
    skipped: z.array(z.object({ check: z.string(), reason: z.string() })),
    warnings: z.array(z.string()),
  }),
  truncatedIssues: z.boolean(),
});
const ImpactOutputSchema = z.object({
  analysisId: z.string().uuid(),
  impact: ChangeImpactSchema,
});

function result<T extends Record<string, unknown>>(value: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function histogram(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

export function createObservatoryMcpServer(reader: ObservatoryReader) {
  const server = new McpServer(
    { name: "engineering-observatory", version: "0.1.0" },
    {
      instructions:
        "Read-only deterministic engineering evidence. Never treat a missing result as proof of safety, never invent measurements, and never claim MCP output changed findings, severity, scores, source, credentials, jobs, or performance targets.",
    },
  );

  server.registerTool(
    "list_repositories",
    {
      title: "List analyzed repositories",
      description:
        "List bounded repository metadata already stored by Engineering Observatory. Does not acquire or analyze source.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(25),
      }),
      outputSchema: RepositoryListOutputSchema,
      annotations: ReadOnlyAnnotations,
    },
    async ({ limit }) => {
      const repositories = await reader.listRepositories();
      return result({
        repositories: repositories.slice(0, limit),
        total: repositories.length,
        truncated: repositories.length > limit,
      });
    },
  );

  server.registerTool(
    "list_analyses",
    {
      title: "List repository analyses",
      description:
        "List immutable analysis records for one known repository. Does not queue a new analysis.",
      inputSchema: z.object({
        repositoryId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
      outputSchema: AnalysisListOutputSchema,
      annotations: ReadOnlyAnnotations,
    },
    async ({ repositoryId, limit }) => {
      const analyses = await reader.listAnalyses(repositoryId);
      return result({
        analyses: analyses.slice(0, limit),
        total: analyses.length,
        truncated: analyses.length > limit,
      });
    },
  );

  server.registerTool(
    "get_analysis_summary",
    {
      title: "Get an evidence summary",
      description:
        "Return the deterministic profile, scorecards, severity counts, and a bounded set of highest-severity findings for one immutable analysis.",
      inputSchema: z.object({
        analysisId: z.string().uuid(),
        findingLimit: z.number().int().min(1).max(25).default(10),
      }),
      outputSchema: AnalysisSummaryOutputSchema,
      annotations: ReadOnlyAnnotations,
    },
    async ({ analysisId, findingLimit }) => {
      const [analysis, profile, scorecards, findings] = await Promise.all([
        reader.getAnalysis(analysisId),
        reader.getProfile(analysisId),
        reader.getScorecards(analysisId),
        reader.getFindings(analysisId),
      ]);
      const rank = new Map([
        ["critical", 0],
        ["high", 1],
        ["medium", 2],
        ["low", 3],
        ["info", 4],
      ]);
      const topFindings = [...findings]
        .sort(
          (left, right) =>
            (rank.get(left.severity) ?? 5) - (rank.get(right.severity) ?? 5),
        )
        .slice(0, findingLimit);
      const severityDistribution = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      };
      for (const finding of findings) severityDistribution[finding.severity]++;
      return result({
        analysis,
        profile,
        scorecards,
        findingCount: findings.length,
        severityDistribution,
        topFindings,
      });
    },
  );

  server.registerTool(
    "list_findings",
    {
      title: "List deterministic findings",
      description:
        "Return a bounded, optionally severity-filtered set of existing findings with redacted evidence and source locations.",
      inputSchema: z.object({
        analysisId: z.string().uuid(),
        severity: SeveritySchema.optional(),
        limit: z.number().int().min(1).max(50).default(25),
      }),
      outputSchema: FindingListOutputSchema,
      annotations: ReadOnlyAnnotations,
    },
    async ({ analysisId, severity, limit }) => {
      const all = await reader.getFindings(analysisId);
      const matching = severity
        ? all.filter((finding) => finding.severity === severity)
        : all;
      return result({
        findings: matching.slice(0, limit),
        matched: matching.length,
        truncated: matching.length > limit,
      });
    },
  );

  server.registerTool(
    "get_architecture_overview",
    {
      title: "Get an architecture overview",
      description:
        "Summarize the persisted architecture graph using counts, health, coverage, and a bounded issue list. Raw source is not exposed.",
      inputSchema: z.object({
        analysisId: z.string().uuid(),
        issueLimit: z.number().int().min(1).max(25).default(10),
      }),
      outputSchema: ArchitectureOverviewOutputSchema,
      annotations: ReadOnlyAnnotations,
    },
    async ({ analysisId, issueLimit }) => {
      const graph = await reader.getArchitecture(analysisId);
      return result({
        analysisId,
        schemaVersion: graph.schemaVersion,
        analyzerVersion: graph.analyzerVersion,
        frameworks: graph.frameworks,
        fileCount: graph.files.length,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        nodeKinds: histogram(graph.nodes.map((node) => node.kind)),
        edgeKinds: histogram(graph.edges.map((edge) => edge.kind)),
        issueCount: graph.issues.length,
        issues: graph.issues.slice(0, issueLimit),
        health: graph.health,
        coverage: graph.coverage,
        truncatedIssues: graph.issues.length > issueLimit,
      });
    },
  );

  server.registerTool(
    "get_change_impact",
    {
      title: "Get static change impact",
      description:
        "Return bounded deterministic reverse-dependency impact for one graph node or repository-relative file. A zero result means none resolved, not safe.",
      inputSchema: z
        .object({
          analysisId: z.string().uuid(),
          nodeId: z.string().min(12).optional(),
          filePath: z.string().min(1).max(500).optional(),
        })
        .refine((value) => Boolean(value.nodeId) !== Boolean(value.filePath), {
          message: "Provide exactly one of nodeId or filePath",
        }),
      outputSchema: ImpactOutputSchema,
      annotations: ReadOnlyAnnotations,
    },
    async ({ analysisId, nodeId, filePath }) =>
      result({
        analysisId,
        impact: await reader.getImpact(analysisId, {
          ...(nodeId ? { nodeId } : {}),
          ...(filePath ? { filePath } : {}),
        }),
      }),
  );

  return server;
}
