import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type {
  Finding,
  ProjectProfile,
  Scorecard,
} from "@engineering-observatory/shared-types";

import { ObservatoryStore } from "./store";

describe("ObservatoryStore JSON boundaries", () => {
  it("serializes JSON arrays before sending them to PostgreSQL jsonb columns", async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const client = {
      query: vi.fn(async (text: string, values: unknown[] = []) => {
        queries.push({ text, values });
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
    } as unknown as Pool;
    const store = new ObservatoryStore(pool);
    const analysisId = randomUUID();
    const profile: ProjectProfile = {
      schemaVersion: "project-profile-v1",
      scannerVersion: "1.0.0",
      snapshotId: randomUUID(),
      repositoryRoot: ".",
      monorepo: false,
      workspaceTool: null,
      packageManager: "npm",
      projects: [],
      analyzedFileCount: 1,
      excludedFileCount: 0,
      analyzedBytes: 10,
      architectureEdges: [],
      coverage: { completed: ["manifest"], skipped: [], warnings: [] },
    };
    const finding: Finding = {
      fingerprint: "a".repeat(64),
      analyzerId: "test",
      analyzerVersion: "1.0.0",
      ruleId: "backend.error.swallowed",
      dimension: "architecture",
      severity: "medium",
      confidence: "high",
      title: "Test finding",
      description: "Regression fixture",
      location: { path: "src/test.ts", lineStart: 1, lineEnd: 1 },
      evidence: {
        kind: "text-pattern",
        observed: "test evidence",
        values: {},
        limitations: [],
      },
      remediation: "Handle the failure.",
      scoreDeduction: 5,
    };
    const scorecard: Scorecard = {
      dimension: "architecture",
      assessmentState: "assessed",
      score: 95,
      policyVersion: "score-v1",
      deductions: [
        {
          ruleId: finding.ruleId,
          points: 5,
          occurrences: 1,
          capped: false,
        },
      ],
      coverage: { completedRules: [finding.ruleId], skippedRules: [] },
    };

    await store.saveAnalysisResult(
      analysisId,
      profile,
      [finding],
      [scorecard],
      ["bounded warning"],
    );

    const profileInsert = queries.find((query) =>
      query.text.includes("INSERT INTO project_profiles"),
    );
    const findingInsert = queries.find((query) =>
      query.text.includes("INSERT INTO findings"),
    );
    const scoreInsert = queries.find((query) =>
      query.text.includes("INSERT INTO scorecards"),
    );
    const completion = queries.find((query) =>
      query.text.includes("UPDATE analyses SET"),
    );

    expect(JSON.parse(profileInsert?.values[1] as string)).toEqual(profile);
    expect(JSON.parse(findingInsert?.values[14] as string)).toEqual(
      finding.evidence,
    );
    expect(JSON.parse(scoreInsert?.values[6] as string)).toEqual(
      scorecard.deductions,
    );
    expect(JSON.parse(scoreInsert?.values[7] as string)).toEqual(
      scorecard.coverage,
    );
    expect(JSON.parse(completion?.values[2] as string)).toEqual([
      "bounded warning",
    ]);
  });
});
