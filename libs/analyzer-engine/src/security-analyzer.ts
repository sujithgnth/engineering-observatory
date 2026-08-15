import { createHash } from "node:crypto";

import type { Severity } from "@engineering-observatory/shared-types";

import type { Analyzer, AnalyzerContext, AnalyzerResult } from "./contracts";
import {
  createFinding,
  emptyResult,
  excerptAt,
  lineFor,
  loadTextFiles,
  textEvidence,
} from "./helpers";
import { findDependencyAdvisories } from "./osv-advisories";

const RULES = {
  secret: "security.secret.exposed-candidate",
  dynamicCode: "security.dynamic-code.execution",
  tls: "security.tls.verification-disabled",
  cors: "security.cors.wildcard",
  dependency: "security.dependency.osv-advisory",
} as const;

const SECRET_PATTERNS: Array<{
  name: string;
  regex: RegExp;
  severity: Severity;
}> = [
  {
    name: "GitHub token",
    regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    severity: "critical",
  },
  {
    name: "AWS access key",
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    severity: "critical",
  },
  {
    name: "Private key",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    severity: "critical",
  },
  {
    name: "Assigned secret",
    regex:
      /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)\b\s*[:=]\s*["']([^"']{16,})["']/gi,
    severity: "high",
  },
];

function redactedSecret(value: string) {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return `${value.slice(0, 4)}…${value.slice(-2)} (sha256:${digest})`;
}

export class SecurityAnalyzer implements Analyzer {
  readonly id = "security-analyzer";
  readonly version = "1.0.0";

  isApplicable(): boolean {
    return true;
  }

  async analyze(context: AnalyzerContext): Promise<AnalyzerResult> {
    const result = emptyResult(this.id, this.version);
    result.completedRules.push(...Object.values(RULES));
    const files = await loadTextFiles(context.repositoryRoot);

    for (const file of files) {
      for (const pattern of SECRET_PATTERNS) {
        pattern.regex.lastIndex = 0;
        for (const match of file.text.matchAll(pattern.regex)) {
          const matchedSecret = match[1] ?? match[0];
          if (
            /example|placeholder|change[-_]?me|your[-_]?/i.test(matchedSecret)
          )
            continue;
          const index = match.index ?? 0;
          const line = lineFor(file.text, index);
          result.findings.push(
            createFinding({
              analyzerId: this.id,
              analyzerVersion: this.version,
              ruleId: RULES.secret,
              dimension: "security",
              severity: pattern.severity,
              confidence:
                pattern.name === "Assigned secret" ? "medium" : "high",
              title: `${pattern.name} detected in repository content`,
              description:
                "A credential-shaped value is present in source content. The stored evidence is redacted and does not validate the credential.",
              location: { path: file.path, lineStart: line, lineEnd: line },
              evidence: {
                kind: "text-pattern",
                observed: `${pattern.name}: ${redactedSecret(matchedSecret)}`,
                values: { secretType: pattern.name },
                limitations: [
                  "The scanner does not test whether the value is active.",
                ],
              },
              remediation:
                "Revoke/rotate the credential through its provider, remove it from history where required, and use a secret store.",
              scoreDeduction: pattern.severity === "critical" ? 20 : 12,
              anchor: `${pattern.name}:${createHash("sha256").update(matchedSecret).digest("hex")}`,
            }),
          );
        }
      }

      for (const match of file.text.matchAll(/\b(?:eval|Function)\s*\(/g)) {
        const index = match.index ?? 0;
        const line = lineFor(file.text, index);
        result.findings.push(
          createFinding({
            analyzerId: this.id,
            analyzerVersion: this.version,
            ruleId: RULES.dynamicCode,
            dimension: "security",
            severity: "high",
            confidence: "high",
            title: "Dynamic code execution primitive detected",
            description:
              "Dynamic JavaScript evaluation can turn untrusted strings into executable code.",
            location: { path: file.path, lineStart: line, lineEnd: line },
            evidence: textEvidence(
              "Detected eval/Function invocation",
              excerptAt(file.text, index),
            ),
            remediation:
              "Replace string evaluation with an allow-listed parser or explicit dispatch table and test hostile input.",
            scoreDeduction: 12,
            anchor: excerptAt(file.text, index),
          }),
        );
      }

      for (const match of file.text.matchAll(
        /(?:rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0)/g,
      )) {
        const index = match.index ?? 0;
        const line = lineFor(file.text, index);
        result.findings.push(
          createFinding({
            analyzerId: this.id,
            analyzerVersion: this.version,
            ruleId: RULES.tls,
            dimension: "security",
            severity: "critical",
            confidence: "high",
            title: "TLS certificate verification is disabled",
            description:
              "The configuration permits connections without authenticating the remote certificate.",
            location: { path: file.path, lineStart: line, lineEnd: line },
            evidence: textEvidence(
              "Detected explicit TLS verification disablement",
              excerptAt(file.text, index),
            ),
            remediation:
              "Remove the bypass and install the correct trusted CA chain for the intended environment.",
            scoreDeduction: 20,
            anchor: match[0],
          }),
        );
      }

      for (const match of file.text.matchAll(
        /(?:origin\s*:\s*["']\*["']|Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*)/g,
      )) {
        const index = match.index ?? 0;
        const line = lineFor(file.text, index);
        result.findings.push(
          createFinding({
            analyzerId: this.id,
            analyzerVersion: this.version,
            ruleId: RULES.cors,
            dimension: "security",
            severity: "medium",
            confidence: "high",
            title: "Wildcard CORS origin detected",
            description:
              "The configuration appears to allow browser requests from every origin and may expose authenticated or sensitive APIs.",
            location: { path: file.path, lineStart: line, lineEnd: line },
            evidence: textEvidence(
              "Detected wildcard CORS origin",
              excerptAt(file.text, index),
            ),
            remediation:
              "Use an environment-specific origin allow-list and test allowed, denied, preflight, and credentialed requests.",
            scoreDeduction: 8,
            anchor: match[0],
          }),
        );
      }
    }

    try {
      const advisories = await findDependencyAdvisories(context.repositoryRoot);
      result.findings.push(...advisories.findings);
      result.warnings.push(...advisories.warnings);
      if (advisories.warnings.length > 0) {
        result.completedRules.splice(
          result.completedRules.indexOf(RULES.dependency),
          1,
        );
        result.skippedRules.push({
          ruleId: RULES.dependency,
          reason: advisories.warnings.join("; "),
        });
      }
    } catch {
      result.completedRules.splice(
        result.completedRules.indexOf(RULES.dependency),
        1,
      );
      result.skippedRules.push({
        ruleId: RULES.dependency,
        reason:
          "OSV advisory lookup was unavailable; dependency health is unknown",
      });
    }
    return result;
  }
}
