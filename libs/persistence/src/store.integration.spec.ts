import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ObservatoryStore } from "./store";

const enabled =
  process.env.RUN_DB_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL);

describe.runIf(enabled)("ObservatoryStore durable job leasing", () => {
  let store: ObservatoryStore;
  const jobTargets: string[] = [];
  const repositoryIds: string[] = [];

  beforeAll(() => {
    store = ObservatoryStore.fromEnvironment();
  });

  afterAll(async () => {
    if (jobTargets.length > 0) {
      await store.pool.query(
        "DELETE FROM jobs WHERE target_id = ANY($1::uuid[])",
        [jobTargets],
      );
    }
    if (repositoryIds.length > 0) {
      await store.pool.query(
        "DELETE FROM repositories WHERE id = ANY($1::uuid[])",
        [repositoryIds],
      );
    }
    await store.close();
  });

  it("leases a queued analysis exactly once and persists completion", async () => {
    const source = await store.createRepositoryWithSnapshot({
      displayName: "PostgreSQL integration fixture",
      sourceKind: "archive",
      artifactPath: "/tmp/integration-fixture.tgz",
      archiveSha256: randomUUID().replaceAll("-", ""),
    });
    repositoryIds.push(source.repository.id);
    const analysis = await store.createAnalysis(
      source.snapshot.id,
      "rules-test",
      "score-test",
    );
    jobTargets.push(analysis.id);

    const lease = await store.leaseJob(`integration-${randomUUID()}`, [
      "analysis",
    ]);
    expect(lease).toMatchObject({
      jobType: "analysis",
      targetId: analysis.id,
      attempt: 1,
    });
    await store.completeJob(lease!.id);

    const result = await store.pool.query(
      "SELECT state FROM jobs WHERE id = $1",
      [lease!.id],
    );
    expect(result.rows[0]?.state).toBe("completed");
  });
});
