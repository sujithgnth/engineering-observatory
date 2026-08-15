import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  GitCommitHorizontal,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type {
  Dimension,
  Finding,
  Severity,
} from "@engineering-observatory/shared-types";

import { api } from "./api";
import { FindingDetail } from "./finding-detail";
import { PerformancePanel } from "./performance-panel";

const IntelligenceWorkspace = lazy(() =>
  import("./intelligence-workspace").then((module) => ({
    default: module.IntelligenceWorkspace,
  })),
);
const DashboardCharts = lazy(() =>
  import("./dashboard-charts").then((module) => ({
    default: module.DashboardCharts,
  })),
);

const TERMINAL = [
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
];

type Props = { analysisId: string; onNewScan: () => void };

export function AnalysisScreen({ analysisId, onNewScan }: Props) {
  const queryClient = useQueryClient();
  const analysis = useQuery({
    queryKey: ["analysis", analysisId],
    queryFn: () => api.analysis(analysisId),
    refetchInterval: (query) =>
      TERMINAL.includes(query.state.data?.state ?? "") ? false : 800,
  });
  const ready =
    analysis.data &&
    ["completed", "completed_with_warnings"].includes(analysis.data.state);
  const dashboard = useQuery({
    queryKey: ["dashboard", analysisId],
    queryFn: () => api.dashboard(analysisId),
    enabled: Boolean(ready),
  });

  if (analysis.isLoading) return <CenteredStatus text="Loading analysis…" />;
  if (analysis.isError)
    return (
      <CenteredError message={analysis.error.message} onNewScan={onNewScan} />
    );
  if (
    analysis.data?.state === "failed" ||
    analysis.data?.state === "cancelled"
  ) {
    return (
      <CenteredError
        message={`Analysis ${analysis.data.state}: ${analysis.data.failureCode ?? "unknown failure"}`}
        onNewScan={onNewScan}
      />
    );
  }
  if (!ready || !dashboard.data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-24 text-center">
        <LoaderCircle
          className="mx-auto animate-spin text-cyan-300"
          size={38}
          aria-hidden="true"
        />
        <h1 className="mt-6 text-2xl font-semibold">
          Analyzing immutable snapshot
        </h1>
        <p className="mt-2 text-slate-400">
          {analysis.data?.stage ?? "queued"}
        </p>
        <div className="mx-auto mt-8 h-2 max-w-lg overflow-hidden rounded-full bg-slate-800">
          <div className="h-full w-2/3 animate-pulse rounded-full bg-cyan-400" />
        </div>
        <p className="mt-5 text-sm text-slate-500">
          Progress is reported by stage, not a made-up percentage.
        </p>
      </main>
    );
  }

  return (
    <DashboardView
      data={dashboard.data}
      onNewScan={onNewScan}
      onRefresh={() =>
        void queryClient.invalidateQueries({
          queryKey: ["dashboard", analysisId],
        })
      }
    />
  );
}

