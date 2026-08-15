import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveApiBaseUrl, validateLoopbackApiBaseUrl } from "./api-client";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("MCP API boundary", () => {
  it("accepts only credential-free loopback API URLs", () => {
    expect(validateLoopbackApiBaseUrl("http://127.0.0.1:43123/api/v1/")).toBe(
      "http://127.0.0.1:43123/api/v1",
    );
    expect(() =>
      validateLoopbackApiBaseUrl("https://example.com/api/v1"),
    ).toThrow(/loopback/);
    expect(() =>
      validateLoopbackApiBaseUrl("http://user:secret@127.0.0.1:3333/api/v1"),
    ).toThrow(/credential-free/);
  });

  it("discovers the active Electron API from the bounded runtime contract", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "observatory-mcp-"));
    temporaryDirectories.push(directory);
    const runtimeFile = path.join(directory, "runtime.json");
    await writeFile(
      runtimeFile,
      JSON.stringify({
        schemaVersion: "engineering-observatory-desktop-runtime-v1",
        pid: process.pid,
        apiBaseUrl: "http://127.0.0.1:45678/api/v1",
        updatedAt: new Date().toISOString(),
      }),
    );
    await expect(resolveApiBaseUrl(undefined, runtimeFile)).resolves.toBe(
      "http://127.0.0.1:45678/api/v1",
    );
  });
});
