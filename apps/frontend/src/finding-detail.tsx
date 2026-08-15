import { useQuery } from "@tanstack/react-query";
import { Bot, FileCode2, LoaderCircle, Sparkles, X } from "lucide-react";
import { useState } from "react";

import type {
  AIProviderName,
  AIReview,
  Finding,
} from "@engineering-observatory/shared-types";

import { api } from "./api";

type Props = {
  finding: Finding & { id: string };
  aiAvailable: boolean;
  onClose: () => void;
};

export function FindingDetail({ finding, aiAvailable, onClose }: Props) {
  const providers = useQuery({
    queryKey: ["ai-providers"],
    queryFn: api.providers,
    enabled: aiAvailable,
  });
  const [provider, setProvider] = useState<AIProviderName>("ollama");
  const [review, setReview] = useState<AIReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const reviewQuery = useQuery({
    queryKey: ["ai-review", review?.id],
    queryFn: () => api.review(review!.id),
    enabled: Boolean(
      review && review.state !== "completed" && review.state !== "failed",
    ),
    refetchInterval: (query) => {
      const state = (query.state.data as AIReview | undefined)?.state;
      return state === "completed" || state === "failed" ? false : 1_000;
    },
  });
  const currentReview = reviewQuery.data ?? review;
  const selectedProvider =
    providers.data?.find(
      (item) => item.configured && item.provider === provider,
    )?.provider ??
    providers.data?.find((item) => item.configured)?.provider ??
    provider;

  async function requestReview() {
    setCreating(true);
    setError(null);
    try {
      setReview(await api.createReview(finding.id, selectedProvider));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not request review",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <aside
      className="rounded-2xl border border-slate-700 bg-slate-900 p-6 lg:sticky lg:top-6"
      aria-label="Finding details"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-cyan-300">{finding.ruleId}</p>
          <h2 className="mt-2 text-xl font-semibold">{finding.title}</h2>
        </div>
        <button
          className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
          onClick={onClose}
          aria-label="Close finding details"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-slate-800 px-2.5 py-1 capitalize">
          {finding.severity}
        </span>
        <span className="rounded-full bg-slate-800 px-2.5 py-1 capitalize">
          {finding.confidence} confidence
        </span>
        <span className="rounded-full bg-slate-800 px-2.5 py-1 capitalize">
          {finding.dimension}
        </span>
      </div>

      <p className="mt-5 leading-7 text-slate-300">{finding.description}</p>
      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <FileCode2 size={16} className="text-cyan-300" aria-hidden="true" />{" "}
          Evidence
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          {finding.evidence.observed}
        </p>
        {finding.evidence.excerpt ? (
          <pre className="mt-3 overflow-x-auto rounded-lg bg-black/30 p-3 text-xs text-slate-300">
            <code>{finding.evidence.excerpt}</code>
          </pre>
        ) : null}
        <p className="mt-3 font-mono text-xs text-slate-500">
          {finding.location.path}
          {finding.location.lineStart ? `:${finding.location.lineStart}` : ""}
        </p>
        {finding.evidence.limitations.map((limitation) => (
          <p key={limitation} className="mt-2 text-xs text-amber-200/80">
            Limit: {limitation}
          </p>
        ))}
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Deterministic remediation
        </h3>
        <p className="mt-2 leading-7 text-slate-200">{finding.remediation}</p>
      </div>

      <div className="mt-6 border-t border-slate-800 pt-6">
        <p className="flex items-center gap-2 font-medium">
          <Bot size={18} className="text-violet-300" aria-hidden="true" />{" "}
          Optional AI review
        </p>
        {!aiAvailable ? (
          <p className="mt-2 text-sm text-slate-400">
            No provider is configured. The finding remains fully usable without
            AI.
          </p>
        ) : currentReview?.state === "completed" &&
          currentReview.recommendation ? (
          <div className="mt-4 space-y-4 text-sm leading-6">
            <ReviewSection
              title="Explanation"
              text={currentReview.recommendation.explanation}
            />
            <ReviewSection
              title="Production impact"
              text={currentReview.recommendation.productionImpact}
            />
            <ReviewSection
              title="Recommended solution"
              text={currentReview.recommendation.recommendedSolution}
            />
            <ReviewSection
              title="Alternatives"
              text={currentReview.recommendation.alternatives.join(" · ")}
            />
            <ReviewSection
              title="Trade-offs"
              text={currentReview.recommendation.tradeoffs.join(" · ")}
            />
            <p className="text-xs text-slate-500">
              Generated by {currentReview.provider} · {currentReview.model}.
              Evidence and score were not changed.
            </p>
          </div>
        ) : currentReview ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-slate-300">
            <LoaderCircle
              className="animate-spin"
              size={16}
              aria-hidden="true"
            />{" "}
            Review {currentReview.state}…
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-3">
            <select
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={selectedProvider}
              onChange={(event) =>
                setProvider(event.target.value as AIProviderName)
              }
            >
              {providers.data
                ?.filter((item) => item.configured)
                .map((item) => (
                  <option key={item.provider} value={item.provider}>
                    {item.provider} · {item.model}
                  </option>
                ))}
            </select>
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-violet-400 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
              disabled={
                creating || !providers.data?.some((item) => item.configured)
              }
              onClick={() => void requestReview()}
            >
              <Sparkles size={16} aria-hidden="true" /> Explain finding
            </button>
          </div>
        )}
        {error ? (
          <p className="mt-3 text-sm text-rose-300" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function ReviewSection({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h4 className="font-medium text-violet-200">{title}</h4>
      <p className="mt-1 text-slate-300">{text}</p>
    </div>
  );
}
