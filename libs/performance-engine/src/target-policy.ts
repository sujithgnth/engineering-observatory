import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { PerformanceScenarioInput } from "@engineering-observatory/shared-types";

export type TargetPolicyOptions = {
  allowPrivateTargets: boolean;
  allowedPorts: number[];
  maxConcurrency: number;
  maxDurationSeconds: number;
};

function defaultPolicy(): TargetPolicyOptions {
  return {
    allowPrivateTargets:
      process.env.ALLOW_PRIVATE_PERFORMANCE_TARGETS === "true",
    allowedPorts: [80, 443, 8443],
    maxConcurrency: Number(process.env.MAX_PERFORMANCE_CONCURRENCY ?? 1_000),
    maxDurationSeconds: Number(
      process.env.MAX_PERFORMANCE_DURATION_SECONDS ?? 300,
    ),
  };
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  const [a, b] = parts;
  if (parts.length !== 4 || a === undefined || b === undefined) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized =
    address.toLowerCase().split("%")[0] ?? address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

export function isPrivateOrReservedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

export class PerformanceTargetPolicy {
  constructor(
    private readonly options: TargetPolicyOptions = defaultPolicy(),
  ) {}

  async validate(scenario: PerformanceScenarioInput): Promise<URL> {
    const url = new URL(scenario.target.path, scenario.target.origin);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("target_protocol_rejected");
    if (url.username || url.password)
      throw new Error("target_credentials_in_url_rejected");
    if (url.hash) throw new Error("target_fragment_rejected");
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    if (
      !this.options.allowedPorts.includes(port) &&
      !this.options.allowPrivateTargets
    ) {
      throw new Error("target_port_rejected");
    }
    if (
      [
        "localhost",
        "localhost.localdomain",
        "metadata.google.internal",
      ].includes(url.hostname)
    ) {
      if (!this.options.allowPrivateTargets)
        throw new Error("target_private_address_rejected");
    }
    const records = await lookup(url.hostname, { all: true, verbatim: true });
    if (records.length === 0) throw new Error("target_dns_failed");
    if (
      !this.options.allowPrivateTargets &&
      records.some((record) => isPrivateOrReservedAddress(record.address))
    ) {
      throw new Error("target_private_address_rejected");
    }
    const concurrency =
      scenario.tool === "k6"
        ? scenario.load.virtualUsers
        : scenario.load.connections;
    if (concurrency > this.options.maxConcurrency)
      throw new Error("load_concurrency_rejected");
    if (scenario.load.durationSeconds > this.options.maxDurationSeconds) {
      throw new Error("load_duration_rejected");
    }
    return url;
  }
}
