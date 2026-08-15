import type {
  ArchitectureEdge,
  ArchitectureGraph,
  ArchitectureNode,
  ChangeImpact,
} from "@engineering-observatory/shared-types";

const MAX_IMPACT_DEPTH = 8;

type Parent = { previous: string; edge: ArchitectureEdge };

function impactDependents(
  nodeId: string,
  incoming: Map<string, ArchitectureEdge[]>,
  outgoingTests: Map<string, ArchitectureEdge[]>,
): ArchitectureEdge[] {
  return [
    ...(incoming.get(nodeId) ?? []),
    ...(outgoingTests.get(nodeId) ?? []),
  ];
}

function dependentId(edge: ArchitectureEdge, current: string): string {
  return edge.kind === "tested-by" && edge.source === current
    ? edge.target
    : edge.source;
}

function pathTo(nodeId: string, parent: Map<string, Parent>): string[] {
  const path = [nodeId];
  let current = nodeId;
  while (parent.has(current)) {
    const next = parent.get(current);
    if (!next) break;
    current = next.previous;
    path.unshift(current);
  }
  return path;
}

export function analyzeChangeImpact(
  graph: ArchitectureGraph,
  selection: { nodeId?: string; filePath?: string },
): ChangeImpact {
  const selected = graph.nodes.filter(
    (node) =>
      node.id === selection.nodeId ||
      (selection.filePath && node.location.path === selection.filePath),
  );
  if (selected.length === 0) {
    throw new Error("architecture_selection_not_found");
  }

  const incoming = new Map<string, ArchitectureEdge[]>();
  const outgoingTests = new Map<string, ArchitectureEdge[]>();
  for (const edge of graph.edges) {
    const targetEdges = incoming.get(edge.target) ?? [];
    targetEdges.push(edge);
    incoming.set(edge.target, targetEdges);
    if (edge.kind === "tested-by") {
      const tests = outgoingTests.get(edge.source) ?? [];
      tests.push(edge);
      outgoingTests.set(edge.source, tests);
    }
  }

  const selectedIds = new Set(selected.map((node) => node.id));
  const affected = new Set<string>();
  const parent = new Map<string, Parent>();
  const depth = new Map<string, number>();
  const queue = selected.map((node) => node.id);
  for (const id of queue) depth.set(id, 0);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const currentDepth = depth.get(current) ?? 0;
    if (currentDepth >= MAX_IMPACT_DEPTH) continue;
    for (const edge of impactDependents(current, incoming, outgoingTests)) {
      const dependent = dependentId(edge, current);
      if (selectedIds.has(dependent) || affected.has(dependent)) continue;
      affected.add(dependent);
      parent.set(dependent, { previous: current, edge });
      depth.set(dependent, currentDepth + 1);
      queue.push(dependent);
    }
  }

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const affectedNodes = [...affected]
    .map((id) => nodesById.get(id))
    .filter((node): node is ArchitectureNode => Boolean(node));
  const count = (kind: ArchitectureNode["kind"]) =>
    affectedNodes.filter((node) => node.kind === kind).length;
  const affectedFiles = [
    ...new Set(affectedNodes.map((node) => node.location.path)),
  ].sort();
  const selectedFiles = [
    ...new Set(selected.map((node) => node.location.path)),
  ].sort();
  const total = affectedNodes.length;
  const highValueAffected =
    count("component") + count("page") * 2 + count("route") * 2;
  const risk =
    total >= 20 || highValueAffected >= 12
      ? "high"
      : total >= 6 || highValueAffected >= 4
        ? "medium"
        : "low";

  return {
    selectedNodeIds: selected.map((node) => node.id).sort(),
    selectedFiles,
    affectedNodeIds: affectedNodes.map((node) => node.id).sort(),
    affectedFiles,
    paths: affectedNodes.slice(0, 50).map((node) => pathTo(node.id, parent)),
    counts: {
      components: count("component"),
      pages: count("page"),
      routes: count("route"),
      tests: count("test"),
      totalNodes: total,
    },
    risk,
    explanation:
      total === 0
        ? "No dependants were resolved from the static graph. This is not proof that the change is isolated."
        : `Changing this selection may affect ${total} resolved architecture nodes across ${affectedFiles.length} files.`,
    limitations: [
      "Impact follows statically resolved imports and framework relationships only.",
      "Runtime dependency injection, dynamic imports, string-based routing, reflection, and external consumers may be missing.",
      `Traversal is bounded to ${MAX_IMPACT_DEPTH} dependency levels.`,
    ],
  };
}
