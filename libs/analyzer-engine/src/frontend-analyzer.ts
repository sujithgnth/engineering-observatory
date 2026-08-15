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
  largeComponent: "frontend.component.large",
  complexity: "frontend.complexity.excessive",
  inlineObject: "react.render.inline-object-prop",
  eagerRoute: "frontend.route.eager-loading-candidate",
} as const;

function hasFrontend(profile: ProjectProfile) {
  return profile.projects.some((project) =>
    project.frameworks.some(
      (framework) => framework.name === "react" || framework.name === "angular",
    ),
  );
}

function complexity(text: string): number {
  const matches = text.match(/\b(?:if|for|while|case|catch)\b|\?|&&|\|\|/g);
  return 1 + (matches?.length ?? 0);
}

export class FrontendAnalyzer implements Analyzer {
  readonly id = "frontend-analyzer";
  readonly version = "1.0.0";

  isApplicable(profile: ProjectProfile): boolean {
    return hasFrontend(profile);
  }

  async analyze(context: AnalyzerContext): Promise<AnalyzerResult> {
    const result = emptyResult(this.id, this.version);
    result.completedRules.push(...Object.values(RULES));
    const files = await loadTextFiles(context.repositoryRoot, [
      "**/*.{ts,tsx,js,jsx}",
    ]);

    for (const file of files) {
      const lines = file.text.split("\n").length;
      const containsView = /<[A-Z_a-z][^>]*>|@Component\s*\(/.test(file.text);
      if (containsView && lines > 300) {
        result.findings.push(
          createFinding({
            analyzerId: this.id,
            analyzerVersion: this.version,
            ruleId: RULES.largeComponent,
            dimension: "architecture",
            severity: lines > 600 ? "high" : "medium",
            confidence: "high",
            title: "Large frontend component",
            description: `The component spans ${lines} lines, increasing review, test, and change-isolation cost.`,
            location: { path: file.path, lineStart: 1, lineEnd: lines },
            evidence: {
              kind: "text-pattern",
              observed: `${lines} lines in a file containing component/view evidence`,
              values: { lines },
              limitations: [
                "Line count is a maintainability signal, not proof of poor design.",
              ],
            },
            remediation:
              "Separate cohesive UI, state, and data-loading responsibilities while preserving public behavior and tests.",
            scoreDeduction: 8,
            anchor: "component-file",
          }),
        );
      }

      const fileComplexity = complexity(file.text);
      if (fileComplexity > 18) {
        result.findings.push(
          createFinding({
            analyzerId: this.id,
            analyzerVersion: this.version,
            ruleId: RULES.complexity,
            dimension: "architecture",
            severity: fileComplexity > 35 ? "high" : "medium",
            confidence: "medium",
            title: "High decision complexity in frontend source",
            description: `The file contains an estimated decision complexity of ${fileComplexity}.`,
            location: { path: file.path, lineStart: 1, lineEnd: lines },
            evidence: {
              kind: "ast",
              observed:
                "Decision constructs exceed the reviewed file-level threshold",
              values: { complexity: fileComplexity, threshold: 18 },
              limitations: [
                "The V1 metric is file-level and does not replace function-level cognitive-complexity review.",
              ],
            },
            remediation:
              "Extract decision-heavy behavior into named functions and add focused tests around each branch boundary.",
            scoreDeduction: 6,
            anchor: "file-complexity",
          }),
        );
      }

      for (const match of file.text.matchAll(
        /\b[A-Za-z_$][\w$]*=\{\{[^}]+\}\}/g,
      )) {
        const index = match.index ?? 0;
        const line = lineFor(file.text, index);
        result.findings.push(
          createFinding({
            analyzerId: this.id,
            analyzerVersion: this.version,
            ruleId: RULES.inlineObject,
            dimension: "performance",
            severity: "low",
            confidence: "medium",
            title: "Inline object prop can destabilize memoized children",
            description:
              "A new object reference is created during render and may defeat memoization when the child relies on reference equality.",
            location: { path: file.path, lineStart: line, lineEnd: line },
            evidence: textEvidence(
              "JSX prop contains an inline object literal",
              excerptAt(file.text, index),
              [
                "This matters only when the receiving component uses referential equality or expensive effects.",
              ],
            ),
            remediation:
              "Measure the render path first; if material, hoist stable values or memoize at the narrowest useful boundary.",
            scoreDeduction: null,
            anchor: match[0],
          }),
        );
      }

      if (
        /\b(?:Routes|RouterModule\.forRoot|RouterModule\.forChild)\b/.test(
          file.text,
        )
      ) {
        for (const match of file.text.matchAll(
          /\bcomponent\s*:\s*([A-Za-z_$][\w$]*)/g,
        )) {
          if (/\b(?:loadComponent|loadChildren)\s*:/.test(file.text)) continue;
          const index = match.index ?? 0;
          const line = lineFor(file.text, index);
          result.findings.push(
            createFinding({
              analyzerId: this.id,
              analyzerVersion: this.version,
              ruleId: RULES.eagerRoute,
              dimension: "scalability",
              severity: "low",
              confidence: "medium",
              title: "Eager route is a lazy-loading candidate",
              description: `Route component ${match[1] ?? "unknown"} is referenced eagerly in the route configuration.`,
              location: { path: file.path, lineStart: line, lineEnd: line },
              evidence: textEvidence(
                "Route configuration uses a component reference without a detected lazy loader",
                excerptAt(file.text, index),
                ["Small or entry-critical routes may be better kept eager."],
              ),
              remediation:
                "Compare route bundle cost and navigation requirements before introducing a framework-supported lazy boundary.",
              scoreDeduction: 3,
              anchor: match[1] ?? match[0],
            }),
          );
        }
      }
    }
    return result;
  }
}
