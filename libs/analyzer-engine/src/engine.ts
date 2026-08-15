import type {
  Finding,
  ProjectProfile,
  Scorecard,
} from "@engineering-observatory/shared-types";

import type { Analyzer, AnalyzerResult } from "./contracts";
import { BackendAnalyzer } from "./backend-analyzer";
import { DatabaseAnalyzer } from "./database-analyzer";
import { FrontendAnalyzer } from "./frontend-analyzer";
import { calculateStaticScorecards } from "./scoring";
import { SecurityAnalyzer } from "./security-analyzer";

export type AnalysisOutput = {
  findings: Finding[];
  scorecards: Scorecard[];
  analyzerResults: AnalyzerResult[];
  warnings: string[];
};

export class AnalyzerEngine {
  constructor(
    private readonly analyzers: Analyzer[] = [
      new FrontendAnalyzer(),
      new BackendAnalyzer(),
      new DatabaseAnalyzer(),
      new SecurityAnalyzer(),
    ],
  ) {}

  async analyze(
    repositoryRoot: string,
    profile: ProjectProfile,
  ): Promise<AnalysisOutput> {
    const analyzerResults: AnalyzerResult[] = [];
    for (const analyzer of this.analyzers) {
      if (!analyzer.isApplicable(profile)) {
        analyzerResults.push({
          analyzerId: analyzer.id,
          analyzerVersion: analyzer.version,
          findings: [],
          completedRules: [],
          skippedRules: [
            {
              ruleId: `${analyzer.id}.*`,
              reason: "Not applicable to project profile",
            },
          ],
          warnings: [],
        });
        continue;
      }
      analyzerResults.push(await analyzer.analyze({ repositoryRoot, profile }));
    }
    const findings = analyzerResults
      .flatMap((result) => result.findings)
      .sort((left, right) =>
        `${left.location.path}:${left.location.lineStart ?? 0}:${left.ruleId}`.localeCompare(
          `${right.location.path}:${right.location.lineStart ?? 0}:${right.ruleId}`,
        ),
      );
    return {
      findings,
      analyzerResults,
      scorecards: calculateStaticScorecards(findings, analyzerResults),
      warnings: analyzerResults.flatMap((result) => result.warnings),
    };
  }
}
