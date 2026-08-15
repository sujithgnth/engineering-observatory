import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import { providerAvailability } from "@engineering-observatory/ai-adapter";
import { ObservatoryStore } from "@engineering-observatory/persistence";
import {
  GithubSourceAdapter,
  LocalArtifactStore,
} from "@engineering-observatory/scanners";
import {
  CreateAnalysisInputSchema,
  CreateGithubRepositoryInputSchema,
  RULE_SET_VERSION,
  SCORE_POLICY_VERSION,
} from "@engineering-observatory/shared-types";

import { ARTIFACT_STORE, STORE } from "./tokens";
import { parseRequest } from "./validation";

function publicSnapshot<T extends { artifactPath: string }>(snapshot: T) {
  const { artifactPath, ...safe } = snapshot;
  void artifactPath;
  return safe;
}

@Controller()
export class RepositoriesController {
  constructor(
    @Inject(STORE) private readonly store: ObservatoryStore,
    @Inject(ARTIFACT_STORE) private readonly artifacts: LocalArtifactStore,
  ) {}

  @Get("repositories")
  listRepositories() {
    return this.store.listRepositories();
  }

  @Post("repositories/archive")
  @UseInterceptors(
    FileInterceptor("archive", {
      limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 3 },
    }),
  )
  async uploadArchive(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("displayName") displayName?: string,
  ) {
    if (!file) throw new BadRequestException("archive is required");
    const stored = await this.artifacts.put(file.originalname, file.buffer);
    try {
      const created = await this.store.createRepositoryWithSnapshot({
        displayName: displayName?.trim() || file.originalname,
        sourceKind: "archive",
        artifactPath: stored.path,
        archiveSha256: stored.sha256,
      });
      return {
        repository: created.repository,
        snapshot: publicSnapshot(created.snapshot),
      };
    } catch (error) {
      await this.artifacts.delete(stored.path).catch(() => undefined);
      throw error;
    }
  }

  @Post("repositories/github")
  async connectGithub(@Body() body: unknown) {
    const input = parseRequest(CreateGithubRepositoryInputSchema, body);
    const source = new GithubSourceAdapter(this.artifacts);
    const acquired = await source.acquire(input);
    try {
      const created = await this.store.createRepositoryWithSnapshot({
        displayName: acquired.displayName,
        sourceKind: "github",
        artifactPath: acquired.artifactPath,
        commitSha: acquired.commitSha,
        resolvedRef: acquired.resolvedRef,
        providerRepositoryId: acquired.providerRepositoryId,
      });
      return {
        repository: created.repository,
        snapshot: publicSnapshot(created.snapshot),
      };
    } catch (error) {
      await this.artifacts.delete(acquired.artifactPath).catch(() => undefined);
      throw error;
    }
  }

  @Post("analyses")
  async createAnalysis(@Body() body: unknown) {
    const input = parseRequest(CreateAnalysisInputSchema, body);
    try {
      const analysis = await this.store.createAnalysis(
        input.snapshotId,
        RULE_SET_VERSION,
        SCORE_POLICY_VERSION,
      );
      return {
        analysisId: analysis.id,
        state: analysis.state,
        statusUrl: `/api/v1/analyses/${analysis.id}`,
      };
    } catch (error) {
      if (error instanceof Error && error.message === "snapshot_not_found") {
        throw new NotFoundException("Snapshot not found");
      }
      throw error;
    }
  }

  @Get("repositories/:repositoryId/analyses")
  async listAnalyses(@Param("repositoryId") repositoryId: string) {
    const repository = await this.store.getRepository(repositoryId);
    if (!repository) throw new NotFoundException("Repository not found");
    return this.store.listAnalyses(repositoryId);
  }

  @Get("repositories/:repositoryId/timeline")
  async getTimeline(@Param("repositoryId") repositoryId: string) {
    const repository = await this.store.getRepository(repositoryId);
    if (!repository) throw new NotFoundException("Repository not found");
    return this.store.getRepositoryTimeline(repositoryId);
  }

  @Get("analyses/:analysisId")
  async getAnalysis(@Param("analysisId") analysisId: string) {
    const analysis = await this.store.getAnalysis(analysisId);
    if (!analysis) throw new NotFoundException("Analysis not found");
    return analysis;
  }

  @Get("analyses/:analysisId/profile")
  async getProfile(@Param("analysisId") analysisId: string) {
    const profile = await this.store.getProfile(analysisId);
    if (!profile) throw new NotFoundException("Profile not available");
    return profile;
  }

  @Get("analyses/:analysisId/findings")
  async getFindings(@Param("analysisId") analysisId: string) {
    const analysis = await this.store.getAnalysis(analysisId);
    if (!analysis) throw new NotFoundException("Analysis not found");
    return {
      items: await this.store.listFindings(analysisId),
      nextCursor: null,
    };
  }

  @Get("analyses/:analysisId/scorecards")
  async getScorecards(@Param("analysisId") analysisId: string) {
    const analysis = await this.store.getAnalysis(analysisId);
    if (!analysis) throw new NotFoundException("Analysis not found");
    return this.store.getScorecards(analysisId);
  }

  @Get("analyses/:analysisId/dashboard")
  async getDashboard(@Param("analysisId") analysisId: string) {
    const dashboard = await this.store.getDashboard(
      analysisId,
      providerAvailability().some((provider) => provider.configured),
    );
    if (!dashboard) throw new NotFoundException("Analysis not found");
    return dashboard;
  }
}
