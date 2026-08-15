import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { Severity } from "@engineering-observatory/shared-types";

import type { TimelinePoint } from "./api";

export function DashboardCharts({
  severity,
  timeline,
}: {
  severity: Array<{ name: Severity; value: number }>;
  timeline: TimelinePoint[] | undefined;
}) {
  return (
    <section className="mt-8 grid gap-6 lg:grid-cols-2">
      <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="text-lg font-semibold">Severity distribution</h2>
        <p className="mt-1 text-sm text-slate-400">
          Deterministic findings in this snapshot.
        </p>
        <div
          className="mt-5 h-64"
          role="img"
          aria-label={severity
            .map((item) => `${item.name}: ${item.value}`)
            .join(", ")}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={severity}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "#94a3b8", fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: 8,
                }}
              />
              <Bar dataKey="value" fill="#22d3ee" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>
      <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="text-lg font-semibold">Issue timeline</h2>
        <p className="mt-1 text-sm text-slate-400">
          New, persistent, and resolved fingerprints across compatible completed
          scans.
        </p>
        {timeline && timeline.length > 0 ? (
          <div className="mt-5 h-64" role="img" aria-label="Finding timeline">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={timeline.map((point, index) => ({
                  ...point,
                  scan: `#${index + 1}`,
                }))}
              >
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="scan"
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0f172a",
                    border: "1px solid #334155",
                    borderRadius: 8,
                  }}
                />
                <Bar dataKey="new" stackId="issues" fill="#fb7185" />
                <Bar dataKey="persistent" stackId="issues" fill="#fbbf24" />
                <Bar
                  dataKey="resolved"
                  stackId="issues"
                  fill="#34d399"
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-10 text-sm text-slate-500">
            A second completed scan will make change history meaningful.
          </p>
        )}
      </article>
    </section>
  );
}
