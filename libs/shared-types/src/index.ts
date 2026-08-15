import { z } from "zod";

export const SeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);
export type Severity = z.infer<typeof SeveritySchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const DimensionSchema = z.enum([
  "architecture",
  "security",
  "performance",
  "scalability",
]);
export type Dimension = z.infer<typeof DimensionSchema>;

export const AssessmentStateSchema = z.enum([
  "assessed",
  "partial",
  "not_measured",
  "not_applicable",
  "unavailable",
]);
export type AssessmentState = z.infer<typeof AssessmentStateSchema>;

export const SourceKindSchema = z.enum(["archive", "github"]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const AnalysisStateSchema = z.enum([
  "queued",
  "acquiring",
  "profiling",
  "analyzing",
  "scoring",
  "completed",
  "completed_with_warnings",
  "cancelled",
  "failed",
]);
export type AnalysisState = z.infer<typeof AnalysisStateSchema>;

export const JobStateSchema = z.enum([
  "queued",
  "leased",
  "completed",
  "failed",
  "cancelled",
]);
export type JobState = z.infer<typeof JobStateSchema>;

export const PerformanceRunStateSchema = z.enum([
  "queued",
  "validating_target",
  "running",
  "processing_results",
  "completed",
  "cancelled",
  "rejected",
  "failed",
]);
export type PerformanceRunState = z.infer<typeof PerformanceRunStateSchema>;

export const EvidenceSchema = z.object({
  kind: z.enum([
    "ast",
    "manifest",
    "configuration",
    "text-pattern",
    "advisory",
    "measurement",
  ]),
  observed: z.string().min(1),
  excerpt: z.string().max(500).optional(),
  values: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .default({}),
  limitations: z.array(z.string()).default([]),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const SourceLocationSchema = z.object({
  path: z.string().min(1),
  lineStart: z.number().int().positive().nullable(),
  lineEnd: z.number().int().positive().nullable(),
});
export type SourceLocation = z.infer<typeof SourceLocationSchema>;

export const FindingSchema = z.object({
  id: z.string().uuid().optional(),
  fingerprint: z.string().min(16),
  analyzerId: z.string().min(1),
  analyzerVersion: z.string().min(1),
  ruleId: z.string().min(1),
  dimension: DimensionSchema,
  severity: SeveritySchema,
  confidence: ConfidenceSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  location: SourceLocationSchema,
  evidence: EvidenceSchema,
  remediation: z.string().min(1),
  scoreDeduction: z.number().min(0).max(100).nullable(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const FrameworkSignalSchema = z.object({
  name: z.enum(["react", "angular", "typescript", "node", "nestjs"]),
  version: z.string().nullable(),
  evidencePath: z.string(),
  confidence: ConfidenceSchema,
});
export type FrameworkSignal = z.infer<typeof FrameworkSignalSchema>;

export const DatabaseSignalSchema = z.object({
  name: z.enum(["mongodb", "postgresql"]),
  adapter: z.string().nullable(),
  evidencePath: z.string(),
  confidence: ConfidenceSchema,
});
export type DatabaseSignal = z.infer<typeof DatabaseSignalSchema>;

export const ProjectDescriptorSchema = z.object({
  name: z.string(),
  root: z.string(),
  kind: z.enum(["frontend", "backend", "fullstack", "library", "unknown"]),
  frameworks: z.array(FrameworkSignalSchema),
  databases: z.array(DatabaseSignalSchema),
  dependencies: z.record(z.string(), z.string()),
  scripts: z.array(z.string()),
  sourceFileCount: z.number().int().nonnegative(),
});
export type ProjectDescriptor = z.infer<typeof ProjectDescriptorSchema>;

export const ProjectProfileSchema = z.object({
  schemaVersion: z.literal("project-profile-v1"),
  scannerVersion: z.string(),
  snapshotId: z.string().uuid(),
  repositoryRoot: z.string(),
  monorepo: z.boolean(),
  workspaceTool: z.string().nullable(),
  packageManager: z.enum(["npm", "pnpm", "yarn", "bun", "unknown"]),
  projects: z.array(ProjectDescriptorSchema),
  analyzedFileCount: z.number().int().nonnegative(),
  excludedFileCount: z.number().int().nonnegative(),
  analyzedBytes: z.number().int().nonnegative(),
  architectureEdges: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      kind: z.enum(["workspace", "source-import"]),
    }),
  ),
  coverage: z.object({
    completed: z.array(z.string()),
    skipped: z.array(z.object({ check: z.string(), reason: z.string() })),
    warnings: z.array(z.string()),
  }),
});
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;

export const ArchitectureNodeKindSchema = z.enum([
  "component",
  "page",
  "hook",
  "service",
  "store",
  "reducer",
  "selector",
  "action",
  "effect",
  "api-client",
  "route",
  "test",
  "utility",
  "module",
]);
export type ArchitectureNodeKind = z.infer<typeof ArchitectureNodeKindSchema>;

export const ArchitectureEdgeKindSchema = z.enum([
  "imports",
  "renders",
  "injects",
  "calls",
  "dispatches",
  "subscribes",
  "reads-state",
  "writes-state",
  "routes-to",
  "tested-by",
]);
export type ArchitectureEdgeKind = z.infer<typeof ArchitectureEdgeKindSchema>;

export const FrontendFrameworkSchema = z.enum([
  "react",
  "angular",
  "nextjs",
  "typescript",
]);
export type FrontendFramework = z.infer<typeof FrontendFrameworkSchema>;

const ArchitectureMetadataScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
export const ArchitectureMetadataSchema = z.record(
  z.string(),
  z.union([
    ArchitectureMetadataScalarSchema,
    z.array(ArchitectureMetadataScalarSchema),
  ]),
);
export type ArchitectureMetadata = z.infer<typeof ArchitectureMetadataSchema>;

export const ArchitectureFileSchema = z.object({
  path: z.string().min(1),
  language: z.enum(["typescript", "tsx", "javascript", "jsx"]),
  lineCount: z.number().int().positive(),
  byteSize: z.number().int().nonnegative(),
  contentHash: z.string().length(64),
  test: z.boolean(),
});
export type ArchitectureFile = z.infer<typeof ArchitectureFileSchema>;

export const ArchitectureNodeSchema = z.object({
  id: z.string().min(12),
  stableKey: z.string().min(1),
  kind: ArchitectureNodeKindSchema,
  name: z.string().min(1),
  framework: FrontendFrameworkSchema,
  location: SourceLocationSchema,
  metadata: ArchitectureMetadataSchema,
});
export type ArchitectureNode = z.infer<typeof ArchitectureNodeSchema>;

export const ArchitectureEdgeSchema = z.object({
  id: z.string().min(12),
  source: z.string().min(12),
  target: z.string().min(12),
  kind: ArchitectureEdgeKindSchema,
  confidence: ConfidenceSchema,
  evidence: SourceLocationSchema,
});
export type ArchitectureEdge = z.infer<typeof ArchitectureEdgeSchema>;

export const FrontendHealthCategorySchema = z.enum([
  "architecture",
  "performance",
  "security",
  "maintainability",
]);
export type FrontendHealthCategory = z.infer<
  typeof FrontendHealthCategorySchema
>;

export const ArchitectureIssueSchema = z.object({
  id: z.string().min(12),
  ruleId: z.string().min(1),
  category: FrontendHealthCategorySchema,
  severity: SeveritySchema,
  title: z.string().min(1),
  explanation: z.string().min(1),
  location: SourceLocationSchema,
  scoreDeduction: z.number().min(0).max(100),
  evidence: ArchitectureMetadataSchema,
});
export type ArchitectureIssue = z.infer<typeof ArchitectureIssueSchema>;

export const FrontendHealthScoreSchema = z.object({
  category: FrontendHealthCategorySchema,
  score: z.number().min(0).max(100),
  deductions: z.array(
    z.object({
      ruleId: z.string(),
      points: z.number().min(0).max(100),
      occurrences: z.number().int().positive(),
    }),
  ),
});
export type FrontendHealthScore = z.infer<typeof FrontendHealthScoreSchema>;

export const ArchitectureGraphSchema = z.object({
  schemaVersion: z.literal("frontend-architecture-v1"),
  analyzerVersion: z.string().min(1),
  snapshotId: z.string().uuid(),
  frameworks: z.array(FrontendFrameworkSchema),
  files: z.array(ArchitectureFileSchema),
  nodes: z.array(ArchitectureNodeSchema),
  edges: z.array(ArchitectureEdgeSchema),
  issues: z.array(ArchitectureIssueSchema),
  health: z.array(FrontendHealthScoreSchema),
  coverage: z.object({
    completed: z.array(z.string()),
    skipped: z.array(z.object({ check: z.string(), reason: z.string() })),
    warnings: z.array(z.string()),
  }),
});
export type ArchitectureGraph = z.infer<typeof ArchitectureGraphSchema>;

export const ChangeImpactSchema = z.object({
  selectedNodeIds: z.array(z.string()),
  selectedFiles: z.array(z.string()),
  affectedNodeIds: z.array(z.string()),
  affectedFiles: z.array(z.string()),
  paths: z.array(z.array(z.string())),
  counts: z.object({
    components: z.number().int().nonnegative(),
    pages: z.number().int().nonnegative(),
    routes: z.number().int().nonnegative(),
    tests: z.number().int().nonnegative(),
    totalNodes: z.number().int().nonnegative(),
  }),
  risk: z.enum(["low", "medium", "high"]),
  explanation: z.string(),
  limitations: z.array(z.string()),
});
export type ChangeImpact = z.infer<typeof ChangeImpactSchema>;

export const DesktopRuntimeDiscoverySchema = z.object({
  schemaVersion: z.literal("engineering-observatory-desktop-runtime-v1"),
  pid: z.number().int().positive(),
  apiBaseUrl: z.string().url(),
  updatedAt: z.string().datetime(),
});
export type DesktopRuntimeDiscovery = z.infer<
  typeof DesktopRuntimeDiscoverySchema
>;

export const ScoreDeductionSchema = z.object({
  ruleId: z.string(),
  points: z.number().min(0).max(100),
  occurrences: z.number().int().nonnegative(),
  capped: z.boolean(),
});
export type ScoreDeduction = z.infer<typeof ScoreDeductionSchema>;

export const ScorecardSchema = z.object({
  dimension: DimensionSchema,
  assessmentState: AssessmentStateSchema,
  score: z.number().min(0).max(100).nullable(),
  policyVersion: z.string(),
  deductions: z.array(ScoreDeductionSchema),
  coverage: z.object({
    completedRules: z.array(z.string()),
    skippedRules: z.array(z.object({ ruleId: z.string(), reason: z.string() })),
  }),
});
export type Scorecard = z.infer<typeof ScorecardSchema>;

export const RepositoryRecordSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  sourceKind: SourceKindSchema,
  createdAt: z.string().datetime(),
});
export type RepositoryRecord = z.infer<typeof RepositoryRecordSchema>;

export const SourceSnapshotSchema = z.object({
  id: z.string().uuid(),
  repositoryId: z.string().uuid(),
  sourceKind: SourceKindSchema,
  artifactPath: z.string(),
  commitSha: z.string().nullable(),
  archiveSha256: z.string().nullable(),
  resolvedRef: z.string().nullable(),
  state: z.enum(["ready", "rejected", "expired"]),
  createdAt: z.string().datetime(),
});
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;

export const AnalysisRecordSchema = z.object({
  id: z.string().uuid(),
  repositoryId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  state: AnalysisStateSchema,
  stage: z.string().nullable(),
  ruleSetVersion: z.string(),
  scorePolicyVersion: z.string(),
  failureCode: z.string().nullable(),
  warnings: z.array(z.string()),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});
export type AnalysisRecord = z.infer<typeof AnalysisRecordSchema>;

export const RecommendationSchema = z.object({
  explanation: z.string().min(1),
  productionImpact: z.string().min(1),
  recommendedSolution: z.string().min(1),
  alternatives: z.array(z.string()).min(1),
  tradeoffs: z.array(z.string()).min(1),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const AIProviderNameSchema = z.enum([
  "openai",
  "claude",
  "gemini",
  "ollama",
]);
export type AIProviderName = z.infer<typeof AIProviderNameSchema>;

export const AIReviewSchema = z.object({
  id: z.string().uuid(),
  findingId: z.string().uuid(),
  provider: AIProviderNameSchema,
  model: z.string(),
  state: z.enum(["queued", "running", "completed", "failed"]),
  recommendation: RecommendationSchema.nullable(),
  failureCode: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AIReview = z.infer<typeof AIReviewSchema>;

const HttpTargetSchema = z.object({
  origin: z.string().url(),
  path: z.string().startsWith("/"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().max(50_000).nullable().default(null),
});

export const K6ScenarioSchema = z.object({
  repositoryId: z.string().uuid(),
  analysisId: z.string().uuid().nullable().default(null),
  name: z.string().min(1).max(120),
  tool: z.literal("k6"),
  target: HttpTargetSchema,
  load: z.object({
    virtualUsers: z.number().int().min(1).max(10_000),
    durationSeconds: z.number().int().min(1).max(900),
  }),
  thresholds: z.object({
    p95LatencyMs: z.number().positive(),
    errorRatePercent: z.number().min(0).max(100),
  }),
  authorizationConfirmed: z.literal(true),
});

export const AutocannonScenarioSchema = z.object({
  repositoryId: z.string().uuid(),
  analysisId: z.string().uuid().nullable().default(null),
  name: z.string().min(1).max(120),
  tool: z.literal("autocannon"),
  target: HttpTargetSchema,
  load: z.object({
    connections: z.number().int().min(1).max(10_000),
    durationSeconds: z.number().int().min(1).max(900),
    pipelining: z.number().int().min(1).max(10),
  }),
  thresholds: z.object({
    p95LatencyMs: z.number().positive(),
    errorRatePercent: z.number().min(0).max(100),
  }),
  authorizationConfirmed: z.literal(true),
});

export const PerformanceScenarioInputSchema = z.discriminatedUnion("tool", [
  K6ScenarioSchema,
  AutocannonScenarioSchema,
]);
export type PerformanceScenarioInput = z.infer<
  typeof PerformanceScenarioInputSchema
>;

export const PerformanceMetricsSchema = z.object({
  requestsPerSecond: z.number().nonnegative(),
  completedRequests: z.number().int().nonnegative(),
  latencyMs: z.object({
    p50: z.number().nonnegative(),
    p95: z.number().nonnegative(),
    p99: z.number().nonnegative(),
  }),
  errorRatePercent: z.number().min(0).max(100),
  errors: z.number().int().nonnegative(),
  timeouts: z.number().int().nonnegative(),
  droppedWork: z.number().int().nonnegative(),
});
export type PerformanceMetrics = z.infer<typeof PerformanceMetricsSchema>;

export const PerformanceRunSchema = z.object({
  id: z.string().uuid(),
  repositoryId: z.string().uuid(),
  analysisId: z.string().uuid().nullable(),
  scenario: PerformanceScenarioInputSchema,
  state: PerformanceRunStateSchema,
  toolVersion: z.string().nullable(),
  requestedLoad: z.record(z.string(), z.number()),
  achievedLoad: z.record(z.string(), z.number()).nullable(),
  metrics: PerformanceMetricsSchema.nullable(),
  runnerMetrics: z.record(z.string(), z.number()).nullable(),
  thresholdResults: z.array(
    z.object({
      name: z.string(),
      passed: z.boolean(),
      threshold: z.number(),
      observed: z.number(),
      unit: z.string(),
    }),
  ),
  limitations: z.array(z.string()),
  failureCode: z.string().nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});
export type PerformanceRun = z.infer<typeof PerformanceRunSchema>;

export const DashboardSchema = z.object({
  repository: RepositoryRecordSchema,
  analysis: AnalysisRecordSchema,
  profile: ProjectProfileSchema.nullable(),
  scorecards: z.array(ScorecardSchema),
  overallScore: z.number().min(0).max(100).nullable(),
  findings: z.array(FindingSchema.extend({ id: z.string().uuid() })),
  severityDistribution: z.record(
    SeveritySchema,
    z.number().int().nonnegative(),
  ),
  latestPerformanceRun: PerformanceRunSchema.nullable(),
  aiAvailable: z.boolean(),
});
export type Dashboard = z.infer<typeof DashboardSchema>;

export const CreateAnalysisInputSchema = z.object({
  snapshotId: z.string().uuid(),
});

const GithubCoordinateSchema = z.string().regex(/^[A-Za-z0-9_.-]+$/);
const GithubRepositoryCoordinatesSchema = z.object({
  owner: GithubCoordinateSchema,
  name: GithubCoordinateSchema,
  ref: z.string().min(1).max(250).default("main"),
});

const GithubRepositoryUrlInputSchema = z
  .object({
    repositoryUrl: z.string().trim().min(1).max(500),
    ref: z.string().min(1).max(250).default("main"),
  })
  .transform(({ repositoryUrl, ref }, context) => {
    let url: URL;
    try {
      url = new URL(
        /^https?:\/\//i.test(repositoryUrl)
          ? repositoryUrl
          : `https://${repositoryUrl}`,
      );
    } catch {
      context.addIssue({
        code: "custom",
        message: "Enter a valid GitHub repository URL",
      });
      return z.NEVER;
    }

    if (
      url.protocol !== "https:" ||
      !["github.com", "www.github.com"].includes(url.hostname.toLowerCase()) ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      context.addIssue({
        code: "custom",
        message: "Use a plain HTTPS github.com repository URL",
      });
      return z.NEVER;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 2) {
      context.addIssue({
        code: "custom",
        message: "GitHub URL must contain only an owner and repository",
      });
      return z.NEVER;
    }

    const owner = GithubCoordinateSchema.safeParse(segments[0]);
    const name = GithubCoordinateSchema.safeParse(
      segments[1]?.replace(/\.git$/i, ""),
    );
    if (!owner.success || !name.success) {
      context.addIssue({
        code: "custom",
        message: "GitHub owner or repository name contains unsafe characters",
      });
      return z.NEVER;
    }

    return { owner: owner.data, name: name.data, ref };
  });

export const CreateGithubRepositoryInputSchema = z.union([
  GithubRepositoryUrlInputSchema,
  GithubRepositoryCoordinatesSchema,
]);

export const CreateAIReviewInputSchema = z.object({
  provider: AIProviderNameSchema,
  model: z.string().min(1).max(120).optional(),
});

export const ArchitectureReviewInputSchema = z.object({
  provider: AIProviderNameSchema,
  model: z.string().min(1).max(120).optional(),
  question: z.string().trim().min(3).max(2_000),
  nodeId: z.string().min(12).optional(),
  filePath: z.string().min(1).max(1_000).optional(),
});
export type ArchitectureReviewInput = z.infer<
  typeof ArchitectureReviewInputSchema
>;

export const ArchitectureReviewResponseSchema = z.object({
  provider: AIProviderNameSchema,
  model: z.string(),
  recommendation: RecommendationSchema,
  impact: ChangeImpactSchema.nullable(),
});
export type ArchitectureReviewResponse = z.infer<
  typeof ArchitectureReviewResponseSchema
>;

export const RULE_SET_VERSION = "rules-v1";
export const SCORE_POLICY_VERSION = "score-v1";
export const PROFILE_SCHEMA_VERSION = "project-profile-v1" as const;
