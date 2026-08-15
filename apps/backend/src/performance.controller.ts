import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";

import { ObservatoryStore } from "@engineering-observatory/persistence";
import { PerformanceScenarioInputSchema } from "@engineering-observatory/shared-types";

import { STORE } from "./tokens";
import { parseRequest } from "./validation";

@Controller()
export class PerformanceController {
  constructor(@Inject(STORE) private readonly store: ObservatoryStore) {}

  @Post("performance-runs")
  async create(@Body() body: unknown) {
    const scenario = parseRequest(PerformanceScenarioInputSchema, body);
    try {
      return await this.store.createPerformanceRun(scenario);
    } catch (error) {
      if (error instanceof Error && error.message === "repository_not_found") {
        throw new NotFoundException("Repository not found");
      }
      throw error;
    }
  }

  @Get("performance-runs/:runId")
  async get(@Param("runId") runId: string) {
    const run = await this.store.getPerformanceRun(runId);
    if (!run) throw new NotFoundException("Performance run not found");
    return run;
  }

  @Post("performance-runs/:runId/cancel")
  async cancel(@Param("runId") runId: string) {
    const run = await this.store.getPerformanceRun(runId);
    if (!run) throw new NotFoundException("Performance run not found");
    const cancelled = await this.store.cancelPerformanceRun(runId);
    if (!cancelled) {
      throw new ConflictException(
        "Only queued performance runs can be cancelled",
      );
    }
    return { id: runId, cancellationRequested: true };
  }
}
