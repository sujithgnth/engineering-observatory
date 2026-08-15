import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { findDependencyAdvisories } from "./osv-advisories";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("OSV dependency adapter", () => {
  it("maps a recorded advisory response without installing repository dependencies", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "observatory-osv-"));
    roots.push(root);
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "node_modules/example-package": { version: "1.0.0" } },
      }),
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              vulns: [
                {
                  id: "GHSA-example",
                  summary: "Recorded test advisory",
                  database_specific: { severity: "HIGH" },
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await findDependencyAdvisories(root, fetchMock);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "security.dependency.osv-advisory",
      severity: "high",
    });
  });
});
