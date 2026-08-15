import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, GitBranch, TestTube2 } from "lucide-react";
import { useMemo, useState } from "react";

import type { ArchitectureGraph } from "@engineering-observatory/shared-types";

import { api } from "./api";
import { ArchitectAssistant } from "./architect-assistant";
import { useIntelligenceStore } from "./intelligence-store";

export function ImpactPanel({
  analysisId,
  graph,
}: {
  analysisId: string;
  graph: ArchitectureGraph;
}) {
  const selectedNodeId = useIntelligenceStore((state) => state.selectedNodeId);
  const selectNode = useIntelligenceStore((state) => state.selectNode);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
  const [filePath, setFilePath] = useState("");
  const effectiveFilePath = selectedNode?.location.path ?? filePath;
  const files = useMemo(
    () => graph.files.map((file) => file.path).sort(),
    [graph.files],
  );

  const impact = useQuery({
    queryKey: ["change-impact", analysisId, selectedNodeId, effectiveFilePath],
    queryFn: () =>
      api.impact(
        analysisId,
        selectedNodeId
          ? { nodeId: selectedNodeId }
          : { filePath: effectiveFilePath },
      ),
    enabled: Boolean(selectedNodeId || effectiveFilePath),
  });
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
            Change impact
          </p>
          <h3 className="mt-2 text-xl font-semibold">What could this break?</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Select a map node or analyze every resolved symbol in a file. Impact
            follows dependency direction; it does not claim runtime certainty.
          </p>

          {selectedNode ? (
            <div className="mt-5 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4">
              <div className="text-xs uppercase tracking-wide text-cyan-300">
                Selected node
              </div>
              <div className="mt-1 font-medium">{selectedNode.name}</div>
              <div className="mt-1 text-xs text-slate-500">
                {selectedNode.location.path}
              </div>
              <button
                className="mt-3 text-xs text-cyan-300 hover:text-cyan-200"
                onClick={() => {
                  setFilePath(selectedNode.location.path);
                  selectNode(null);
                }}
              >
                Analyze the whole file instead
              </button>
            </div>
          ) : (
            <label className="mt-5 grid gap-2 text-sm font-medium">
              Change this file
              <select
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5"
                value={filePath}
                onChange={(event) => setFilePath(event.target.value)}
              >
                <option value="">Select an analyzed file</option>
                {files.map((file) => (
                  <option key={file}>{file}</option>
                ))}
              </select>
            </label>
          )}

          {impact.isLoading ? (
            <p className="mt-6 text-sm text-slate-400">Tracing dependants…</p>
          ) : null}
          {impact.isError ? (
            <p className="mt-6 text-sm text-rose-300">{impact.error.message}</p>
          ) : null}
          {impact.data ? (
            <>
              <div className="mt-6 flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <AlertTriangle
                  className={
                    impact.data.risk === "high"
                      ? "text-rose-400"
                      : impact.data.risk === "medium"
                        ? "text-amber-300"
                        : "text-emerald-300"
                  }
                  size={24}
                />
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Static risk
                  </div>
                  <div className="font-semibold capitalize">
                    {impact.data.risk}
                  </div>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-300">
                {impact.data.explanation}
              </p>
              <div className="mt-5 space-y-2">
                {impact.data.limitations.map((limitation) => (
                  <p
                    key={limitation}
                    className="text-xs leading-5 text-slate-500"
                  >
                    • {limitation}
                  </p>
                ))}
              </div>
            </>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex items-center gap-3">
            <GitBranch className="text-cyan-300" size={22} />
            <div>
              <h3 className="font-semibold">Affected architecture</h3>
              <p className="text-xs text-slate-500">
                Reverse dependency paths from the selected change.
              </p>
            </div>
          </div>

          {impact.data ? (
            <>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[
                  ["Components", impact.data.counts.components],
                  ["Pages", impact.data.counts.pages],
                  ["Routes", impact.data.counts.routes],
                  ["Tests", impact.data.counts.tests],
                  ["All nodes", impact.data.counts.totalNodes],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-slate-950/70 p-3">
                    <div className="text-xl font-semibold">{value}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
                      {label}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {impact.data.paths.slice(0, 20).map((pathIds, index) => {
                  const pathNodes = pathIds
                    .map((id) => nodesById.get(id))
                    .filter(Boolean);
                  return (
                    <div
                      key={`${pathIds.join(":")}:${index}`}
                      className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"
                    >
                      <div className="space-y-1.5">
                        {pathNodes.map((node, nodeIndex) =>
                          node ? (
                            <button
                              key={node.id}
                              className="flex w-full items-center gap-2 text-left text-xs hover:text-cyan-300"
                              onClick={() => selectNode(node.id)}
                            >
                              <span className="text-slate-600">
                                {nodeIndex === 0 ? "●" : "↓"}
                              </span>
                              <span className="truncate">{node.name}</span>
                              <span className="ml-auto text-[9px] uppercase text-slate-600">
                                {node.kind}
                              </span>
                            </button>
                          ) : null,
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {impact.data.counts.tests === 0 ? (
                <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100">
                  <TestTube2 className="mt-0.5 shrink-0" size={17} />
                  No affected tests were resolved. That may indicate missing
                  test coverage or an unresolved test/import convention.
                </div>
              ) : null}
            </>
          ) : (
            <div className="grid min-h-80 place-items-center text-sm text-slate-500">
              Select a node or file to build an impact map.
            </div>
          )}
        </section>
      </div>
      <ArchitectAssistant
        analysisId={analysisId}
        {...(selectedNode ? { nodeId: selectedNode.id } : {})}
        {...(!selectedNode && effectiveFilePath
          ? { filePath: effectiveFilePath }
          : {})}
        {...(selectedNode?.name || effectiveFilePath
          ? { selectionName: selectedNode?.name ?? effectiveFilePath }
          : {})}
      />
    </>
  );
}
