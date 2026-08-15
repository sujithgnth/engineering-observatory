import path from "node:path";

import { describe, expect, it } from "vitest";

import { scanRepository } from "@engineering-observatory/scanners";

import { FrontendIntelligenceEngine } from "./graph-builder";
import { analyzeChangeImpact } from "./impact";

const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000099";

async function analyzeFixture(name: string) {
  const root = path.resolve("fixtures/demo-projects", name);
  const profile = await scanRepository(root, SNAPSHOT_ID);
  return new FrontendIntelligenceEngine().analyze(root, profile);
}

describe("FrontendIntelligenceEngine", () => {
  it("builds React, Redux, rendering, API, route, and test relationships", async () => {
    const graph = await analyzeFixture("react-redux-ecommerce");

    expect(graph.frameworks).toContain("react");
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "page", name: "OrdersPage" }),
        expect.objectContaining({ kind: "component", name: "OrderTable" }),
        expect.objectContaining({ kind: "hook", name: "useOrders" }),
        expect.objectContaining({ kind: "service", name: "OrderService" }),
        expect.objectContaining({ kind: "store", name: "ordersSlice" }),
        expect.objectContaining({ kind: "selector", name: "selectAllOrders" }),
        expect.objectContaining({ kind: "route", name: "/orders" }),
        expect.objectContaining({
          kind: "api-client",
          name: "GET /api/orders",
        }),
      ]),
    );
    expect(graph.edges.map((edge) => edge.kind)).toEqual(
      expect.arrayContaining([
        "imports",
        "renders",
        "calls",
        "reads-state",
        "routes-to",
        "tested-by",
      ]),
    );
  });

  it("builds Angular dependency injection, NgRx, lazy-route, and API flow", async () => {
    const graph = await analyzeFixture("angular-ngrx-dashboard");

    expect(graph.frameworks).toContain("angular");
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "component",
          name: "OrdersPageComponent",
        }),
        expect.objectContaining({ kind: "service", name: "OrderService" }),
        expect.objectContaining({ kind: "action", name: "loadOrders" }),
        expect.objectContaining({ kind: "reducer", name: "ordersReducer" }),
        expect.objectContaining({ kind: "selector", name: "selectOrders" }),
        expect.objectContaining({ kind: "effect", name: "loadOrders" }),
        expect.objectContaining({ kind: "route", name: "/orders" }),
        expect.objectContaining({
          kind: "api-client",
          name: "GET /api/orders",
        }),
      ]),
    );
    expect(graph.edges.some((edge) => edge.kind === "injects")).toBe(true);
    const page = graph.nodes.find(
      (node) => node.name === "OrdersPageComponent",
    );
    const table = graph.nodes.find(
      (node) => node.name === "OrderTableComponent",
    );
    expect(
      graph.edges.some(
        (edge) =>
          edge.kind === "renders" &&
          edge.source === page?.id &&
          edge.target === table?.id,
      ),
    ).toBe(true);
    expect(
      graph.nodes.find((node) => node.kind === "route")?.metadata.lazy,
    ).toBe(true);
  });

  it("builds Next file routes and Zustand state flow", async () => {
    const graph = await analyzeFixture("next-zustand-portal");

    expect(graph.frameworks).toContain("nextjs");
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "page", name: "OrdersPage" }),
        expect.objectContaining({ kind: "component", name: "OrderCards" }),
        expect.objectContaining({ kind: "store", name: "useOrderStore" }),
        expect.objectContaining({ kind: "route", name: "/orders" }),
        expect.objectContaining({
          kind: "api-client",
          name: "QUERY graphql:Orders",
        }),
      ]),
    );
    expect(
      graph.edges.some(
        (edge) =>
          edge.kind === "reads-state" &&
          graph.nodes.find((node) => node.id === edge.target)?.name ===
            "useOrderStore",
      ),
    ).toBe(true);
  });

  it("computes bounded reverse-dependency change impact", async () => {
    const graph = await analyzeFixture("react-redux-ecommerce");
    const service = graph.nodes.find((node) => node.name === "OrderService");
    if (!service) throw new Error("Expected OrderService in fixture graph");

    const impact = analyzeChangeImpact(graph, { nodeId: service.id });
    expect(impact.affectedFiles).toEqual(
      expect.arrayContaining([
        "src/hooks/useOrders.ts",
        "src/pages/OrdersPage.tsx",
        "src/pages/OrdersPage.test.tsx",
      ]),
    );
    expect(impact.counts.components + impact.counts.pages).toBeGreaterThan(0);
    expect(impact.counts.tests).toBe(1);
    expect(impact.limitations).not.toHaveLength(0);
  });
});
