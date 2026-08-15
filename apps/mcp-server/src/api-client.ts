import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { z } from "zod";

import {
  AnalysisRecordSchema,
  ArchitectureGraphSchema,
  ChangeImpactSchema,
  DesktopRuntimeDiscoverySchema,
  FindingSchema,
  ProjectProfileSchema,
  RepositoryRecordSchema,
  ScorecardSchema,
} from "@engineering-observatory/shared-types";
import type {
  AnalysisRecord,
  ArchitectureGraph,
  ChangeImpact,
  Finding,
  ProjectProfile,
  RepositoryRecord,
  Scorecard,
} from "@engineering-observatory/shared-types";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:3333/api/v1";
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

const FindingsResponseSchema = z.object({
  items: z.array(FindingSchema),
  nextCursor: z.string().nullable(),
});

export interface ObservatoryReader {
  listRepositories(): Promise<RepositoryRecord[]>;
  listAnalyses(repositoryId: string): Promise<AnalysisRecord[]>;
  getAnalysis(analysisId: string): Promise<AnalysisRecord>;
  getProfile(analysisId: string): Promise<ProjectProfile>;
  getFindings(analysisId: string): Promise<Finding[]>;
  getScorecards(analysisId: string): Promise<Scorecard[]>;
  getArchitecture(analysisId: string): Promise<ArchitectureGraph>;
  getImpact(
    analysisId: string,
    selection: { nodeId?: string; filePath?: string },
  ): Promise<ChangeImpact>;
}

export function runtimeDiscoveryPath() {
  return path.join(
    homedir(),
    ".engineering-observatory",
    "desktop-runtime.json",
  );
}

export function validateLoopbackApiBaseUrl(value: string) {
  const url = new URL(value);
  const allowedHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (
    url.protocol !== "http:" ||
    !allowedHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.replace(/\/+$/, "") !== "/api/v1"
  ) {
    throw new Error(
      "OBSERVATORY_API_URL must be a credential-free loopback HTTP URL ending in /api/v1",
    );
  }
  return url.toString().replace(/\/+$/, "");
}

export async function resolveApiBaseUrl(
  configured = process.env.OBSERVATORY_API_URL,
  discoveryFile = runtimeDiscoveryPath(),
) {
  if (configured) return validateLoopbackApiBaseUrl(configured);
  try {
    const content = await readFile(discoveryFile, "utf8");
    if (content.length > 10_000) throw new Error("Runtime file is oversized");
    const runtime = DesktopRuntimeDiscoverySchema.parse(JSON.parse(content));
    return validateLoopbackApiBaseUrl(runtime.apiBaseUrl);
  } catch {
    return DEFAULT_API_BASE_URL;
  }
}

async function boundedBody(response: Response) {
  const declaredBytes = Number(response.headers.get("content-length") ?? 0);
  if (declaredBytes > MAX_RESPONSE_BYTES) {
    throw new Error("Observatory API response exceeds the MCP safety limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Observatory API response exceeds the MCP safety limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class HttpObservatoryReader implements ObservatoryReader {
  constructor(private readonly apiBaseUrl: string) {
    this.apiBaseUrl = validateLoopbackApiBaseUrl(apiBaseUrl);
  }

  private async get<T>(pathname: string, schema: z.ZodType<T>) {
    const response = await fetch(`${this.apiBaseUrl}${pathname}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await boundedBody(response);
    if (!response.ok) {
      let message = `Observatory API request failed with ${response.status}`;
      try {
        const parsed = JSON.parse(body) as { detail?: string; title?: string };
        message = parsed.detail ?? parsed.title ?? message;
      } catch {
        // Do not echo arbitrary HTML or upstream bodies into the model context.
      }
      throw new Error(message.slice(0, 500));
    }
    return schema.parse(JSON.parse(body)) as T;
  }

  listRepositories() {
    return this.get("/repositories", z.array(RepositoryRecordSchema));
  }

  listAnalyses(repositoryId: string) {
    return this.get(
      `/repositories/${encodeURIComponent(repositoryId)}/analyses`,
      z.array(AnalysisRecordSchema),
    );
  }

  getAnalysis(analysisId: string) {
    return this.get(
      `/analyses/${encodeURIComponent(analysisId)}`,
      AnalysisRecordSchema,
    );
  }

  getProfile(analysisId: string) {
    return this.get(
      `/analyses/${encodeURIComponent(analysisId)}/profile`,
      ProjectProfileSchema,
    );
  }

  async getFindings(analysisId: string) {
    return (
      await this.get(
        `/analyses/${encodeURIComponent(analysisId)}/findings`,
        FindingsResponseSchema,
      )
    ).items;
  }

  getScorecards(analysisId: string) {
    return this.get(
      `/analyses/${encodeURIComponent(analysisId)}/scorecards`,
      z.array(ScorecardSchema),
    );
  }

  getArchitecture(analysisId: string) {
    return this.get(
      `/analyses/${encodeURIComponent(analysisId)}/architecture`,
      ArchitectureGraphSchema,
    );
  }

  getImpact(
    analysisId: string,
    selection: { nodeId?: string; filePath?: string },
  ) {
    const search = new URLSearchParams();
    if (selection.nodeId) search.set("nodeId", selection.nodeId);
    if (selection.filePath) search.set("filePath", selection.filePath);
    return this.get(
      `/analyses/${encodeURIComponent(analysisId)}/impact?${search.toString()}`,
      ChangeImpactSchema,
    );
  }
}
