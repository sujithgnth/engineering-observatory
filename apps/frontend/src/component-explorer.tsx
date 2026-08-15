import { Code2, ExternalLink, FileCode2, Network } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";

import type {
  ArchitectureEdge,
  ArchitectureGraph,
  ArchitectureNode,
} from "@engineering-observatory/shared-types";

import { useIntelligenceStore } from "./intelligence-store";

const SourcePreview = lazy(() => import("./source-preview"));

function relationLabel(edge: ArchitectureEdge, incoming: boolean) {
  if (edge.kind === "tested-by") return incoming ? "tests" : "tested by";
  return incoming
    ? `${edge.kind.replaceAll("-", " ")} this`
    : edge.kind.replaceAll("-", " ");
}

function RelationList({
  title,
  relationships,
  nodesById,
}: {
  title: string;
  relationships: Array<{
    edge: ArchitectureEdge;
    nodeId: string;
    incoming: boolean;
  }>;
  nodesById: Map<string, ArchitectureNode>;
}) {
  const selectNode = useIntelligenceStore((state) => state.selectNode);
  return (
    <section>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {title} · {relationships.length}
      </h4>
      <div className="mt-2 space-y-2">
        {relationships.length === 0 ? (
          <p className="text-xs text-slate-600">No resolved relationships.</p>
        ) : null}
        {relationships.slice(0, 20).map(({ edge, nodeId, incoming }) => {
          const node = nodesById.get(nodeId);
          if (!node) return null;
          return (
            <button
              key={`${edge.id}:${incoming ? "in" : "out"}`}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-left hover:border-slate-600"
              onClick={() => selectNode(node.id)}
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-slate-200">
                  {node.name}
                </span>
                <span className="block text-[10px] text-slate-500">
                  {node.kind} · {relationLabel(edge, incoming)}
                </span>
              </span>
              <ExternalLink className="shrink-0 text-slate-600" size={13} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function ComponentExplorer({
  analysisId,
  graph,
}: {
  analysisId: string;
  graph: ArchitectureGraph;
}) {
  const selectedNodeId = useIntelligenceStore((state) => state.selectedNodeId);
  const [sourceOpen, setSourceOpen] = useState(false);
  const nodesById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const selected = selectedNodeId ? nodesById.get(selectedNodeId) : null;
  const incoming = selected
    ? graph.edges
        .filter((edge) => edge.target === selected.id)
        .map((edge) => ({ edge, nodeId: edge.source, incoming: true }))
    : [];
  const outgoing = selected
    ? graph.edges
        .filter((edge) => edge.source === selected.id)
        .map((edge) => ({ edge, nodeId: edge.target, incoming: false }))
    : [];
  const stateRelationships = [...incoming, ...outgoing].filter(({ edge }) =>
    ["dispatches", "reads-state", "writes-state", "subscribes"].includes(
      edge.kind,
    ),
  );
  const tests = [...incoming, ...outgoing].filter(
    ({ edge, nodeId }) =>
      edge.kind === "tested-by" || nodesById.get(nodeId)?.kind === "test",
  );
  const dependencies = [...incoming, ...outgoing].filter(
    ({ edge }) =>
      ![
        "dispatches",
        "reads-state",
        "writes-state",
        "subscribes",
        "tested-by",
      ].includes(edge.kind),
  );

  if (!selected) {
    return (
      <aside className="grid min-h-[680px] place-items-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center">
        <div>
          <Network className="mx-auto text-cyan-300" size={28} />
          <h3 className="mt-4 font-semibold">Select a map node</h3>
          <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">
            Inspect its parents, children, state, services, routes, API calls,
            tests, and source location.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="rounded-full bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
            {selected.kind}
          </span>
          <h3 className="mt-3 truncate text-xl font-semibold">
            {selected.name}
          </h3>
          <p className="mt-1 break-all text-xs leading-5 text-slate-500">
            {selected.location.path}:{selected.location.lineStart ?? 1}
          </p>
        </div>
        <FileCode2 className="shrink-0 text-cyan-300" size={22} />
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
        {[
          ["Used by", incoming.length],
          ["Uses", outgoing.length],
          ["Tests", tests.length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-950/70 p-2">
            <div className="text-lg font-semibold">{value}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">
              {label}
            </div>
          </div>
        ))}
      </div>

      <button
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
        onClick={() => setSourceOpen((value) => !value)}
      >
        <Code2 size={15} /> {sourceOpen ? "Hide source" : "Open source"}
      </button>

      <div className="mt-6 space-y-6">
        <RelationList
          title="Dependencies"
          relationships={dependencies}
          nodesById={nodesById}
        />
        <RelationList
          title="State flow"
          relationships={stateRelationships}
          nodesById={nodesById}
        />
        <RelationList
          title="Tests"
          relationships={tests}
          nodesById={nodesById}
        />
      </div>

      {sourceOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/90 p-4 backdrop-blur sm:p-8">
          <div className="mx-auto max-w-6xl rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold">{selected.name}</h3>
                <p className="text-xs text-slate-500">
                  Immutable snapshot source
                </p>
              </div>
              <button
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
                onClick={() => setSourceOpen(false)}
              >
                Close
              </button>
            </div>
            <Suspense fallback={<p className="p-5 text-sm">Loading editor…</p>}>
              <SourcePreview
                analysisId={analysisId}
                filePath={selected.location.path}
                line={selected.location.lineStart}
              />
            </Suspense>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