function DashboardView({
  data,
  onNewScan,
  onRefresh,
}: {
  data: Awaited<ReturnType<typeof api.dashboard>>;
  onNewScan: () => void;
  onRefresh: () => void;
}) {
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [dimension, setDimension] = useState<Dimension | "all">("all");
  const [selectedFinding, setSelectedFinding] = useState<
    (Finding & { id: string }) | null
  >(null);
  const findings = useMemo(
    () =>
      data.findings.filter(
        (finding) =>
          (severity === "all" || finding.severity === severity) &&
          (dimension === "all" || finding.dimension === dimension),
      ),
    [data.findings, severity, dimension],
  );
  const severityData = (
    Object.entries(data.severityDistribution) as Array<[Severity, number]>
  ).map(([name, value]) => ({ name, value }));
  const timeline = useQuery({
    queryKey: ["timeline", data.repository.id],
    queryFn: () => api.timeline(data.repository.id),
  });

  return (
    <main className="mx-auto max-w-[1500px] px-5 py-8 sm:px-8">
      <section className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <GitCommitHorizontal size={16} aria-hidden="true" /> Immutable
            analysis · {new Date(data.analysis.createdAt).toLocaleString()}
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {data.repository.displayName}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            {data.profile?.projects.length ?? 0} projects ·{" "}
            {data.profile?.analyzedFileCount ?? 0} files · rule set{" "}
            {data.analysis.ruleSetVersion}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-900"
            onClick={onRefresh}
          >
            <RefreshCw size={15} aria-hidden="true" /> Refresh
          </button>
          <button
            className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950"
            onClick={onNewScan}
          >
            New scan
          </button>
        </div>
      </section>

      {data.analysis.warnings.length > 0 ? (
        <div className="mt-6 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline" size={16} aria-hidden="true" />
          Coverage warning: {data.analysis.warnings.join(" · ")}
        </div>
      ) : null}

      <Suspense
        fallback={
          <section className="mt-8 grid min-h-96 place-items-center rounded-2xl border border-slate-800 bg-slate-900/40">
            <p className="text-sm text-slate-400">
              Loading architecture workspace…
            </p>
          </section>
        }
      >
        <IntelligenceWorkspace analysisId={data.analysis.id} />
      </Suspense>

      <section
        className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5"
        aria-label="Engineering health scores"
      >
        <ScoreCard
          label="Overall"
          score={data.overallScore}
          state={data.overallScore === null ? "partial" : "assessed"}
          icon={<Activity size={18} aria-hidden="true" />}
        />
        {(
          [
            "architecture",
            "security",
            "performance",
            "scalability",
          ] as Dimension[]
        ).map((name) => {
          const scorecard = data.scorecards.find(
            (item) => item.dimension === name,
          );
          return (
            <ScoreCard
              key={name}
              label={name}
              score={scorecard?.score ?? null}
              state={scorecard?.assessmentState ?? "unavailable"}
              icon={
                name === "security" ? (
                  <ShieldCheck size={18} aria-hidden="true" />
                ) : name === "performance" ? (
                  <Clock3 size={18} aria-hidden="true" />
                ) : name === "scalability" ? (
                  <Database size={18} aria-hidden="true" />
                ) : (
                  <Activity size={18} aria-hidden="true" />
                )
              }
            />
          );
        })}
      </section>

      <Suspense
        fallback={
          <section className="mt-8 h-80 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/40" />
        }
      >
        <DashboardCharts severity={severityData} timeline={timeline.data} />
      </Suspense>

      <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Findings</h2>
            <p className="mt-1 text-sm text-slate-400">
              {findings.length} shown of {data.findings.length}. Select a row
              for evidence and remediation.
            </p>
          </div>
          <div className="flex gap-3">
            <Filter
              label="Severity"
              value={severity}
              values={["all", "critical", "high", "medium", "low", "info"]}
              onChange={(value) => setSeverity(value as Severity | "all")}
            />
            <Filter
              label="Dimension"
              value={dimension}
              values={[
                "all",
                "architecture",
                "security",
                "performance",
                "scalability",
              ]}
              onChange={(value) => setDimension(value as Dimension | "all")}
            />
          </div>
        </div>
        <div
          className={`mt-6 grid gap-6 ${selectedFinding ? "lg:grid-cols-[1fr_0.8fr]" : ""}`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-slate-700 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="pb-3 pr-4">Severity</th>
                  <th className="pb-3 pr-4">Finding</th>
                  <th className="pb-3 pr-4">Dimension</th>
                  <th className="pb-3">Location</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((finding) => (
                  <tr
                    key={finding.id}
                    className="cursor-pointer border-b border-slate-800 hover:bg-slate-800/40"
                    onClick={() => setSelectedFinding(finding)}
                  >
                    <td className="py-4 pr-4">
                      <SeverityBadge severity={finding.severity} />
                    </td>
                    <td className="py-4 pr-4">
                      <p className="font-medium text-slate-100">
                        {finding.title}
                      </p>
                      <p className="mt-1 font-mono text-xs text-slate-500">
                        {finding.ruleId}
                      </p>
                    </td>
                    <td className="py-4 pr-4 capitalize text-slate-300">
                      {finding.dimension}
                    </td>
                    <td className="max-w-xs truncate py-4 font-mono text-xs text-slate-400">
                      {finding.location.path}
                      {finding.location.lineStart
                        ? `:${finding.location.lineStart}`
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {findings.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">
                No findings match these filters.
              </p>
            ) : null}
          </div>
          {selectedFinding ? (
            <FindingDetail
              finding={selectedFinding}
              aiAvailable={data.aiAvailable}
              onClose={() => setSelectedFinding(null)}
            />
          ) : null}
        </div>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-lg font-semibold">Project profile</h2>
          <div className="mt-5 space-y-4">
            {data.profile?.projects.map((project) => (
              <div
                key={`${project.root}:${project.name}`}
                className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{project.name}</p>
                  <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs capitalize">
                    {project.kind}
                  </span>
                </div>
                <p className="mt-1 font-mono text-xs text-slate-500">
                  {project.root}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {project.frameworks.map((framework) => (
                    <span
                      key={`${project.root}:${framework.name}`}
                      className="rounded-md bg-cyan-400/10 px-2 py-1 text-xs text-cyan-200"
                    >
                      {framework.name} {framework.version}
                    </span>
                  ))}
                  {project.databases.map((database) => (
                    <span
                      key={`${project.root}:${database.name}`}
                      className="rounded-md bg-violet-400/10 px-2 py-1 text-xs text-violet-200"
                    >
                      {database.name} · {database.adapter}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-lg font-semibold">Score evidence</h2>
          <div className="mt-5 space-y-4">
            {data.scorecards.map((scorecard) => (
              <div key={scorecard.dimension}>
                <div className="flex justify-between text-sm">
                  <span className="capitalize">{scorecard.dimension}</span>
                  <span className="text-slate-400">
                    {scorecard.score ?? "Not measured"}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-cyan-400"
                    style={{ width: `${scorecard.score ?? 0}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {scorecard.deductions.length
                    ? scorecard.deductions
                        .map((item) => `${item.ruleId}: −${item.points}`)
                        .join(" · ")
                    : scorecard.assessmentState.replaceAll("_", " ")}
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <div className="mt-8">
        <PerformancePanel
          repositoryId={data.repository.id}
          analysisId={data.analysis.id}
          latestRun={data.latestPerformanceRun}
        />
      </div>
    </main>
  );
}

function ScoreCard({
  label,
  score,
  state,
  icon,
}: {
  label: string;
  score: number | null;
  state: string;
  icon: ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between text-slate-400">
        <span className="capitalize">{label}</span>
        {icon}
      </div>
      <p className="mt-4 text-4xl font-semibold">{score ?? "—"}</p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
        {score === null ? (
          <Clock3 size={13} aria-hidden="true" />
        ) : (
          <CheckCircle2
            size={13}
            className="text-emerald-400"
            aria-hidden="true"
          />
        )}
        {state.replaceAll("_", " ")}
      </p>
    </article>
  );
}
function SeverityBadge({ severity }: { severity: Severity }) {
  const style: Record<Severity, string> = {
    critical: "bg-rose-500/20 text-rose-200",
    high: "bg-orange-400/20 text-orange-200",
    medium: "bg-amber-300/20 text-amber-100",
    low: "bg-sky-400/20 text-sky-200",
    info: "bg-slate-600/30 text-slate-300",
  };
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${style[severity]}`}
    >
      {severity}
    </span>
  );
}
function Filter({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-xs text-slate-400">
      {label}
      <select
        className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm capitalize text-slate-200"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {values.map((item) => (
          <option key={item}>{item}</option>
        ))}
      </select>
    </label>
  );
}
function CenteredStatus({ text }: { text: string }) {
  return (
    <main className="grid min-h-[60vh] place-items-center">
      <p className="flex items-center gap-2 text-slate-300">
        <LoaderCircle className="animate-spin" size={18} aria-hidden="true" />
        {text}
      </p>
    </main>
  );
}
function CenteredError({
  message,
  onNewScan,
}: {
  message: string;
  onNewScan: () => void;
}) {
  return (
    <main className="mx-auto max-w-xl px-6 py-24 text-center">
      <AlertTriangle
        className="mx-auto text-rose-300"
        size={36}
        aria-hidden="true"
      />
      <h1 className="mt-5 text-2xl font-semibold">Analysis unavailable</h1>
      <p className="mt-3 text-slate-400">{message}</p>
      <button
        className="mt-6 rounded-lg bg-cyan-400 px-4 py-2 font-medium text-slate-950"
        onClick={onNewScan}
      >
        Start another scan
      </button>
    </main>
  );
}
