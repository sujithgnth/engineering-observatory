import type { ObservatoryStore } from "@engineering-observatory/persistence";
import { safeFailure } from "@engineering-observatory/persistence";
import { PerformanceEngine } from "@engineering-observatory/performance-engine";

export class PerformanceWorker {
  constructor(
    private readonly store: ObservatoryStore,
    private readonly workerId: string,
    private readonly engine = new PerformanceEngine(),
  ) {}

  async runOnce(): Promise<boolean> {
    const job = await this.store.leaseJob(this.workerId, ["performance"], 600);
    if (!job) return false;
    const run = await this.store.getPerformanceRun(job.targetId);
    if (!run) {
      await this.store.failJob(
        job,
        "performance_run_not_found",
        "performance_run_not_found",
      );
      return true;
    }
    try {
      await this.store.updatePerformanceRunState(run.id, "validating_target");
      const target = await this.engine.validate(run.scenario);
      await this.store.updatePerformanceRunState(run.id, "running");
      const result = await this.engine.runValidated(run.scenario, target);
      await this.store.updatePerformanceRunState(run.id, "processing_results");
      await this.store.completePerformanceRun(run.id, {
        ...result,
        thresholdResults: this.engine.thresholdResults(run.scenario, result),
      });
      await this.store.completeJob(job.id);
    } catch (error) {
      const failure = safeFailure(error);
      const policyRejected =
        failure.code.startsWith("target_") || failure.code.startsWith("load_");
      if (policyRejected) {
        await this.store.updatePerformanceRunState(
          run.id,
          "rejected",
          failure.code,
        );
        await this.store.completeJob(job.id);
      } else {
        await this.store.failJob(job, failure.code, failure.detail);
        await this.store.updatePerformanceRunState(
          run.id,
          job.attempt >= 3 ? "failed" : "queued",
          failure.code,
        );
      }
    }
    return true;
  }
}
