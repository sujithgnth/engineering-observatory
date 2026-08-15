import { randomUUID } from "node:crypto";

import type {
  AIProviderName,
  AIReview,
  AnalysisRecord,
  AnalysisState,
  Dashboard,
  Finding,
  PerformanceMetrics,
  PerformanceRun,
  PerformanceRunState,
  PerformanceScenarioInput,
  ProjectProfile,
  RepositoryRecord,
  Scorecard,
  SourceKind,
  SourceSnapshot,
} from "@engineering-observatory/shared-types";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

const LOCAL_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

type JsonObject = Record<string, unknown>;

function json(value: unknown): string {
  return JSON.stringify(value);
}

export type LeasedJob = {
  id: string;
  jobType: "analysis" | "ai-review" | "performance";
  targetId: string;
  attempt: number;
};

type CompletePerformanceInput = {
  toolVersion: string;
  achievedLoad: Record<string, number>;
  metrics: PerformanceMetrics;
  runnerMetrics: Record<string, number>;
  thresholdResults: PerformanceRun["thresholdResults"];
  limitations: string[];
};

function iso(value: Date | string | null): string | null {
  return value instanceof Date ? value.toISOString() : value;
}

function mapRepository(row: QueryResultRow): RepositoryRecord {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    sourceKind: row.source_kind as SourceKind,
    createdAt: iso(row.created_at as Date) ?? new Date(0).toISOString(),
  };
}

function mapSnapshot(row: QueryResultRow): SourceSnapshot {
  return {
    id: String(row.id),
    repositoryId: String(row.repository_id),
    sourceKind: row.source_kind as SourceKind,
    artifactPath: String(row.artifact_path),
    commitSha: row.commit_sha ? String(row.commit_sha) : null,
    archiveSha256: row.archive_sha256 ? String(row.archive_sha256) : null,
    resolvedRef: row.resolved_ref ? String(row.resolved_ref) : null,
    state: row.state as SourceSnapshot["state"],
    createdAt: iso(row.created_at as Date) ?? new Date(0).toISOString(),
  };
}

function mapAnalysis(row: QueryResultRow): AnalysisRecord {
  return {
    id: String(row.id),
    repositoryId: String(row.repository_id),
    snapshotId: String(row.snapshot_id),
    state: row.state as AnalysisState,
    stage: row.stage ? String(row.stage) : null,
    ruleSetVersion: String(row.rule_set_version),
    scorePolicyVersion: String(row.score_policy_version),
    failureCode: row.failure_code ? String(row.failure_code) : null,
    warnings: (row.warnings as string[]) ?? [],
    createdAt: iso(row.created_at as Date) ?? new Date(0).toISOString(),
    startedAt: iso((row.started_at as Date | null) ?? null),
    completedAt: iso((row.completed_at as Date | null) ?? null),
  };
}

function mapFinding(row: QueryResultRow): Finding & { id: string } {
  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    analyzerId: String(row.analyzer_id),
    analyzerVersion: String(row.analyzer_version),
    ruleId: String(row.rule_id),
    dimension: row.dimension as Finding["dimension"],
    severity: row.severity as Finding["severity"],
    confidence: row.confidence as Finding["confidence"],
    title: String(row.title),
    description: String(row.description),
    location: {
      path: String(row.file_path),
      lineStart: row.line_start === null ? null : Number(row.line_start),
      lineEnd: row.line_end === null ? null : Number(row.line_end),
    },
    evidence: row.evidence as Finding["evidence"],
    remediation: String(row.remediation),
    scoreDeduction:
      row.score_deduction === null ? null : Number(row.score_deduction),
  };
}

function mapScorecard(row: QueryResultRow): Scorecard {
  return {
    dimension: row.dimension as Scorecard["dimension"],
    assessmentState: row.assessment_state as Scorecard["assessmentState"],
    score: row.score === null ? null : Number(row.score),
    policyVersion: String(row.policy_version),
    deductions: row.deductions as Scorecard["deductions"],
    coverage: row.coverage as Scorecard["coverage"],
  };
}

function requestedLoad(
  scenario: PerformanceScenarioInput,
): Record<string, number> {
  return scenario.tool === "k6"
    ? {
        virtualUsers: scenario.load.virtualUsers,
        durationSeconds: scenario.load.durationSeconds,
      }
    : {
        connections: scenario.load.connections,
        durationSeconds: scenario.load.durationSeconds,
        pipelining: scenario.load.pipelining,
      };
}

