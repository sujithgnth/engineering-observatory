import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Finding, Severity } from "@engineering-observatory/shared-types";

import { createFinding } from "./helpers";

type LockPackage = { name?: string; version?: string; dev?: boolean };
type PackageLock = { packages?: Record<string, LockPackage> };
type OsvVulnerability = {
  id: string;
  summary?: string;
  aliases?: string[];
  database_specific?: { severity?: string };
};
type OsvBatchResponse = { results?: Array<{ vulns?: OsvVulnerability[] }> };

function packageName(lockPath: string, metadata: LockPackage): string | null {
  if (metadata.name) return metadata.name;
  const marker = "node_modules/";
  const index = lockPath.lastIndexOf(marker);
  if (index < 0) return null;
  const remainder = lockPath.slice(index + marker.length);
  if (remainder.startsWith("@"))
    return remainder.split("/").slice(0, 2).join("/");
  return remainder.split("/")[0] ?? null;
}

function severityFor(vulnerability: OsvVulnerability): Severity {
  const severity = vulnerability.database_specific?.severity?.toLowerCase();
  if (
    severity === "critical" ||
    severity === "high" ||
    severity === "medium" ||
    severity === "low"
  ) {
    return severity;
  }
  return "medium";
}

export async function findDependencyAdvisories(
  repositoryRoot: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ findings: Finding[]; warnings: string[] }> {
  const lockPath = path.join(repositoryRoot, "package-lock.json");
  const raw = await readFile(lockPath, "utf8").catch(() => null);
  if (!raw)
    return {
      findings: [],
      warnings: ["No root package-lock.json available for OSV lookup"],
    };
  const lock = JSON.parse(raw) as PackageLock;
  const dependencies = Object.entries(lock.packages ?? {})
    .flatMap(([entryPath, metadata]) => {
      const name = packageName(entryPath, metadata);
      return name && metadata.version && !metadata.dev
        ? [{ name, version: metadata.version }]
        : [];
    })
    .filter(
      (dependency, index, list) =>
        list.findIndex(
          (candidate) =>
            candidate.name === dependency.name &&
            candidate.version === dependency.version,
        ) === index,
    )
    .slice(0, 500);
  if (dependencies.length === 0) return { findings: [], warnings: [] };

  const response = await fetchImpl("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      queries: dependencies.map((dependency) => ({
        package: { ecosystem: "npm", name: dependency.name },
        version: dependency.version,
      })),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("osv_lookup_failed");
  const body = (await response.json()) as OsvBatchResponse;
  const findings: Finding[] = [];
  for (const [index, result] of (body.results ?? []).entries()) {
    const dependency = dependencies[index];
    if (!dependency) continue;
    for (const vulnerability of result.vulns ?? []) {
      const severity = severityFor(vulnerability);
      findings.push(
        createFinding({
          analyzerId: "security-analyzer",
          analyzerVersion: "1.0.0",
          ruleId: "security.dependency.osv-advisory",
          dimension: "security",
          severity,
          confidence: "high",
          title: `${dependency.name}@${dependency.version} matches ${vulnerability.id}`,
          description:
            vulnerability.summary ??
            "The locked dependency version matches a published OSV advisory.",
          location: {
            path: "package-lock.json",
            lineStart: null,
            lineEnd: null,
          },
          evidence: {
            kind: "advisory",
            observed: `${dependency.name}@${dependency.version} returned advisory ${vulnerability.id}`,
            values: {
              package: dependency.name,
              version: dependency.version,
              advisoryId: vulnerability.id,
            },
            limitations: [
              "Advisory data changes over time and a version match does not prove the vulnerable code path is reachable.",
            ],
          },
          remediation:
            "Review the advisory and dependency path, then upgrade or mitigate using the smallest compatible tested change.",
          scoreDeduction:
            severity === "critical" ? 15 : severity === "high" ? 10 : 5,
          anchor: `${dependency.name}@${dependency.version}:${vulnerability.id}`,
        }),
      );
    }
  }
  return { findings, warnings: [] };
}
