import { describe, expect, it } from "vitest";

import { CreateGithubRepositoryInputSchema } from "./index";

describe("CreateGithubRepositoryInputSchema", () => {
  it("normalizes a direct GitHub URL", () => {
    expect(
      CreateGithubRepositoryInputSchema.parse({
        repositoryUrl: "https://github.com/openai/openai-node.git/",
        ref: "v1.2.3",
      }),
    ).toEqual({ owner: "openai", name: "openai-node", ref: "v1.2.3" });
  });

  it("accepts a github.com shorthand and keeps the legacy API contract", () => {
    expect(
      CreateGithubRepositoryInputSchema.parse({
        repositoryUrl: "github.com/octocat/Hello-World",
      }),
    ).toEqual({ owner: "octocat", name: "Hello-World", ref: "main" });

    expect(
      CreateGithubRepositoryInputSchema.parse({
        owner: "octocat",
        name: "Hello-World",
        ref: "master",
      }),
    ).toEqual({ owner: "octocat", name: "Hello-World", ref: "master" });
  });

  it.each([
    "https://gitlab.com/owner/repository",
    "http://github.com/owner/repository",
    "https://token@github.com/owner/repository",
    "https://github.com/owner/repository/issues",
    "https://github.com/owner/repository?tab=readme",
  ])("rejects an unsafe or non-repository URL: %s", (repositoryUrl) => {
    expect(
      CreateGithubRepositoryInputSchema.safeParse({ repositoryUrl }).success,
    ).toBe(false);
  });
});
