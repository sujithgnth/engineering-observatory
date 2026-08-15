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
  validation: "nestjs.input-validation.missing",
  pagination: "backend.collection.pagination-missing",
  blocking: "node.request-path.blocking-operation",
  swallowedError: "backend.error.swallowed",
} as const;

export class BackendAnalyzer implements Analyzer {
  readonly id = "backend-analyzer";
  readonly version = "1.0.0";

  isApplicable(profile: ProjectProfile): boolean {
    return profile.projects.some((project) =>
      project.frameworks.some(
        (framework) => framework.name === "nestjs" || framework.name === "node",
      ),
    );
  }

  async analyze(context: AnalyzerContext): Promise<AnalyzerResult> {
    const result = emptyResult(this.id, this.version);
    result.completedRules.push(...Object.values(RULES));
    const files = await loadTextFiles(context.repositoryRoot, [
      "**/*.{ts,js,mjs,cjs}",
    ]);
    const globalValidation = files.some((file) =>
      /\bnew\s+ValidationPipe\s*\(/.test(file.text),
    );

    for (const file of files) {
      const isController = /@Controller\s*\(/.test(file.text);
      if (
        isController &&
        /@(Post|Put|Patch)\s*\(/.test(file.text) &&
        /@Body\s*\(/.test(file.text)
      ) {
        const bodyIndex = file.text.search(/@Body\s*\(/);
        const unsafeBodyType =
          /@Body\s*\([^)]*\)\s*\w+\s*(?::\s*(?:any|object|Record<[^>]+>))?/.test(
            file.text,
          );
        const localValidation =
          /(?:UsePipes\s*\(|ValidationPipe\s*\(|class-validator)/.test(
            file.text,
          );
        if (!globalValidation && !localValidation && unsafeBodyType) {
          const line = lineFor(file.text, bodyIndex);
          result.findings.push(
            createFinding({
              analyzerId: this.id,
              analyzerVersion: this.version,
              ruleId: RULES.validation,
              dimension: "security",
              severity: "high",
              confidence: "medium",
              title: "Request body lacks detected validation",
              description:
                "A mutating NestJS handler accepts a body without supported global, route-level, or DTO validation evidence.",
              location: { path: file.path, lineStart: line, lineEnd: line },
              evidence: textEvidence(
                "Body parameter on a mutating controller route with no supported validation signal",
                excerptAt(file.text, bodyIndex),
                [
                  "Custom validation abstractions outside supported NestJS patterns may not be detected.",
                ],
              ),
              remediation:
                "Use a typed DTO and an allow-listing validation boundary; verify transformation and rejection behavior with HTTP tests.",
              scoreDeduction: 10,
              anchor: excerptAt(file.text, bodyIndex),
            }),
          );
        }
      }

      if (isController) {
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
              ruleId: RULES.pagination,
              dimension: "scalability",
              severity: "high",
              confidence: "medium",
              title: "Collection query lacks detected pagination",
              description:
                "A controller path appears to load a collection without a supported limit, cursor, or page boundary.",
              location: { path: file.path, lineStart: line, lineEnd: line },
              evidence: textEvidence(
                "Collection query in controller without a detected bound",
                excerptAt(file.text, index),
                ["A service-layer default limit outside this call may exist."],
              ),
              remediation:
                "Enforce a maximum page size at the API boundary and carry a bounded limit/cursor to the database query.",
              scoreDeduction: 10,
              anchor: excerptAt(file.text, index),
            }),
          );
        }
      }

      for (const match of file.text.matchAll(
        /\b(?:readFileSync|writeFileSync|readdirSync|execSync|spawnSync|pbkdf2Sync|scryptSync)\s*\(/g,
      )) {
        const index = match.index ?? 0;
        const line = lineFor(file.text, index);
        result.findings.push(
          createFinding({
            analyzerId: this.id,
            analyzerVersion: this.version,
            ruleId: RULES.blocking,
            dimension: "scalability",
            severity: isController ? "high" : "medium",
            confidence: isController ? "high" : "medium",
            title: "Synchronous operation can block the Node.js event loop",
            description:
              "A synchronous I/O or CPU-heavy API is present and can delay unrelated requests when executed on a request path.",
            location: { path: file.path, lineStart: line, lineEnd: line },
            evidence: textEvidence(
              `Detected ${match[0].replace(/\s*\($/, "")}`,
              excerptAt(file.text, index),
              isController
                ? []
                : [
                    "The V1 analyzer cannot prove this function is reachable from a request.",
                  ],
            ),
            remediation:
              "Use the asynchronous API or move measured CPU-bound work to a bounded background execution boundary.",
            scoreDeduction: isController ? 10 : 6,
            anchor: match[0],
          }),
        );
      }

      for (const match of file.text.matchAll(
        /catch\s*(?:\([^)]*\))?\s*\{\s*(?:console\.[^(]+\([^)]*\);?\s*)?\}/g,
      )) {
        const index = match.index ?? 0;
        const line = lineFor(file.text, index);
        result.findings.push(
          createFinding({
            analyzerId: this.id,
            analyzerVersion: this.version,
            ruleId: RULES.swallowedError,
            dimension: "architecture",
            severity: "medium",
            confidence: "high",
            title: "Error is swallowed without recovery or propagation",
            description:
              "An empty or console-only catch block hides failure from callers and operational monitoring.",
            location: { path: file.path, lineStart: line, lineEnd: line },
            evidence: textEvidence(
              "Catch block has no recovery or rethrow",
              excerptAt(file.text, index),
            ),
            remediation:
              "Handle the expected failure explicitly or rethrow a safe domain error while preserving diagnostic context in structured logs.",
            scoreDeduction: 5,
            anchor: excerptAt(file.text, index),
          }),
        );
      }
    }
    return result;
  }
}
