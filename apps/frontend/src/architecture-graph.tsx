import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useMemo } from "react";

import type {
  ArchitectureEdgeKind,
  ArchitectureGraph,
  ArchitectureNode,
  ArchitectureNodeKind,
} from "@engineering-observatory/shared-types";

import { useIntelligenceStore } from "./intelligence-store";

export type GraphLayer = "all" | "state" | "api" | "routes";

type ArchitectureNodeData = {
  architectureNode: ArchitectureNode;
};

type ArchitectureFlowNode = Node<ArchitectureNodeData, "architecture">;

const KIND_COLORS: Record<ArchitectureNodeKind, string> = {
  component: "#22d3ee",
  page: "#818cf8",
  hook: "#a78bfa",
  service: "#f59e0b",
  store: "#34d399",
  reducer: "#10b981",
  selector: "#6ee7b7",
  action: "#2dd4bf",
  effect: "#f472b6",
  "api-client": "#fb7185",
  route: "#60a5fa",
  test: "#94a3b8",
  utility: "#64748b",
  module: "#475569",
};

const EDGE_COLORS: Record<ArchitectureEdgeKind, string> = {
  imports: "#475569",
  renders: "#22d3ee",
  injects: "#f59e0b",
  calls: "#fb7185",
  dispatches: "#2dd4bf",
  subscribes: "#f472b6",
  "reads-state": "#34d399",
  "writes-state": "#10b981",
  "routes-to": "#60a5fa",
  "tested-by": "#94a3b8",
};

const LANE_BY_KIND: Record<ArchitectureNodeKind, number> = {
  route: 0,
  page: 1,
  component: 2,
  hook: 3,
  service: 4,
  "api-client": 5,
  store: 4,
  selector: 3,
  action: 3,
  reducer: 4,
  effect: 4,
  test: 6,
  utility: 5,
  module: 6,
};

const LAYER_EDGES: Record<
  Exclude<GraphLayer, "all">,
  ArchitectureEdgeKind[]
> = {
  state: ["reads-state", "writes-state", "dispatches", "subscribes", "calls"],
  api: ["calls", "imports", "renders"],
  routes: ["routes-to", "renders", "calls"],
};

function ArchitectureMapNode({
  data,
  selected,
}: NodeProps<ArchitectureFlowNode>) {
  const node = data.architectureNode;
  const color = KIND_COLORS[node.kind];
  return (
    <div
      className={`w-[210px] rounded-xl border bg-slate-950/95 px-3.5 py-3 shadow-xl transition ${selected ? "ring-2 ring-white/70" : ""}`}
      style={{ borderColor: `${color}aa`, boxShadow: `0 16px 40px ${color}12` }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: color, borderColor: "#020617" }}
      />
      <div className="flex items-center justify-between gap-3">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: `${color}20`, color }}
        >
          {node.kind}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          {node.framework}
        </span>
      </div>
      <p className="mt-2 truncate text-sm font-semibold text-slate-100">
        {node.name}
      </p>
      <p className="mt-1 truncate text-[11px] text-slate-500">
        {node.location.path}:{node.location.lineStart ?? 1}
      </p>
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: color, borderColor: "#020617" }}
      />
    </div>
  );
}

const nodeTypes = { architecture: ArchitectureMapNode };

function visibleForLayer(node: ArchitectureNode, layer: GraphLayer) {
  if (layer === "state") {
    return [
      "component",
      "page",
      "hook",
      "store",
      "selector",
      "action",
      "reducer",
      "effect",
      "service",
    ].includes(node.kind);
  }
  if (layer === "api") {
    return ["component", "page", "hook", "service", "api-client"].includes(
      node.kind,
    );
  }
  if (layer === "routes") {
    return [
      "route",
      "page",
      "component",
      "hook",
      "service",
      "api-client",
    ].includes(node.kind);
  }
  return true;
}

