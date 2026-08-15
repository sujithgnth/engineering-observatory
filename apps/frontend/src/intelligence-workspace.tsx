import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Boxes,
  Braces,
  Component,
  Gauge,
  GitBranch,
  Map as MapIcon,
  Network,
  Route,
  Search,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo } from "react";

import type {
  ArchitectureGraph,
  ArchitectureNodeKind,
  FrontendHealthCategory,
} from "@engineering-observatory/shared-types";

import { api } from "./api";
import { ArchitectureGraphView, type GraphLayer } from "./architecture-graph";
import { ComponentExplorer } from "./component-explorer";
import { ImpactPanel } from "./impact-panel";
import {
  type IntelligenceView,
  useIntelligenceStore,
} from "./intelligence-store";

const NAVIGATION: Array<{
  id: IntelligenceView;
  label: string;
  icon: typeof MapIcon;
}> = [
  { id: "map", label: "Architecture map", icon: MapIcon },
  { id: "components", label: "Components", icon: Component },
  { id: "impact", label: "Change impact", icon: GitBranch },
  { id: "state", label: "State flow", icon: Workflow },
  { id: "api", label: "API flow", icon: Network },
  { id: "routes", label: "Routes", icon: Route },
  { id: "health", label: "Health", icon: Gauge },
];

const FILTER_KINDS: ArchitectureNodeKind[] = [
  "page",
  "component",
  "hook",
  "service",
  "store",
  "selector",
  "action",
  "effect",
  "api-client",
  "route",
  "test",
  "utility",
  "module",
];

