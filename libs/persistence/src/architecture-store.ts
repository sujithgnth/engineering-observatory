import { PrismaPg } from "@prisma/adapter-pg";

import {
  ArchitectureGraphSchema,
  type ArchitectureGraph,
} from "@engineering-observatory/shared-types";

import { PrismaClient } from "./generated/prisma/client";
import type { Prisma } from "./generated/prisma/client";

const WRITE_BATCH_SIZE = 750;

function chunks<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += WRITE_BATCH_SIZE) {
    result.push(values.slice(index, index + WRITE_BATCH_SIZE));
  }
  return result;
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export class ArchitectureGraphStore {
  constructor(readonly client: PrismaClient) {}

  static fromEnvironment() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const adapter = new PrismaPg({ connectionString });
    return new ArchitectureGraphStore(new PrismaClient({ adapter }));
  }

  async close() {
    await this.client.$disconnect();
  }

  async saveGraph(analysisId: string, graph: ArchitectureGraph) {
    await this.client.$transaction(async (transaction) => {
      await transaction.architectureEdge.deleteMany({
        where: { analysisId },
      });
      await transaction.architectureNode.deleteMany({
        where: { analysisId },
      });
      await transaction.analysisFile.deleteMany({ where: { analysisId } });
      await transaction.architectureGraph.upsert({
        where: { analysisId },
        create: {
          analysisId,
          schemaVersion: graph.schemaVersion,
          analyzerVersion: graph.analyzerVersion,
          snapshotId: graph.snapshotId,
          frameworks: graph.frameworks,
          issues: inputJson(graph.issues),
          health: inputJson(graph.health),
          coverage: inputJson(graph.coverage),
        },
        update: {
          schemaVersion: graph.schemaVersion,
          analyzerVersion: graph.analyzerVersion,
          snapshotId: graph.snapshotId,
          frameworks: graph.frameworks,
          issues: inputJson(graph.issues),
          health: inputJson(graph.health),
          coverage: inputJson(graph.coverage),
        },
      });

      for (const batch of chunks(graph.files)) {
        await transaction.analysisFile.createMany({
          data: batch.map((file) => ({ analysisId, ...file })),
        });
      }
      for (const batch of chunks(graph.nodes)) {
        await transaction.architectureNode.createMany({
          data: batch.map((node) => ({
            analysisId,
            id: node.id,
            stableKey: node.stableKey,
            kind: node.kind,
            name: node.name,
            framework: node.framework,
            filePath: node.location.path,
            lineStart: node.location.lineStart,
            lineEnd: node.location.lineEnd,
            metadata: inputJson(node.metadata),
          })),
        });
      }
      for (const batch of chunks(graph.edges)) {
        await transaction.architectureEdge.createMany({
          data: batch.map((edge) => ({
            analysisId,
            id: edge.id,
            sourceNodeId: edge.source,
            targetNodeId: edge.target,
            kind: edge.kind,
            confidence: edge.confidence,
            evidencePath: edge.evidence.path,
            evidenceLine: edge.evidence.lineStart,
          })),
        });
      }
    });
  }

  async getGraph(analysisId: string): Promise<ArchitectureGraph | null> {
    const [record, files, nodes, edges] = await Promise.all([
      this.client.architectureGraph.findUnique({ where: { analysisId } }),
      this.client.analysisFile.findMany({
        where: { analysisId },
        orderBy: { path: "asc" },
      }),
      this.client.architectureNode.findMany({
        where: { analysisId },
        orderBy: [{ filePath: "asc" }, { lineStart: "asc" }],
      }),
      this.client.architectureEdge.findMany({
        where: { analysisId },
        orderBy: [{ sourceNodeId: "asc" }, { targetNodeId: "asc" }],
      }),
    ]);
    if (!record) return null;

    return ArchitectureGraphSchema.parse({
      schemaVersion: record.schemaVersion,
      analyzerVersion: record.analyzerVersion,
      snapshotId: record.snapshotId,
      frameworks: record.frameworks,
      files: files.map((file) => ({
        path: file.path,
        language: file.language,
        lineCount: file.lineCount,
        byteSize: file.byteSize,
        contentHash: file.contentHash,
        test: file.test,
      })),
      nodes: nodes.map((node) => ({
        id: node.id,
        stableKey: node.stableKey,
        kind: node.kind,
        name: node.name,
        framework: node.framework,
        location: {
          path: node.filePath,
          lineStart: node.lineStart,
          lineEnd: node.lineEnd,
        },
        metadata: node.metadata,
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        kind: edge.kind,
        confidence: edge.confidence,
        evidence: {
          path: edge.evidencePath,
          lineStart: edge.evidenceLine,
          lineEnd: edge.evidenceLine,
        },
      })),
      issues: record.issues,
      health: record.health,
      coverage: record.coverage,
    });
  }
}
