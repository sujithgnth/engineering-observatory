import { Octokit } from "@octokit/rest";

import type { LocalArtifactStore } from "./archive";

export type GithubRepositoryInput = {
  owner: string;
  name: string;
  ref: string;
};

export class GithubSourceAdapter {
  private readonly octokit: Octokit;

  constructor(
    private readonly artifacts: LocalArtifactStore,
    token = process.env.GITHUB_TOKEN,
  ) {
    this.octokit = new Octokit(token ? { auth: token } : {});
  }

  async acquire(input: GithubRepositoryInput) {
    const repository = await this.octokit.rest.repos.get({
      owner: input.owner,
      repo: input.name,
    });
    const commit = await this.octokit.rest.repos.getCommit({
      owner: input.owner,
      repo: input.name,
      ref: input.ref,
    });
    const response = await this.octokit.rest.repos.downloadTarballArchive({
      owner: input.owner,
      repo: input.name,
      ref: commit.data.sha,
    });
    const raw = response.data;
    const bytes =
      raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : ArrayBuffer.isView(raw)
          ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
          : typeof raw === "string"
            ? new TextEncoder().encode(raw)
            : new Uint8Array(raw as ArrayBuffer);
    const stored = await this.artifacts.put(
      `${input.owner}-${input.name}.tar.gz`,
      bytes,
    );
    return {
      displayName: `${input.owner}/${input.name}`,
      providerRepositoryId: String(repository.data.id),
      commitSha: commit.data.sha,
      resolvedRef: input.ref,
      artifactPath: stored.path,
    };
  }
}
