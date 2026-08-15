import type { ProjectProfile } from "@engineering-observatory/shared-types";

import type { Analyzer, AnalyzerContext, AnalyzerResult } from "./contracts";
import {
  createFinding,
  emptyResult,
  excerptAt,
  lineFor,
  loadTextFiles,
  textEvidence,
} from "./helpers";

const RULES = {
  unbounded: "database.query.unbounded-candidate",
  nPlusOne: "database.query.n-plus-one-candidate",
  missingIndex: "database.index.missing-candidate",
} as const;

export class DatabaseAnalyzer implements Analyzer {
  readonly id = "database-analyzer";
  readonly version = "1.0.0";

  isApplicable(profile: ProjectProfile): boolean {
    return profile.projects.some((project) => project.databases.length > 0);
  }

  async analyze(context: AnalyzerContext): Promise<AnalyzerResult> {
    const result = emptyResult(this.id, this.version);
    result.completedRules.push(...Object.values(RULES));
    const files = await loadTextFiles(context.repositoryRoot, [
      "**/*.{ts,js,prisma,sql}",
    ]);
    const allText = files.map((file) => file.text).join("\n");

    for (const file of files) {
      for (const match of file.text.matchAll(
        /\.(?:find|findMany|findAll)\s*\(([^;]*)/g,
      )) {
        const segment = match[0].slice(0, 500);
        if (/\b(?:take|limit|skip|page|cursor)\b/.test(segment)) continue;
        const index = match.index ?? 0;
        const line = lineFor(file.text, index);
        result.findings.push(
          createFinding({
            analyzerId: this.id,
            analyzerVersion: this.version,
            ruleId: RULES.unbounded,
            dimension: "scalability",
            severity: "medium",
            confidence: "medium",
            title: "Unbounded database query candidate",
            description:
              "A collection query has no detected result bound and may grow response time and memory use with table size.",
            location: { path: file.path, lineStart: line, lineEnd: line },
            evidence: textEvidence(
              "Supported query method without a nearby limit/take/cursor signal",
              excerptAt(file.text, index),
              [
                "An abstraction or database default may apply a limit outside the visible call.",
              ],
            ),
            remediation:
              "Carry a validated maximum limit or cursor into the query and test behavior at production-shaped cardinality.",
            scoreDeduction: 8,
            anchor: excerptAt(file.text, index),
          }),
        );
      }

      for (const loop of file.text.matchAll(
        /(?:for\s*\([^)]*\)|for\s+await\s*\([^)]*\)|\.map\s*\([^)]*)[\s\S]{0,600}?\.(?:find|findOne|query|execute)\s*\(/g,
      )) {
        const index = loop.index ?? 0;
        const line = lineFor(file.text, index);
        result.findings.push(
          createFinding({
            analyzerId: this.id,
            analyzerVersion: this.version,
            ruleId: RULES.nPlusOne,
            dimension: "scalability",
            severity: "high",
            confidence: "medium",
            title: "Query inside iteration is an N+1 candidate",
            description:
              "A database call appears inside an iteration, so query count may scale with the number of input records.",
            location: { path: file.path, lineStart: line, lineEnd: line },
            evidence: textEvidence(
              "Iteration and supported database call occur in the same bounded source region",
              excerptAt(file.text, index),
              [
                "Control flow and batching abstractions require human confirmation.",
              ],
            ),
            remediation:
              "Batch identifiers and fetch related records in one bounded query, or use a request-scoped batching mechanism.",
            scoreDeduction: 12,
            anchor: excerptAt(file.text, index),
          }),
        );
      }

      for (const query of file.text.matchAll(
        /\.find(?:One)?\s*\(\s*\{\s*([A-Za-z_$][\w$]*)\s*:/g,
      )) {
        const field = query[1];
        if (!field) continue;
        const indexPattern = new RegExp(
          `(?:index\\s*\\(\\s*\\{[^}]*\\b${field}\\b|${field}\\s*:\\s*\\{[^}]*index\\s*:\\s*true)`,
          "m",
        );
        if (indexPattern.test(allText)) continue;
        const index = query.index ?? 0;
        const line = lineFor(file.text, index);
        result.findings.push(
          createFinding({
            analyzerId: this.id,
            analyzerVersion: this.version,
            ruleId: RULES.missingIndex,
            dimension: "scalability",
            severity: "low",
            confidence: "low",
            title: `Index candidate for queried field “${field}”`,
            description:
              "The field is used in a supported MongoDB-style filter, but no matching visible index declaration was detected.",
            location: { path: file.path, lineStart: line, lineEnd: line },
            evidence: textEvidence(
              `Query filter begins with field ${field}; no supported index declaration was found`,
              excerptAt(file.text, index),
              [
                "Indexes may be managed outside the repository.",
                "Data distribution and query plans determine whether an index is beneficial.",
              ],
            ),
            remediation:
              "Inspect the real query plan and workload in an authorized test environment before adding or changing an index.",
            scoreDeduction: 2,
            anchor: field,
          }),
        );
      }
    }
    return result;
  }
}
