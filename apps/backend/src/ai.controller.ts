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

import {
  configuredModel,
  createAIProvider,
  providerAvailability,
} from "@engineering-observatory/ai-adapter";
import { analyzeChangeImpact } from "@engineering-observatory/frontend-intelligence";
import {
  ArchitectureGraphStore,
  ObservatoryStore,
} from "@engineering-observatory/persistence";
import {
  ArchitectureReviewInputSchema,
  CreateAIReviewInputSchema,
} from "@engineering-observatory/shared-types";

import { ARCHITECTURE_STORE, STORE } from "./tokens";
import { parseRequest } from "./validation";

@Controller()
export class AIController {
  constructor(
    @Inject(STORE) private readonly store: ObservatoryStore,
    @Inject(ARCHITECTURE_STORE)
    private readonly architectureStore: ArchitectureGraphStore,
  ) {}

  @Get("ai/providers")
  providers() {
    return providerAvailability();
  }

  @Post("findings/:findingId/ai-reviews")
  async createReview(
    @Param("findingId") findingId: string,
    @Body() body: unknown,
  ) {
    const input = parseRequest(CreateAIReviewInputSchema, body);
    const availability = providerAvailability().find(
      (item) => item.provider === input.provider,
    );
    if (!availability?.configured)
      throw new ConflictException("AI provider is not configured");
    try {
      const model = configuredModel(input.provider, input.model);
      return await this.store.createAIReview(findingId, input.provider, model);
    } catch (error) {
      if (error instanceof Error && error.message === "finding_not_found") {
        throw new NotFoundException("Finding not found");
      }
      throw error;
    }
  }

  @Get("ai-reviews/:reviewId")
  async getReview(@Param("reviewId") reviewId: string) {
    const review = await this.store.getAIReview(reviewId);
    if (!review) throw new NotFoundException("AI review not found");
    return review;
  }

  @Post("analyses/:analysisId/architect-review")
  async architectureReview(
    @Param("analysisId") analysisId: string,
    @Body() body: unknown,
  ) {
    const input = parseRequest(ArchitectureReviewInputSchema, body);
    const availability = providerAvailability().find(
      (item) => item.provider === input.provider,
    );
    if (!availability?.configured) {
      throw new ConflictException("AI provider is not configured");
    }
    const graph = await this.architectureStore.getGraph(analysisId);
    if (!graph) throw new NotFoundException("Architecture graph not available");

    const selectedNodes = graph.nodes.filter(
      (node) =>
        node.id === input.nodeId ||
        (input.filePath && node.location.path === input.filePath),
    );
    if ((input.nodeId || input.filePath) && selectedNodes.length === 0) {
      throw new NotFoundException("Architecture selection not found");
    }
    const impact =
      input.nodeId || input.filePath
        ? analyzeChangeImpact(graph, {
            ...(input.nodeId ? { nodeId: input.nodeId } : {}),
            ...(input.filePath ? { filePath: input.filePath } : {}),
          })
        : null;
    const model = configuredModel(input.provider, input.model);
    const recommendation = await createAIProvider(
      input.provider,
      model,
    ).reviewArchitecture({
      question: input.question,
      graph,
      impact,
      selectedNodeIds: selectedNodes.map((node) => node.id),
    });
    return { provider: input.provider, model, recommendation, impact };
  }
}