function MapToolbar({ graph }: { graph: ArchitectureGraph }) {
  const search = useIntelligenceStore((state) => state.search);
  const setSearch = useIntelligenceStore((state) => state.setSearch);
  const visibleKinds = useIntelligenceStore((state) => state.visibleKinds);
  const setVisibleKinds = useIntelligenceStore(
    (state) => state.setVisibleKinds,
  );
  const toggleKind = (kind: ArchitectureNodeKind) =>
    setVisibleKinds(
      visibleKinds.includes(kind)
        ? visibleKinds.filter((item) => item !== kind)
        : [...visibleKinds, kind],
    );

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <label className="relative min-w-64 flex-1 sm:max-w-md">
        <span className="sr-only">Search architecture</span>
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          size={15}
        />
        <input
          className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search symbol, type, or file…"
        />
      </label>
      <details className="relative">
        <summary className="cursor-pointer list-none rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">
          Node layers · {visibleKinds.length}
        </summary>
        <div className="absolute right-0 z-20 mt-2 grid w-72 grid-cols-2 gap-2 rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-2xl">
          {FILTER_KINDS.map((kind) => (
            <label
              key={kind}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-slate-800"
            >
              <input
                type="checkbox"
                checked={visibleKinds.includes(kind)}
                onChange={() => toggleKind(kind)}
              />
              {kind} · {graph.nodes.filter((node) => node.kind === kind).length}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

function GraphWorkspace({
  analysisId,
  graph,
  layer,
  title,
  description,
}: {
  analysisId: string;
  graph: ArchitectureGraph;
  layer: GraphLayer;
  title?: string;
  description?: string;
}) {
  return (
    <>
      {title ? (
        <div className="mb-5">
          <h3 className="text-xl font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-slate-400">{description}</p>
        </div>
      ) : null}
      <MapToolbar graph={graph} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_350px]">
        <ArchitectureGraphView graph={graph} layer={layer} />
        <ComponentExplorer analysisId={analysisId} graph={graph} />
      </div>
    </>
  );
}

function ComponentsView({
  analysisId,
  graph,
}: {
  analysisId: string;
  graph: ArchitectureGraph;
}) {
  const selectNode = useIntelligenceStore((state) => state.selectNode);
  const selectedNodeId = useIntelligenceStore((state) => state.selectedNodeId);
  const search = useIntelligenceStore((state) => state.search);
  const components = graph.nodes.filter(
    (node) =>
      ["component", "page", "hook", "service"].includes(node.kind) &&
      `${node.name} ${node.location.path}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <MapToolbar graph={graph} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Component and service catalog</h3>
              <p className="mt-1 text-xs text-slate-500">
                {components.length} resolved symbols
              </p>
            </div>
            <Boxes className="text-cyan-300" size={21} />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {components.map((node) => {
              const incoming = graph.edges.filter(
                (edge) => edge.target === node.id,
              ).length;
              const outgoing = graph.edges.filter(
                (edge) => edge.source === node.id,
              ).length;
              return (
                <button
                  key={node.id}
                  className={`rounded-xl border p-4 text-left transition hover:border-cyan-400/60 ${selectedNodeId === node.id ? "border-cyan-400 bg-cyan-400/5" : "border-slate-800 bg-slate-950/60"}`}
                  onClick={() => selectNode(node.id)}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
                    {node.kind} · {node.framework}
                  </div>
                  <div className="mt-2 truncate font-medium">{node.name}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">
                    {node.location.path}
                  </div>
                  <div className="mt-3 flex gap-3 text-[10px] uppercase tracking-wide text-slate-600">
                    <span>{incoming} parents</span>
                    <span>{outgoing} dependencies</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <ComponentExplorer analysisId={analysisId} graph={graph} />
      </div>
    </>
  );
}

function reachableApiNodes(graph: ArchitectureGraph, startId: string) {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const visited = new Set([startId]);
  let frontier = [startId];
  const result = new Set<string>();
  for (let depth = 0; depth < 5; depth += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const edge of graph.edges.filter(
        (item) => item.source === current,
      )) {
        if (visited.has(edge.target)) continue;
        visited.add(edge.target);
        const node = nodesById.get(edge.target);
        if (node?.kind === "api-client") result.add(node.id);
        next.push(edge.target);
      }
    }
    frontier = next;
  }
  return [...result].map((id) => nodesById.get(id)).filter(Boolean);
}

function RoutesView({ graph }: { graph: ArchitectureGraph }) {
  const selectNode = useIntelligenceStore((state) => state.selectNode);
  const routes = graph.nodes.filter((node) => node.kind === "route");
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
      <div className="border-b border-slate-800 p-6">
        <h3 className="text-xl font-semibold">Route intelligence</h3>
        <p className="mt-1 text-sm text-slate-400">
          Static route composition. Bundle size remains unmeasured until a real
          build artifact is supplied.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="bg-slate-950/60 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Route</th>
              <th className="px-5 py-3">Loads</th>
              <th className="px-5 py-3">Lazy</th>
              <th className="px-5 py-3">API calls</th>
              <th className="px-5 py-3">Guards</th>
              <th className="px-5 py-3">Bundle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {routes.map((route) => {
              const targetIds = graph.edges
                .filter(
                  (edge) =>
                    edge.source === route.id && edge.kind === "routes-to",
                )
                .map((edge) => edge.target);
              const targets = targetIds
                .map((id) => nodesById.get(id))
                .filter(Boolean);
              const apis = reachableApiNodes(graph, route.id);
              const guards = Array.isArray(route.metadata.guards)
                ? route.metadata.guards
                : [];
              return (
                <tr key={route.id}>
                  <td className="px-5 py-4">
                    <button
                      className="font-mono font-medium text-cyan-300 hover:text-cyan-200"
                      onClick={() => selectNode(route.id)}
                    >
                      {route.name}
                    </button>
                  </td>
                  <td className="px-5 py-4 text-slate-300">
                    {targets.map((node) => node?.name).join(", ") ||
                      "Unresolved"}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${route.metadata.lazy === true ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}
                    >
                      {route.metadata.lazy === true ? "lazy" : "eager"}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-400">
                    {apis.map((node) => node?.name).join(", ") ||
                      "None resolved"}
                  </td>
                  <td className="px-5 py-4 text-slate-400">
                    {guards.join(", ") || "None detected"}
                  </td>
                  <td className="px-5 py-4 text-slate-500">Not measured</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {routes.length === 0 ? (
        <p className="p-8 text-center text-sm text-slate-500">
          No supported static route declarations were resolved.
        </p>
      ) : null}
    </div>
  );
}

const HEALTH_ICONS: Record<FrontendHealthCategory, typeof Activity> = {
  architecture: Braces,
  performance: Activity,
  security: ShieldCheck,
  maintainability: Gauge,
};

function HealthView({ graph }: { graph: ArchitectureGraph }) {
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {graph.health.map((score) => {
          const Icon = HEALTH_ICONS[score.category];
          return (
            <article
              key={score.category}
              className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm capitalize text-slate-400">
                  {score.category}
                </span>
                <Icon className="text-cyan-300" size={18} />
              </div>
              <div className="mt-3 text-4xl font-semibold">{score.score}</div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-cyan-400"
                  style={{ width: `${score.score}%` }}
                />
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {score.deductions.length} deterministic deduction groups
              </p>
            </article>
          );
        })}
      </div>
      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h3 className="text-xl font-semibold">Architecture health findings</h3>
        <p className="mt-1 text-sm text-slate-400">
          Every deduction has a rule, location, evidence, and explicit
          static-analysis limitation.
        </p>
        <div className="mt-5 space-y-3">
          {graph.issues.map((issue) => (
            <article
              key={issue.id}
              className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"
            >
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wider">
                <span className="text-amber-300">{issue.severity}</span>
                <span className="text-cyan-300">{issue.category}</span>
                <span className="text-slate-600">{issue.ruleId}</span>
              </div>
              <h4 className="mt-2 font-medium">{issue.title}</h4>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {issue.explanation}
              </p>
              <div className="mt-3 text-xs text-slate-600">
                {issue.location.path}:{issue.location.lineStart ?? 1} · −
                {issue.scoreDeduction} points
              </div>
            </article>
          ))}
          {graph.issues.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
              No configured frontend architecture rules produced findings.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function viewContent(
  view: IntelligenceView,
  analysisId: string,
  graph: ArchitectureGraph,
) {
  if (view === "components") {
    return <ComponentsView analysisId={analysisId} graph={graph} />;
  }
  if (view === "impact") {
    return <ImpactPanel analysisId={analysisId} graph={graph} />;
  }
  if (view === "state") {
    return (
      <GraphWorkspace
        analysisId={analysisId}
        graph={graph}
        layer="state"
        title="State management flow"
        description="Components, selectors, actions, reducers, stores, effects, and resolved state relationships."
      />
    );
  }
  if (view === "api") {
    return (
      <GraphWorkspace
        analysisId={analysisId}
        graph={graph}
        layer="api"
        title="API communication flow"
        description="Trace components through hooks and services to statically resolved HTTP and GraphQL clients."
      />
    );
  }
  if (view === "routes") return <RoutesView graph={graph} />;
  if (view === "health") return <HealthView graph={graph} />;
  return <GraphWorkspace analysisId={analysisId} graph={graph} layer="all" />;
}

export function IntelligenceWorkspace({ analysisId }: { analysisId: string }) {
  const view = useIntelligenceStore((state) => state.view);
  const setView = useIntelligenceStore((state) => state.setView);
  const reset = useIntelligenceStore((state) => state.reset);
  const graph = useQuery({
    queryKey: ["architecture", analysisId],
    queryFn: () => api.architecture(analysisId),
  });

  useEffect(() => reset(), [analysisId, reset]);

  const counts = useMemo(() => {
    if (!graph.data) return null;
    return {
      components: graph.data.nodes.filter((node) =>
        ["component", "page"].includes(node.kind),
      ).length,
      routes: graph.data.nodes.filter((node) => node.kind === "route").length,
      apis: graph.data.nodes.filter(
        (node) =>
          node.kind === "api-client" && node.metadata.role === "endpoint",
      ).length,
      relationships: graph.data.edges.length,
    };
  }, [graph.data]);

  if (graph.isLoading) {
    return (
      <section className="mt-8 grid min-h-96 place-items-center rounded-2xl border border-slate-800 bg-slate-900/40">
        <p className="text-sm text-slate-400">Loading architecture graph…</p>
      </section>
    );
  }
  if (graph.isError || !graph.data) {
    return (
      <section className="mt-8 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-6">
        <h2 className="font-semibold text-amber-100">
          Architecture map unavailable for this analysis
        </h2>
        <p className="mt-2 text-sm leading-6 text-amber-100/70">
          {graph.error?.message ??
            "Run a new scan to generate the frontend-intelligence graph."}
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8" aria-label="Frontend intelligence workspace">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
              Frontend architecture intelligence
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">
              Application architecture map
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              A deterministic TypeScript AST graph of rendering, state, API,
              routing, dependency, test, and change-impact relationships.
            </p>
          </div>
          {counts ? (
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                ["UI", counts.components],
                ["Routes", counts.routes],
                ["APIs", counts.apis],
                ["Edges", counts.relationships],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="min-w-16 rounded-lg bg-slate-950/70 p-2"
                >
                  <div className="font-semibold">{value}</div>
                  <div className="text-[9px] uppercase tracking-wide text-slate-500">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <nav
          className="mt-6 flex gap-2 overflow-x-auto border-b border-slate-800 pb-4"
          aria-label="Architecture views"
        >
          {NAVIGATION.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${view === item.id ? "bg-cyan-400 text-slate-950" : "text-slate-300 hover:bg-slate-800"}`}
                onClick={() => setView(item.id)}
                aria-current={view === item.id ? "page" : undefined}
              >
                <Icon size={15} /> {item.label}
              </button>
            );
          })}
        </nav>

        <div className="mt-6">{viewContent(view, analysisId, graph.data)}</div>
      </div>
    </section>
  );
}
