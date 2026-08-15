import { Activity, Radar } from "lucide-react";
import { useState } from "react";

import { AnalysisScreen } from "./dashboard";
import { SourcePanel } from "./source-panel";

function analysisFromUrl() {
  return new URLSearchParams(window.location.search).get("analysis");
}

export function App() {
  const [analysisId, setAnalysisId] = useState<string | null>(analysisFromUrl);

  function selectAnalysis(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("analysis", id);
    else url.searchParams.delete("analysis");
    window.history.pushState({}, "", url);
    setAnalysisId(id);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/95">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 sm:px-8">
          <button
            className="flex items-center gap-3 text-left"
            onClick={() => selectAnalysis(null)}
          >
            <span className="grid size-10 place-items-center rounded-xl bg-cyan-400 text-slate-950">
              <Radar aria-hidden="true" size={22} />
            </span>
            <span>
              <span className="block font-semibold tracking-tight">
                Engineering Observatory
              </span>
              <span className="block text-xs text-slate-400">
                Google Maps for frontend architecture
              </span>
            </span>
          </button>
          <span className="hidden items-center gap-2 text-sm text-slate-400 sm:flex">
            <Activity
              size={16}
              className="text-emerald-400"
              aria-hidden="true"
            />
            Deterministic core active
          </span>
        </div>
      </header>

      {analysisId ? (
        <AnalysisScreen
          analysisId={analysisId}
          onNewScan={() => selectAnalysis(null)}
        />
      ) : (
        <SourcePanel onAnalysisCreated={(id) => selectAnalysis(id)} />
      )}
    </div>
  );
}
