import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { scanRepository } from "@engineering-observatory/scanners";

import { AnalyzerEngine } from "./engine";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true })),
  );
});

describe("AnalyzerEngine", () => {
  it("produces deterministic evidence while redacting a detected secret", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "observatory-analyzer-"));
    workspaces.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "risky-service",
        dependencies: { "@nestjs/core": "11.0.0", mongoose: "9.0.0" },
      }),
    );
    const canarySecret = "AKIA1234567890ABCDEF";
    await writeFile(
      path.join(root, "src/orders.controller.ts"),
      `@Controller('orders')\nexport class OrdersController {\n@Get()\nlist() { return db.orders.find({ tenantId: 'x' }); }\nrun() { return readFileSync('/tmp/x'); }\n}\nconst access = '${canarySecret}';\n`,
    );
    const snapshotId = randomUUID();
    const profile = await scanRepository(root, snapshotId);

    const first = await new AnalyzerEngine().analyze(root, profile);
    const second = await new AnalyzerEngine().analyze(root, profile);

    expect(first.findings.map((finding) => finding.fingerprint)).toEqual(
      second.findings.map((finding) => finding.fingerprint),
    );
    expect(
      first.findings.some(
        (finding) => finding.ruleId === "node.request-path.blocking-operation",
      ),
    ).toBe(true);
    const secretFinding = first.findings.find(
      (finding) => finding.ruleId === "security.secret.exposed-candidate",
    );
    expect(secretFinding).toBeDefined();
    expect(JSON.stringify(secretFinding)).not.toContain(canarySecret);
    expect(first.scorecards).toHaveLength(3);
    expect(
      first.scorecards.find((score) => score.dimension === "architecture")
        ?.assessmentState,
    ).toBe("assessed");
    expect(
      first.scorecards.find((score) => score.dimension === "security")
        ?.assessmentState,
    ).toBe("partial");
    expect(
      first.scorecards.find((score) => score.dimension === "scalability")
        ?.assessmentState,
    ).toBe("assessed");
  });
});
