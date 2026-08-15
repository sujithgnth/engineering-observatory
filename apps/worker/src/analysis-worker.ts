import path from "node:path";

import { createAIProvider } from "@engineering-observatory/ai-adapter";
import { AnalyzerEngine } from "@engineering-observatory/analyzer-engine";
import { FrontendIntelligenceEngine } from "@engineering-observatory/frontend-intelligence";
import type {
  ArchitectureGraphStore,
  LeasedJob,
  ObservatoryStore,
} from "@engineering-observatory/persistence";
import { safeFailure } from "@engineering-observatory/persistence";
import {
  cleanupWorkspace,
  createIsolatedWorkspace,
  extractArchive,
  scanRepository,
} from "@engineering-observatory/scanners";

export class AnalysisWorker {
  constructor(
    private readonly store: ObservatoryStore,
    private readonly architectureStore: ArchitectureGraphStore,
    private readonly workerId: string,
    private readonly engine = new AnalyzerEngine(),
    private readonly intelligence = new FrontendIntelligenceEngine(),
  ) {}

  async runOnce(): Promise<boolean> {
    const job = await this.store.leaseJob(this.workerId, [
      "analysis",
      "ai-review",
    ]);
    if (!job) return false;
    try {
      if (job.jobType === "analysis") await this.processAnalysis(job);
      else await this.processAIReview(job);
      await this.store.completeJob(job.id);
    } catch (error) {
      const failure = safeFailure(error);
      await this.store.failJob(job, failure.code, failure.detail);
      if (job.jobType === "analysis") {
        await this.store.updateAnalysisState(
          job.targetId,
          job.attempt >= 3 ? "failed" : "queued",
          job.attempt >= 3 ? "failed" : "retrying",
          failure.code,
        );
      } else {
        await this.store.updateAIReviewState(
          job.targetId,
          job.attempt >= 3 ? "failed" : "queued",
          failure.code,
        );
      }
    }
    return true;
  }

  private async processAIReview(job: LeasedJob) {
    const review = await this.store.getAIReview(job.targetId);
    if (!review) throw new Error("ai_review_not_found");
    const finding = await this.store.getFinding(review.findingId);
    if (!finding) throw new Error("finding_not_found");
    await this.store.updateAIReviewState(review.id, "running");
    const provider = createAIProvider(review.provider, review.model);
    const recommendation = await provider.review({ finding });
    await this.store.completeAIReview(review.id, recommendation);
  }

  private async processAnalysis(job: LeasedJob) {
    const analysis = await this.store.getAnalysis(job.targetId);
    if (!analysis) throw new Error("analysis_not_found");
    const snapshot = await this.store.getSnapshot(analysis.snapshotId);
    if (!snapshot) throw new Error("snapshot_not_found");
    await this.store.updateAnalysisState(
      analysis.id,
      "acquiring",
      "extracting",
    );
    const workspace = await createIsolatedWorkspace();
    const repositoryRoot = path.join(workspace, "repository");
    try {
      await extractArchive(snapshot.artifactPath, repositoryRoot);
      await this.store.updateAnalysisState(
        analysis.id,
        "profiling",
        "repository-profile",
      );
      const profile = await scanRepository(repositoryRoot, snapshot.id);
      await this.store.updateAnalysisState(
        analysis.id,
        "analyzing",
        "frontend-architecture-graph",
      );
      const architectureGraph = await this.intelligence.analyze(
        repositoryRoot,
        profile,
      );
      await this.architectureStore.saveGraph(analysis.id, architectureGraph);
      await this.store.updateAnalysisState(
        analysis.id,
        "analyzing",
        "deterministic-analyzers",
      );
      const output = await this.engine.analyze(repositoryRoot, profile);
      await this.store.updateAnalysisState(
        analysis.id,
        "scoring",
        "score-policy-v1",
      );
      await this.store.saveAnalysisResult(
        analysis.id,
        profile,
        output.findings,
        output.scorecards,
        [...profile.coverage.warnings, ...output.warnings],
      );
    } finally {
      await cleanupWorkspace(workspace);
    }
  }
}
