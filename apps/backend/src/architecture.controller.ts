import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";

import { analyzeChangeImpact } from "@engineering-observatory/frontend-intelligence";
import type {
  ArchitectureGraphStore,
  ObservatoryStore,
} from "@engineering-observatory/persistence";
import {
  cleanupWorkspace,
  createIsolatedWorkspace,
  extractArchive,
} from "@engineering-observatory/scanners";

import { ARCHITECTURE_STORE, STORE } from "./tokens";

const MAX_SOURCE_PREVIEW_BYTES = 1_000_000;

function safeRelativePath(value: string) {
  if (
    !value ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((segment) => segment === ".." || segment === ".")
  ) {
    throw new BadRequestException(
      "A safe repository-relative path is required",
    );
  }
  return value;
}

@Controller()
export class ArchitectureController {
  constructor(
    @Inject(STORE) private readonly store: ObservatoryStore,
    @Inject(ARCHITECTURE_STORE)
    private readonly architectureStore: ArchitectureGraphStore,
  ) {}

  @Get("analyses/:analysisId/architecture")
  async architecture(@Param("analysisId") analysisId: string) {
    const analysis = await this.store.getAnalysis(analysisId);
    if (!analysis) throw new NotFoundException("Analysis not found");
    const graph = await this.architectureStore.getGraph(analysisId);
    if (!graph) throw new NotFoundException("Architecture graph not available");
    return graph;
  }

  @Get("analyses/:analysisId/impact")
  async impact(
    @Param("analysisId") analysisId: string,
    @Query("nodeId") nodeId?: string,
    @Query("filePath") filePath?: string,
  ) {
    if (!nodeId && !filePath) {
      throw new BadRequestException("nodeId or filePath is required");
    }
    const graph = await this.architectureStore.getGraph(analysisId);
    if (!graph) throw new NotFoundException("Architecture graph not available");
    try {
      return analyzeChangeImpact(graph, {
        ...(nodeId ? { nodeId } : {}),
        ...(filePath ? { filePath: safeRelativePath(filePath) } : {}),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "architecture_selection_not_found"
      ) {
        throw new NotFoundException("Architecture selection not found");
      }
      throw error;
    }
  }

  @Get("analyses/:analysisId/source")
  async source(
    @Param("analysisId") analysisId: string,
    @Query("path") requestedPath?: string,
  ) {
    const filePath = safeRelativePath(requestedPath ?? "");
    const graph = await this.architectureStore.getGraph(analysisId);
    if (!graph?.files.some((file) => file.path === filePath)) {
      throw new NotFoundException("Analyzed source file not found");
    }
    const analysis = await this.store.getAnalysis(analysisId);
    if (!analysis) throw new NotFoundException("Analysis not found");
    const snapshot = await this.store.getSnapshot(analysis.snapshotId);
    if (!snapshot) throw new NotFoundException("Source snapshot not found");

    const workspace = await createIsolatedWorkspace();
    const repositoryRoot = path.join(workspace, "repository");
    try {
      await extractArchive(snapshot.artifactPath, repositoryRoot);
      const absolutePath = path.resolve(repositoryRoot, filePath);
      if (
        !absolutePath.startsWith(`${path.resolve(repositoryRoot)}${path.sep}`)
      ) {
        throw new BadRequestException("Source path escapes repository root");
      }
      const fileStats = await stat(absolutePath).catch(() => null);
      if (!fileStats?.isFile())
        throw new NotFoundException("Source file not found");
      if (fileStats.size > MAX_SOURCE_PREVIEW_BYTES) {
        throw new BadRequestException("Source preview exceeds 1 MB");
      }
      return {
        path: filePath,
        content: await readFile(absolutePath, "utf8"),
        byteSize: fileStats.size,
        contentHash: graph.files.find((file) => file.path === filePath)
          ?.contentHash,
      };
    } finally {
      await cleanupWorkspace(workspace);
    }
  }
}
