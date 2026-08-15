import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import type { PerformanceScenarioInput } from "@engineering-observatory/shared-types";

import { AutocannonDriver } from "./drivers";
import {
  isPrivateOrReservedAddress,
  PerformanceTargetPolicy,
} from "./target-policy";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

function scenario(origin: string): PerformanceScenarioInput {
  return {
    repositoryId: "00000000-0000-4000-8000-000000000001",
    analysisId: null,
    name: "controlled test",
    tool: "autocannon",
    target: { origin, path: "/health", method: "GET", headers: {}, body: null },
    load: { connections: 2, durationSeconds: 1, pipelining: 1 },
    thresholds: { p95LatencyMs: 500, errorRatePercent: 1 },
    authorizationConfirmed: true,
  };
}

describe("performance target policy", () => {
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fd00::1"])(
    "classifies %s as private or reserved",
    (address) => expect(isPrivateOrReservedAddress(address)).toBe(true),
  );

  it("rejects loopback by default", async () => {
    const policy = new PerformanceTargetPolicy({
      allowPrivateTargets: false,
      allowedPorts: [80, 443],
      maxConcurrency: 100,
      maxDurationSeconds: 10,
    });
    await expect(policy.validate(scenario("http://127.0.0.1"))).rejects.toThrow(
      "target_private_address_rejected",
    );
  });

  it("runs autocannon against an explicitly allowed controlled local target", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    closers.push(() => new Promise((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("test_server_address_missing");
    const input = scenario(`http://127.0.0.1:${address.port}`);
    const policy = new PerformanceTargetPolicy({
      allowPrivateTargets: true,
      allowedPorts: [address.port],
      maxConcurrency: 10,
      maxDurationSeconds: 5,
    });
    const target = await policy.validate(input);
    const result = await new AutocannonDriver().run(input, target);

    expect(result.metrics.completedRequests).toBeGreaterThan(0);
    expect(result.metrics.errorRatePercent).toBe(0);
    expect(result.achievedLoad.peakConnections).toBe(2);
  });
});
