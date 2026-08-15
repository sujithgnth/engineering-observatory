import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { Evidence, Finding } from "@engineering-observatory/shared-types";
import fg from "fast-glob";

import { repositoryIgnorePatterns } from "@engineering-observatory/scanners";

import type { AnalyzerResult } from "./contracts";

export type FindingInput = Omit<Finding, "fingerprint"> & { anchor?: string };

export function createFinding(input: FindingInput): Finding {
  const normalizedPath = input.location.path.replaceAll("\\", "/");
  const fingerprint = createHash("sha256")
    .update(
      `${input.ruleId}|${normalizedPath}|${input.anchor ?? input.evidence.observed}`,
    )
    .digest("hex");
  const { anchor, ...finding } = input;
  void anchor;
  return { ...finding, fingerprint };
}

export function lineFor(text: string, index: number): number {
  return text.slice(0, Math.max(0, index)).split("\n").length;
}

export function excerptAt(
  text: string,
  index: number,
  maxLength = 240,
): string {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const nextLine = text.indexOf("\n", index);
  const lineEnd = nextLine < 0 ? text.length : nextLine;
  return text.slice(lineStart, lineEnd).trim().slice(0, maxLength);
}

export function textEvidence(
  observed: string,
  excerpt: string,
  limitations: string[] = [],
): Evidence {
  return {
    kind: "text-pattern",
    observed,
    excerpt,
    values: {},
    limitations,
  };
}

export async function loadTextFiles(
  root: string,
  patterns = [
    "**/*.{ts,tsx,js,jsx,mjs,cjs,json,yml,yaml,env,properties}",
    "**/.env*",
  ],
): Promise<Array<{ path: string; text: string }>> {
  const paths = await fg(patterns, {
    cwd: root,
    absolute: false,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: repositoryIgnorePatterns,
  });
  const files: Array<{ path: string; text: string }> = [];
  for (const relativePath of paths.sort()) {
    const absolutePath = path.join(root, relativePath);
    const fileStats = await stat(absolutePath);
    if (fileStats.size > 1_000_000) continue;
    const text = await readFile(absolutePath, "utf8").catch(() => null);
    if (text !== null)
      files.push({ path: relativePath.replaceAll(path.sep, "/"), text });
  }
  return files;
}

export function emptyResult(
  analyzerId: string,
  analyzerVersion: string,
): AnalyzerResult {
  return {
    analyzerId,
    analyzerVersion,
    findings: [],
    completedRules: [],
    skippedRules: [],
    warnings: [],
  };
}