function mapPerformanceRun(row: QueryResultRow): PerformanceRun {
  return {
    id: String(row.id),
    repositoryId: String(row.repository_id),
    analysisId: row.analysis_id ? String(row.analysis_id) : null,
    scenario: row.scenario as PerformanceScenarioInput,
    state: row.state as PerformanceRunState,
    toolVersion: row.tool_version ? String(row.tool_version) : null,
    requestedLoad: row.requested_load as Record<string, number>,
    achievedLoad: (row.achieved_load as Record<string, number> | null) ?? null,
    metrics: (row.metrics as PerformanceMetrics | null) ?? null,
    runnerMetrics:
      (row.runner_metrics as Record<string, number> | null) ?? null,
    thresholdResults:
      (row.threshold_results as PerformanceRun["thresholdResults"] | null) ??
      [],
    limitations: (row.limitations as string[] | null) ?? [],
    failureCode: row.failure_code ? String(row.failure_code) : null,
    createdAt: iso(row.created_at as Date) ?? new Date(0).toISOString(),
    startedAt: iso((row.started_at as Date | null) ?? null),
    completedAt: iso((row.completed_at as Date | null) ?? null),
  };
}

export class ObservatoryStore {
  constructor(readonly pool: Pool) {}

  static fromEnvironment() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required");
    }
    return new ObservatoryStore(new Pool({ connectionString, max: 10 }));
  }

  async close() {
    await this.pool.end();
  }

  async health() {
    await this.pool.query("SELECT 1");
  }

  async createRepositoryWithSnapshot(input: {
    displayName: string;
    sourceKind: SourceKind;
    artifactPath: string;
    archiveSha256?: string;
    commitSha?: string;
    resolvedRef?: string;
    providerRepositoryId?: string;
  }): Promise<{ repository: RepositoryRecord; snapshot: SourceSnapshot }> {
    return this.transaction(async (client) => {
      const repositoryId = randomUUID();
      const snapshotId = randomUUID();
      const repositoryResult = await client.query(
        `INSERT INTO repositories
          (id, workspace_id, display_name, source_kind, provider_repository_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          repositoryId,
          LOCAL_WORKSPACE_ID,
          input.displayName,
          input.sourceKind,
          input.providerRepositoryId ?? null,
        ],
      );
      const snapshotResult = await client.query(
        `INSERT INTO source_snapshots
          (id, repository_id, source_kind, artifact_path, commit_sha, archive_sha256, resolved_ref, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready')
         RETURNING *`,
        [
          snapshotId,
          repositoryId,
          input.sourceKind,
          input.artifactPath,
          input.commitSha ?? null,
          input.archiveSha256 ?? null,
          input.resolvedRef ?? null,
        ],
      );
      return {
        repository: mapRepository(repositoryResult.rows[0]!),
        snapshot: mapSnapshot(snapshotResult.rows[0]!),
      };
    });
  }

  async listRepositories(): Promise<RepositoryRecord[]> {
    const result = await this.pool.query(
      "SELECT * FROM repositories WHERE workspace_id = $1 ORDER BY created_at DESC",
      [LOCAL_WORKSPACE_ID],
    );
    return result.rows.map(mapRepository);
  }

  async getRepository(id: string): Promise<RepositoryRecord | null> {
    const result = await this.pool.query(
      "SELECT * FROM repositories WHERE id = $1 AND workspace_id = $2",
      [id, LOCAL_WORKSPACE_ID],
    );
    return result.rows[0] ? mapRepository(result.rows[0]) : null;
  }

  async getSnapshot(id: string): Promise<SourceSnapshot | null> {
    const result = await this.pool.query(
      `SELECT s.* FROM source_snapshots s
       JOIN repositories r ON r.id = s.repository_id
       WHERE s.id = $1 AND r.workspace_id = $2`,
      [id, LOCAL_WORKSPACE_ID],
    );
    return result.rows[0] ? mapSnapshot(result.rows[0]) : null;
  }

  async createAnalysis(
    snapshotId: string,
    ruleSetVersion: string,
    scorePolicyVersion: string,
  ): Promise<AnalysisRecord> {
    return this.transaction(async (client) => {
      const snapshotResult = await client.query(
        `SELECT s.*, r.workspace_id FROM source_snapshots s
         JOIN repositories r ON r.id = s.repository_id
         WHERE s.id = $1 AND r.workspace_id = $2`,
        [snapshotId, LOCAL_WORKSPACE_ID],
      );
      const snapshot = snapshotResult.rows[0];
      if (!snapshot) {
        throw new Error("snapshot_not_found");
      }
      const analysisId = randomUUID();
      const analysisResult = await client.query(
        `INSERT INTO analyses
          (id, repository_id, snapshot_id, state, stage, rule_set_version, score_policy_version)
         VALUES ($1, $2, $3, 'queued', 'queued', $4, $5)
         RETURNING *`,
        [
          analysisId,
          snapshot.repository_id,
          snapshotId,
          ruleSetVersion,
          scorePolicyVersion,
        ],
      );
      await client.query(
        `INSERT INTO jobs (id, job_type, target_id, state)
         VALUES ($1, 'analysis', $2, 'queued')`,
        [randomUUID(), analysisId],
      );
      return mapAnalysis(analysisResult.rows[0]!);
    });
  }

  async getAnalysis(id: string): Promise<AnalysisRecord | null> {
    const result = await this.pool.query(
      `SELECT a.* FROM analyses a
       JOIN repositories r ON r.id = a.repository_id
       WHERE a.id = $1 AND r.workspace_id = $2`,
      [id, LOCAL_WORKSPACE_ID],
    );
    return result.rows[0] ? mapAnalysis(result.rows[0]) : null;
  }

  async listAnalyses(repositoryId: string): Promise<AnalysisRecord[]> {
    const result = await this.pool.query(
      `SELECT a.* FROM analyses a
       JOIN repositories r ON r.id = a.repository_id
       WHERE a.repository_id = $1 AND r.workspace_id = $2
       ORDER BY a.created_at DESC`,
      [repositoryId, LOCAL_WORKSPACE_ID],
    );
    return result.rows.map(mapAnalysis);
  }

  async getRepositoryTimeline(repositoryId: string) {
    const analyses = (await this.listAnalyses(repositoryId))
      .filter((analysis) =>
        ["completed", "completed_with_warnings"].includes(analysis.state),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const timeline: Array<{
      analysisId: string;
      createdAt: string;
      total: number;
      new: number;
      persistent: number;
      resolved: number;
    }> = [];
    let previous = new Set<string>();
    for (const analysis of analyses) {
      const findings = await this.listFindings(analysis.id);
      const current = new Set(findings.map((finding) => finding.fingerprint));
      const first = timeline.length === 0;
      timeline.push({
        analysisId: analysis.id,
        createdAt: analysis.createdAt,
        total: current.size,
        new: first
          ? current.size
          : [...current].filter((item) => !previous.has(item)).length,
        persistent: first
          ? 0
          : [...current].filter((item) => previous.has(item)).length,
        resolved: first
          ? 0
          : [...previous].filter((item) => !current.has(item)).length,
      });
      previous = current;
    }
    return timeline;
  }

  async updateAnalysisState(
    id: string,
    state: AnalysisState,
    stage: string | null,
    failureCode: string | null = null,
  ) {
    const starting = [
      "acquiring",
      "profiling",
      "analyzing",
      "scoring",
    ].includes(state);
    const terminal = [
      "completed",
      "completed_with_warnings",
      "failed",
      "cancelled",
    ].includes(state);
    await this.pool.query(
      `UPDATE analyses SET
        state = $2,
        stage = $3,
        failure_code = $4,
        started_at = CASE WHEN $5 THEN COALESCE(started_at, now()) ELSE started_at END,
        completed_at = CASE WHEN $6 THEN now() ELSE completed_at END
       WHERE id = $1`,
      [id, state, stage, failureCode, starting, terminal],
    );
  }

  async saveAnalysisResult(
    analysisId: string,
    profile: ProjectProfile,
    findings: Finding[],
    scorecards: Scorecard[],
    warnings: string[],
  ) {
    await this.transaction(async (client) => {
      await client.query(
        `INSERT INTO project_profiles (analysis_id, profile)
         VALUES ($1, $2)
         ON CONFLICT (analysis_id) DO UPDATE SET profile = EXCLUDED.profile`,
        [analysisId, json(profile)],
      );
      for (const finding of findings) {
        await client.query(
          `INSERT INTO findings
            (id, analysis_id, fingerprint, analyzer_id, analyzer_version, rule_id, dimension,
             severity, confidence, title, description, file_path, line_start, line_end, evidence,
             remediation, score_deduction)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT (analysis_id, fingerprint) DO NOTHING`,
          [
            randomUUID(),
            analysisId,
            finding.fingerprint,
            finding.analyzerId,
            finding.analyzerVersion,
            finding.ruleId,
            finding.dimension,
            finding.severity,
            finding.confidence,
            finding.title,
            finding.description,
            finding.location.path,
            finding.location.lineStart,
            finding.location.lineEnd,
            json(finding.evidence),
            finding.remediation,
            finding.scoreDeduction,
          ],
        );
      }
      for (const scorecard of scorecards) {
        await client.query(
          `INSERT INTO scorecards
            (id, analysis_id, dimension, assessment_state, score, policy_version, deductions, coverage)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (analysis_id, dimension) DO UPDATE SET
             assessment_state = EXCLUDED.assessment_state,
             score = EXCLUDED.score,
             policy_version = EXCLUDED.policy_version,
             deductions = EXCLUDED.deductions,
             coverage = EXCLUDED.coverage`,
          [
            randomUUID(),
            analysisId,
            scorecard.dimension,
            scorecard.assessmentState,
            scorecard.score,
            scorecard.policyVersion,
            json(scorecard.deductions),
            json(scorecard.coverage),
          ],
        );
      }
      await client.query(
        `INSERT INTO health_reports
          (id, analysis_id, performance_run_id, assessment_state, overall_score,
           policy_version, dimension_snapshot)
         VALUES ($1, $2, NULL, 'partial', NULL, $3, $4)
         ON CONFLICT DO NOTHING`,
        [
          randomUUID(),
          analysisId,
          scorecards[0]?.policyVersion ?? "score-v1",
          json({
            ...Object.fromEntries(
              scorecards.map((scorecard) => [
                scorecard.dimension,
                {
                  assessmentState: scorecard.assessmentState,
                  score: scorecard.score,
                },
              ]),
            ),
            performance: { assessmentState: "not_measured", score: null },
          }),
        ],
      );
      await client.query(
        `UPDATE analyses SET
          state = $2, stage = 'completed', warnings = $3, completed_at = now()
         WHERE id = $1`,
        [
          analysisId,
          warnings.length > 0 ? "completed_with_warnings" : "completed",
          json(warnings),
        ],
      );
    });
  }

  async listFindings(
    analysisId: string,
  ): Promise<Array<Finding & { id: string }>> {
    const result = await this.pool.query(
      `SELECT f.* FROM findings f
       JOIN analyses a ON a.id = f.analysis_id
       JOIN repositories r ON r.id = a.repository_id
       WHERE f.analysis_id = $1 AND r.workspace_id = $2
       ORDER BY
         CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3
           WHEN 'low' THEN 4 ELSE 5 END,
         f.file_path, f.rule_id`,
      [analysisId, LOCAL_WORKSPACE_ID],
    );
    return result.rows.map(mapFinding);
  }

  async getFinding(id: string): Promise<(Finding & { id: string }) | null> {
    const result = await this.pool.query(
      `SELECT f.* FROM findings f
       JOIN analyses a ON a.id = f.analysis_id
       JOIN repositories r ON r.id = a.repository_id
       WHERE f.id = $1 AND r.workspace_id = $2`,
      [id, LOCAL_WORKSPACE_ID],
    );
    return result.rows[0] ? mapFinding(result.rows[0]) : null;
  }

  async getProfile(analysisId: string): Promise<ProjectProfile | null> {
    const result = await this.pool.query(
      `SELECT p.profile FROM project_profiles p
       JOIN analyses a ON a.id = p.analysis_id
       JOIN repositories r ON r.id = a.repository_id
       WHERE p.analysis_id = $1 AND r.workspace_id = $2`,
      [analysisId, LOCAL_WORKSPACE_ID],
    );
    return (result.rows[0]?.profile as ProjectProfile | undefined) ?? null;
  }

  async getScorecards(analysisId: string): Promise<Scorecard[]> {
    const result = await this.pool.query(
      `SELECT s.* FROM scorecards s
       JOIN analyses a ON a.id = s.analysis_id
       JOIN repositories r ON r.id = a.repository_id
       WHERE s.analysis_id = $1 AND r.workspace_id = $2
       ORDER BY s.dimension`,
      [analysisId, LOCAL_WORKSPACE_ID],
    );
    return result.rows.map(mapScorecard);
  }

  async createAIReview(
    findingId: string,
    provider: AIProviderName,
    model: string,
  ): Promise<AIReview> {
    const finding = await this.getFinding(findingId);
    if (!finding) throw new Error("finding_not_found");
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO ai_reviews (id, finding_id, provider, model, state)
       VALUES ($1, $2, $3, $4, 'queued') RETURNING *`,
      [id, findingId, provider, model],
    );
    await this.pool.query(
      `INSERT INTO jobs (id, job_type, target_id, state)
       VALUES ($1, 'ai-review', $2, 'queued')`,
      [randomUUID(), id],
    );
    return this.mapAIReview(result.rows[0]!);
  }

  async getAIReview(id: string): Promise<AIReview | null> {
    const result = await this.pool.query(
      `SELECT ar.* FROM ai_reviews ar
       JOIN findings f ON f.id = ar.finding_id
       JOIN analyses a ON a.id = f.analysis_id
       JOIN repositories r ON r.id = a.repository_id
       WHERE ar.id = $1 AND r.workspace_id = $2`,
      [id, LOCAL_WORKSPACE_ID],
    );
    return result.rows[0] ? this.mapAIReview(result.rows[0]) : null;
  }

  async completeAIReview(
    id: string,
    recommendation: AIReview["recommendation"],
  ) {
    await this.pool.query(
      `UPDATE ai_reviews SET state = 'completed', recommendation = $2, completed_at = now()
       WHERE id = $1`,
      [id, json(recommendation)],
    );
  }

  async updateAIReviewState(
    id: string,
    state: AIReview["state"],
    failureCode: string | null = null,
  ) {
    await this.pool.query(
      `UPDATE ai_reviews SET state = $2, failure_code = $3,
       completed_at = CASE WHEN $2 IN ('completed', 'failed') THEN now() ELSE completed_at END
       WHERE id = $1`,
      [id, state, failureCode],
    );
  }

  async failAIReview(id: string, failureCode: string) {
    await this.pool.query(
      `UPDATE ai_reviews SET state = 'failed', failure_code = $2, completed_at = now()
       WHERE id = $1`,
      [id, failureCode],
    );
  }

  async createPerformanceRun(
    scenario: PerformanceScenarioInput,
  ): Promise<PerformanceRun> {
    const repository = await this.getRepository(scenario.repositoryId);
    if (!repository) throw new Error("repository_not_found");
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO performance_runs
        (id, repository_id, analysis_id, scenario, state, requested_load)
       VALUES ($1, $2, $3, $4, 'queued', $5)
       RETURNING *`,
      [
        id,
        scenario.repositoryId,
        scenario.analysisId,
        json(scenario),
        json(requestedLoad(scenario)),
      ],
    );
    await this.pool.query(
      `INSERT INTO jobs (id, job_type, target_id, state)
       VALUES ($1, 'performance', $2, 'queued')`,
      [randomUUID(), id],
    );
    return mapPerformanceRun(result.rows[0]!);
  }

  async getPerformanceRun(id: string): Promise<PerformanceRun | null> {
    const result = await this.pool.query(
      `SELECT pr.* FROM performance_runs pr
       JOIN repositories r ON r.id = pr.repository_id
       WHERE pr.id = $1 AND r.workspace_id = $2`,
      [id, LOCAL_WORKSPACE_ID],
    );
    return result.rows[0] ? mapPerformanceRun(result.rows[0]) : null;
  }

  async getLatestPerformanceRun(
    analysisId: string,
  ): Promise<PerformanceRun | null> {
    const result = await this.pool.query(
      `SELECT pr.* FROM performance_runs pr
       JOIN analyses a ON a.id = pr.analysis_id
       JOIN repositories r ON r.id = pr.repository_id
       WHERE pr.analysis_id = $1 AND r.workspace_id = $2 AND pr.state = 'completed'
       ORDER BY pr.created_at DESC LIMIT 1`,
      [analysisId, LOCAL_WORKSPACE_ID],
    );
    return result.rows[0] ? mapPerformanceRun(result.rows[0]) : null;
  }

  async updatePerformanceRunState(
    id: string,
    state: PerformanceRunState,
    failureCode: string | null = null,
  ) {
    const starting = state === "validating_target" || state === "running";
    const terminal = ["completed", "cancelled", "rejected", "failed"].includes(
      state,
    );
    await this.pool.query(
      `UPDATE performance_runs SET state = $2, failure_code = $3,
       started_at = CASE WHEN $4 THEN COALESCE(started_at, now()) ELSE started_at END,
       completed_at = CASE WHEN $5 THEN now() ELSE completed_at END
       WHERE id = $1`,
      [id, state, failureCode, starting, terminal],
    );
  }

  async cancelPerformanceRun(id: string): Promise<boolean> {
    return this.transaction(async (client) => {
      const result = await client.query(
        `UPDATE performance_runs SET state = 'cancelled', completed_at = now()
         WHERE id = $1 AND state = 'queued'`,
        [id],
      );
      await client.query(
        `UPDATE jobs SET state = 'cancelled', updated_at = now()
         WHERE job_type = 'performance' AND target_id = $1 AND state = 'queued'`,
        [id],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async completePerformanceRun(id: string, input: CompletePerformanceInput) {
    await this.transaction(async (client) => {
      const runResult = await client.query(
        `UPDATE performance_runs SET state = 'completed', tool_version = $2,
         achieved_load = $3, metrics = $4, runner_metrics = $5, threshold_results = $6,
         limitations = $7, completed_at = now()
         WHERE id = $1 RETURNING analysis_id`,
        [
          id,
          input.toolVersion,
          json(input.achievedLoad),
          json(input.metrics),
          json(input.runnerMetrics),
          json(input.thresholdResults),
          json(input.limitations),
        ],
      );
      const analysisId = runResult.rows[0]?.analysis_id as string | undefined;
      if (!analysisId) return;
      const scoresResult = await client.query(
        `SELECT * FROM scorecards WHERE analysis_id = $1 ORDER BY dimension`,
        [analysisId],
      );
      const scorecards = scoresResult.rows.map(mapScorecard);
      const performanceScore = Math.max(
        0,
        100 - input.thresholdResults.filter((item) => !item.passed).length * 25,
      );
      const allStaticAssessed =
        scorecards.length === 3 &&
        scorecards.every(
          (scorecard) =>
            scorecard.assessmentState === "assessed" &&
            scorecard.score !== null,
        );
      const overallScore = allStaticAssessed
        ? Math.round(
            (scorecards.reduce(
              (sum, scorecard) => sum + (scorecard.score ?? 0),
              0,
            ) +
              performanceScore) /
              4,
          )
        : null;
      await client.query(
        `INSERT INTO health_reports
          (id, analysis_id, performance_run_id, assessment_state, overall_score,
           policy_version, dimension_snapshot)
         SELECT $1, $2, $3, $4, $5, a.score_policy_version, $6
         FROM analyses a WHERE a.id = $2
         ON CONFLICT DO NOTHING`,
        [
          randomUUID(),
          analysisId,
          id,
          overallScore === null ? "partial" : "assessed",
          overallScore,
          json({
            ...Object.fromEntries(
              scorecards.map((scorecard) => [
                scorecard.dimension,
                {
                  assessmentState: scorecard.assessmentState,
                  score: scorecard.score,
                },
              ]),
            ),
            performance: {
              assessmentState: "assessed",
              score: performanceScore,
            },
          }),
        ],
      );
    });
  }

  async leaseJob(
    workerId: string,
    jobTypes: LeasedJob["jobType"][],
    leaseSeconds = 60,
  ): Promise<LeasedJob | null> {
    return this.transaction(async (client) => {
      const result = await client.query(
        `WITH candidate AS (
           SELECT id FROM jobs
           WHERE job_type = ANY($1::text[])
             AND available_at <= now()
             AND (state = 'queued' OR (state = 'leased' AND lease_expires_at < now()))
           ORDER BY created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE jobs j SET
           state = 'leased',
           attempt = attempt + 1,
           leased_by = $2,
           lease_expires_at = now() + make_interval(secs => $3),
           updated_at = now()
         FROM candidate
         WHERE j.id = candidate.id
         RETURNING j.*`,
        [jobTypes, workerId, leaseSeconds],
      );
      const row = result.rows[0];
      return row
        ? {
            id: String(row.id),
            jobType: row.job_type as LeasedJob["jobType"],
            targetId: String(row.target_id),
            attempt: Number(row.attempt),
          }
        : null;
    });
  }

  async completeJob(jobId: string) {
    await this.pool.query(
      `UPDATE jobs SET state = 'completed', lease_expires_at = NULL, updated_at = now()
       WHERE id = $1`,
      [jobId],
    );
  }

  async failJob(job: LeasedJob, code: string, detail: string) {
    await this.pool.query(
      `UPDATE jobs SET
        state = CASE WHEN attempt >= max_attempts THEN 'failed' ELSE 'queued' END,
        available_at = CASE WHEN attempt >= max_attempts THEN available_at
          ELSE now() + make_interval(secs => LEAST(60, attempt * attempt * 2)) END,
        lease_expires_at = NULL,
        safe_error = $2,
        updated_at = now()
       WHERE id = $1`,
      [job.id, json({ code, detail: detail.slice(0, 300) })],
    );
  }

  async getDashboard(
    analysisId: string,
    aiAvailable: boolean,
  ): Promise<Dashboard | null> {
    const analysis = await this.getAnalysis(analysisId);
    if (!analysis) return null;
    const repository = await this.getRepository(analysis.repositoryId);
    if (!repository) return null;
    const [profile, findings, scorecards, latestPerformanceRun, healthReport] =
      await Promise.all([
        this.getProfile(analysisId),
        this.listFindings(analysisId),
        this.getScorecards(analysisId),
        this.getLatestPerformanceRun(analysisId),
        this.pool.query(
          `SELECT overall_score FROM health_reports
           WHERE analysis_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [analysisId],
        ),
      ]);
    const severityDistribution: Dashboard["severityDistribution"] = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    for (const finding of findings) severityDistribution[finding.severity] += 1;
    const performanceScore = this.performanceScore(latestPerformanceRun);
    const storedOverallScore = healthReport.rows[0]?.overall_score;
    const overallScore =
      storedOverallScore === null || storedOverallScore === undefined
        ? null
        : Number(storedOverallScore);
    return {
      repository,
      analysis,
      profile,
      scorecards: [
        ...scorecards,
        {
          dimension: "performance",
          assessmentState:
            performanceScore === null ? "not_measured" : "assessed",
          score: performanceScore,
          policyVersion: analysis.scorePolicyVersion,
          deductions: [],
          coverage: {
            completedRules:
              performanceScore === null ? [] : ["performance.thresholds"],
            skippedRules:
              performanceScore === null
                ? [
                    {
                      ruleId: "performance.thresholds",
                      reason: "No completed run",
                    },
                  ]
                : [],
          },
        },
      ],
      overallScore,
      findings,
      severityDistribution,
      latestPerformanceRun,
      aiAvailable,
    };
  }

  private performanceScore(run: PerformanceRun | null): number | null {
    if (!run?.metrics || run.state !== "completed") return null;
    const failures = run.thresholdResults.filter(
      (threshold) => !threshold.passed,
    ).length;
    return Math.max(0, 100 - failures * 25);
  }

  private mapAIReview(row: QueryResultRow): AIReview {
    return {
      id: String(row.id),
      findingId: String(row.finding_id),
      provider: row.provider as AIProviderName,
      model: String(row.model),
      state: row.state as AIReview["state"],
      recommendation:
        (row.recommendation as AIReview["recommendation"]) ?? null,
      failureCode: row.failure_code ? String(row.failure_code) : null,
      createdAt: iso(row.created_at as Date) ?? new Date(0).toISOString(),
    };
  }

  private async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export function safeFailure(error: unknown): { code: string; detail: string } {
  if (error instanceof Error) {
    const knownCode = /^[a-z0-9_]+$/.test(error.message)
      ? error.message
      : "job_failed";
    return {
      code: knownCode,
      detail: knownCode === error.message ? error.message : error.name,
    };
  }
  return { code: "job_failed", detail: "Unknown failure" };
}

export type { JsonObject };
