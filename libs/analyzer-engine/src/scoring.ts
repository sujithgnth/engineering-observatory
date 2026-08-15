import type {
  Dimension,
  Finding,
  Scorecard,
} from "@engineering-observatory/shared-types";
import { SCORE_POLICY_VERSION } from "@engineering-observatory/shared-types";

import type { AnalyzerResult } from "./contracts";

const STATIC_DIMENSIONS: Dimension[] = [
  "architecture",
  "security",
  "scalability",
];
const MAX_RULE_DEDUCTION = 20;

function ruleDimension(ruleId: string): Dimension | null {
  if (ruleId.startsWith("security.")) return "security";
  if (ruleId === "nestjs.input-validation.missing") return "security";
  if (ruleId.startsWith("database.")) return "scalability";
  if (
    ruleId === "backend.collection.pagination-missing" ||
    ruleId === "node.request-path.blocking-operation" ||
    ruleId === "frontend.route.eager-loading-candidate"
  ) {
    return "scalability";
  }
  if (
    ruleId === "frontend.component.large" ||
    ruleId === "frontend.complexity.excessive" ||
    ruleId === "backend.error.swallowed"
  ) {
    return "architecture";
  }
  return null;
}

export function calculateStaticScorecards(
  findings: Finding[],
  analyzerResults: AnalyzerResult[],
): Scorecard[] {
  return STATIC_DIMENSIONS.map((dimension) => {
    const byRule = new Map<string, Finding[]>();
    for (const finding of findings.filter(
      (candidate) =>
        candidate.dimension === dimension && candidate.scoreDeduction !== null,
    )) {
      const existing = byRule.get(finding.ruleId) ?? [];
      existing.push(finding);
      byRule.set(finding.ruleId, existing);
    }
    const deductions = [...byRule.entries()].map(([ruleId, occurrences]) => {
      const raw = occurrences.reduce(
        (sum, finding) => sum + (finding.scoreDeduction ?? 0),
        0,
      );
      return {
        ruleId,
        points: Math.min(MAX_RULE_DEDUCTION, raw),
        occurrences: occurrences.length,
        capped: raw > MAX_RULE_DEDUCTION,
      };
    });
    const completedRules = analyzerResults
      .flatMap((result) => result.completedRules)
      .filter((ruleId) => ruleDimension(ruleId) === dimension)
      .sort();
    const skippedRules = analyzerResults
      .flatMap((result) => result.skippedRules)
      .filter((rule) => ruleDimension(rule.ruleId) === dimension);
    const deduction = deductions.reduce((sum, item) => sum + item.points, 0);
    return {
      dimension,
      assessmentState: skippedRules.length > 0 ? "partial" : "assessed",
      score: Math.max(0, 100 - deduction),
      policyVersion: SCORE_POLICY_VERSION,
      deductions,
      coverage: { completedRules, skippedRules },
    };
  });
}
