import type {
  PerformanceRun,
  PerformanceScenarioInput,
} from "@engineering-observatory/shared-types";

import { AutocannonDriver, K6Driver, type LoadDriverResult } from "./drivers";
import { PerformanceTargetPolicy } from "./target-policy";

export class PerformanceEngine {
  constructor(private readonly policy = new PerformanceTargetPolicy()) {}

  validate(scenario: PerformanceScenarioInput): Promise<URL> {
    return this.policy.validate(scenario);
  }

  async runValidated(
    scenario: PerformanceScenarioInput,
    target: URL,
  ): Promise<LoadDriverResult> {
    const driver =
      scenario.tool === "k6" ? new K6Driver() : new AutocannonDriver();
    return driver.run(scenario, target);
  }

  async run(scenario: PerformanceScenarioInput): Promise<LoadDriverResult> {
    const target = await this.validate(scenario);
    return this.runValidated(scenario, target);
  }

  thresholdResults(
    scenario: PerformanceScenarioInput,
    result: LoadDriverResult,
  ): PerformanceRun["thresholdResults"] {
    return [
      {
        name: "p95 latency",
        passed:
          result.metrics.latencyMs.p95 <= scenario.thresholds.p95LatencyMs,
        threshold: scenario.thresholds.p95LatencyMs,
        observed: result.metrics.latencyMs.p95,
        unit: "ms",
      },
      {
        name: "error rate",
        passed:
          result.metrics.errorRatePercent <=
          scenario.thresholds.errorRatePercent,
        threshold: scenario.thresholds.errorRatePercent,
        observed: result.metrics.errorRatePercent,
        unit: "%",
      },
    ];
  }
}
