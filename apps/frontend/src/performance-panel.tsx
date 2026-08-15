import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, LoaderCircle, Play } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  PerformanceRun,
  PerformanceScenarioInput,
} from "@engineering-observatory/shared-types";

import { api } from "./api";

type Props = {
  repositoryId: string;
  analysisId: string;
  latestRun: PerformanceRun | null;
};

export function PerformancePanel({
  repositoryId,
  analysisId,
  latestRun,
}: Props) {
  const queryClient = useQueryClient();
  const [tool, setTool] = useState<"autocannon" | "k6">("autocannon");
  const [origin, setOrigin] = useState("http://127.0.0.1:3333");
  const [targetPath, setTargetPath] = useState("/api/v1/health/live");
  const [load, setLoad] = useState(100);
  const [duration, setDuration] = useState(10);
  const [authorization, setAuthorization] = useState(false);
  const [run, setRun] = useState<PerformanceRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const desktop = window.engineeringObservatory;
    if (!desktop) return;
    void desktop
      .runtimeInfo()
      .then((runtime) => setOrigin(runtime.apiOrigin))
      .catch(() => undefined);
  }, []);
  const runQuery = useQuery({
    queryKey: ["performance-run", run?.id],
    queryFn: () => api.performanceRun(run!.id),
    enabled: Boolean(
      run &&
      !["completed", "failed", "rejected", "cancelled"].includes(run.state),
    ),
    refetchInterval: (query) => {
      const current = query.state.data as PerformanceRun | undefined;
      return current &&
        ["completed", "failed", "rejected", "cancelled"].includes(current.state)
        ? false
        : 1_000;
    },
  });
  const current = runQuery.data ?? run ?? latestRun;

  async function startRun() {
    setError(null);
    try {
      const base = {
        repositoryId,
        analysisId,
        name: `${tool} ${load} baseline`,
        target: {
          origin,
          path: targetPath,
          method: "GET" as const,
          headers: {},
          body: null,
        },
        thresholds: { p95LatencyMs: 500, errorRatePercent: 1 },
        authorizationConfirmed: true as const,
      };
      const scenario: PerformanceScenarioInput =
        tool === "k6"
          ? {
              ...base,
              tool,
              load: { virtualUsers: load, durationSeconds: duration },
            }
          : {
              ...base,
              tool,
              load: {
                connections: load,
                durationSeconds: duration,
                pipelining: 1,
              },
            };
      const created = await api.createPerformanceRun(scenario);
      setRun(created);
      await queryClient.invalidateQueries({
        queryKey: ["dashboard", analysisId],
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not start performance run",
      );
    }
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Gauge size={19} className="text-amber-300" aria-hidden="true" />{" "}
            Measured performance
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Runs only against a target you are authorized to test.
          </p>
        </div>
        {current ? (
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs capitalize text-slate-300">
            {current.scenario.tool} · {current.state.replaceAll("_", " ")}
          </span>
        ) : null}
      </div>

      {current?.state === "completed" && current.metrics ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Requests/sec"
            value={current.metrics.requestsPerSecond.toFixed(1)}
          />
          <Metric
            label="p95 latency"
            value={`${current.metrics.latencyMs.p95.toFixed(1)} ms`}
          />
          <Metric
            label="Errors"
            value={`${current.metrics.errorRatePercent.toFixed(2)}%`}
          />
          <Metric
            label="Completed"
            value={current.metrics.completedRequests.toLocaleString()}
          />
          <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-4">
            Requested: {JSON.stringify(current.requestedLoad)} · Achieved:{" "}
            {JSON.stringify(current.achievedLoad)}. These measurements do not
            prove maximum production capacity.
          </p>
        </div>
      ) : current &&
        !["failed", "rejected", "cancelled"].includes(current.state) ? (
        <p className="mt-5 flex items-center gap-2 text-sm text-slate-300">
          <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />{" "}
          Performance run {current.state.replaceAll("_", " ")}…
        </p>
      ) : current?.failureCode ? (
        <p className="mt-5 text-sm text-rose-300">
          Run stopped: {current.failureCode}
        </p>
      ) : null}

      <details className="mt-6 border-t border-slate-800 pt-5">
        <summary className="cursor-pointer text-sm font-medium text-cyan-200">
          Configure a new run
        </summary>
        <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-2 text-sm">
            Tool
            <select
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5"
              value={tool}
              onChange={(event) =>
                setTool(event.target.value as "autocannon" | "k6")
              }
            >
              <option value="autocannon">autocannon connections</option>
              <option value="k6">k6 virtual users</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            Load preset
            <select
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5"
              value={load}
              onChange={(event) => setLoad(Number(event.target.value))}
            >
              {[100, 1000, 10000].map((value) => (
                <option key={value} value={value}>
                  {value.toLocaleString()}{" "}
                  {tool === "k6" ? "VUs" : "connections"}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            Duration seconds
            <input
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5"
              type="number"
              min={1}
              max={300}
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
            />
          </label>
          <span className="self-end text-xs leading-5 text-slate-500">
            The runner may reject 1,000 or 10,000 when local capacity or target
            policy cannot safely support it.
          </span>
          <label className="grid gap-2 text-sm md:col-span-1 lg:col-span-2">
            Target origin
            <input
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5"
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm md:col-span-1 lg:col-span-2">
            Path
            <input
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5"
              value={targetPath}
              onChange={(event) => setTargetPath(event.target.value)}
            />
          </label>
        </div>
        <label className="mt-5 flex items-start gap-3 text-sm text-slate-300">
          <input
            className="mt-1"
            type="checkbox"
            checked={authorization}
            onChange={(event) => setAuthorization(event.target.checked)}
          />
          <span>
            I confirm that I own or am explicitly authorized to load-test this
            target. Server-side safety policy still applies.
          </span>
        </label>
        {error ? (
          <p className="mt-3 text-sm text-rose-300" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-amber-300 px-4 py-2.5 font-medium text-slate-950 disabled:opacity-50"
          disabled={
            !authorization ||
            Boolean(
              run &&
              !["completed", "failed", "rejected", "cancelled"].includes(
                run.state,
              ),
            )
          }
          onClick={() => void startRun()}
        >
          <Play size={16} aria-hidden="true" /> Start measured run
        </button>
      </details>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