function layout(nodes: ArchitectureNode[]): ArchitectureFlowNode[] {
  const laneCounts = new Map<number, number>();
  return nodes.map((node) => {
    const lane = LANE_BY_KIND[node.kind];
    const row = laneCounts.get(lane) ?? 0;
    laneCounts.set(lane, row + 1);
    return {
      id: node.id,
      type: "architecture",
      position: { x: lane * 285, y: row * 128 },
      data: { architectureNode: node },
      draggable: true,
      selectable: true,
    };
  });
}

export function ArchitectureGraphView({
  graph,
  layer = "all",
}: {
  graph: ArchitectureGraph;
  layer?: GraphLayer;
}) {
  const selectedNodeId = useIntelligenceStore((state) => state.selectedNodeId);
  const selectNode = useIntelligenceStore((state) => state.selectNode);
  const search = useIntelligenceStore((state) => state.search);
  const visibleKinds = useIntelligenceStore((state) => state.visibleKinds);
  const visibleEdges = useIntelligenceStore((state) => state.visibleEdges);

  const { nodes, edges } = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const allowedEdges =
      visibleEdges ?? (layer === "all" ? null : LAYER_EDGES[layer]);
    let selected = graph.nodes.filter(
      (node) =>
        visibleKinds.includes(node.kind) && visibleForLayer(node, layer),
    );
    if (normalizedSearch) {
      const matches = new Set(
        selected
          .filter((node) =>
            `${node.name} ${node.location.path} ${node.kind}`
              .toLowerCase()
              .includes(normalizedSearch),
          )
          .map((node) => node.id),
      );
      for (const edge of graph.edges) {
        if (matches.has(edge.source)) matches.add(edge.target);
        if (matches.has(edge.target)) matches.add(edge.source);
      }
      selected = selected.filter((node) => matches.has(node.id));
    }
    const visibleIds = new Set(selected.map((node) => node.id));
    const flowEdges: Edge[] = graph.edges
      .filter(
        (edge) =>
          visibleIds.has(edge.source) &&
          visibleIds.has(edge.target) &&
          (!allowedEdges || allowedEdges.includes(edge.kind)),
      )
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label:
          selected.length <= 35 ? edge.kind.replaceAll("-", " ") : undefined,
        type: "smoothstep",
        animated: ["calls", "dispatches", "writes-state"].includes(edge.kind),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: EDGE_COLORS[edge.kind],
        },
        style: { stroke: EDGE_COLORS[edge.kind], strokeWidth: 1.5 },
        labelStyle: { fill: "#94a3b8", fontSize: 10 },
        labelBgStyle: { fill: "#020617", fillOpacity: 0.9 },
      }));
    return { nodes: layout(selected), edges: flowEdges };
  }, [graph, layer, search, visibleEdges, visibleKinds]);

  return (
    <div className="h-[680px] overflow-hidden rounded-2xl border border-slate-800 bg-[#030712]">
      {nodes.length === 0 ? (
        <div className="grid h-full place-items-center text-sm text-slate-500">
          No nodes match the current map filters.
        </div>
      ) : (
        <ReactFlow<ArchitectureFlowNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => selectNode(node.id)}
          onPaneClick={() => selectNode(null)}
          fitView
          fitViewOptions={{ padding: 0.18, maxZoom: 1.1 }}
          minZoom={0.08}
          maxZoom={1.8}
          onlyRenderVisibleElements
          nodesConnectable={false}
          edgesReconnectable={false}
          elementsSelectable
          colorMode="dark"
          aria-label="Interactive frontend architecture graph"
        >
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) =>
              KIND_COLORS[
                (node.data as ArchitectureNodeData).architectureNode.kind
              ]
            }
            maskColor="rgba(2, 6, 23, 0.72)"
            bgColor="#020617"
          />
          <Controls position="bottom-left" showInteractive={false} />
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1.3}
            color="#1e293b"
          />
        </ReactFlow>
      )}
      <span className="sr-only">
        {nodes.length} visible nodes and {edges.length} visible relationships.
        {selectedNodeId ? ` Selected node ${selectedNodeId}.` : ""}
      </span>
    </div>
  );
}
