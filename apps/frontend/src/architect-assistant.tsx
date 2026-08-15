import { useMutation, useQuery } from "@tanstack/react-query";
import { BrainCircuit, Send } from "lucide-react";
import { useState } from "react";

import type { AIProviderName } from "@engineering-observatory/shared-types";

import { api } from "./api";

export function ArchitectAssistant({
  analysisId,
  nodeId,
  filePath,
  selectionName,
}: {
  analysisId: string;
  nodeId?: string;
  filePath?: string;
  selectionName?: string;
}) {
  const providers = useQuery({
    queryKey: ["ai-providers"],
    queryFn: api.providers,
  });
  const configured =
    providers.data?.filter((provider) => provider.configured) ?? [];
  const [provider, setProvider] = useState<AIProviderName | "">("");
  const selectedProvider = provider || configured[0]?.provider || "";
  const scope = selectionName ?? "";
  const defaultQuestion = selectionName
    ? `Can I safely refactor ${selectionName}?`
    : "What is the safest way to improve this frontend architecture?";
  const [draft, setDraft] = useState({ scope, value: defaultQuestion });
  const question = draft.scope === scope ? draft.value : defaultQuestion;

  const review = useMutation({
    mutationFn: () =>
      api.architectReview(analysisId, {
        provider: selectedProvider as AIProviderName,
        question,
        ...(nodeId ? { nodeId } : {}),
        ...(!nodeId && filePath ? { filePath } : {}),
      }),
  });

  return (
    <section className="mt-6 rounded-2xl border border-violet-400/20 bg-violet-400/5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-violet-400/10 text-violet-300">
            <BrainCircuit size={21} />
          </span>
          <div>
            <h3 className="font-semibold">AI architect explanation</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
              The model receives the selected graph slice, deterministic impact,
              related tests, issues, and analysis limitations. It cannot scan,
              score, execute tools, or change the repository.
            </p>
          </div>
        </div>
        <select
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          value={selectedProvider}
          onChange={(event) =>
            setProvider(event.target.value as AIProviderName)
          }
          disabled={configured.length === 0}
          aria-label="AI provider"
        >
          {configured.length === 0 ? (
            <option value="">No provider configured</option>
          ) : null}
          {configured.map((item) => (
            <option key={item.provider} value={item.provider}>
              {item.provider} · {item.model}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <textarea
          className="min-h-24 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm leading-6"
          value={question}
          onChange={(event) => setDraft({ scope, value: event.target.value })}
          placeholder="Ask about refactoring risk, boundaries, tests, or alternatives…"
          maxLength={2_000}
        />
        <button
          className="inline-flex items-center justify-center gap-2 self-stretch rounded-xl bg-violet-400 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-40 sm:self-auto"
          disabled={
            !selectedProvider || question.trim().length < 3 || review.isPending
          }
          onClick={() => review.mutate()}
        >
          <Send size={16} /> {review.isPending ? "Reviewing…" : "Ask architect"}
        </button>
      </div>
      {configured.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          Configure OpenAI, Claude, Gemini, or Ollama to enable explanations.
          The architecture map and impact analysis remain fully functional
          without AI.
        </p>
      ) : null}
      {review.isError ? (
        <p className="mt-4 text-sm text-rose-300">{review.error.message}</p>
      ) : null}
      {review.data ? (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <article className="rounded-xl border border-slate-800 bg-slate-950/70 p-5">
            <h4 className="text-sm font-semibold text-violet-300">
              Explanation
            </h4>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {review.data.recommendation.explanation}
            </p>
            <h4 className="mt-5 text-sm font-semibold text-violet-300">
              Production impact
            </h4>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {review.data.recommendation.productionImpact}
            </p>
          </article>
          <article className="rounded-xl border border-slate-800 bg-slate-950/70 p-5">
            <h4 className="text-sm font-semibold text-violet-300">
              Recommended approach
            </h4>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {review.data.recommendation.recommendedSolution}
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Alternatives
                </div>
                {review.data.recommendation.alternatives.map((item) => (
                  <p
                    key={item}
                    className="mt-2 text-xs leading-5 text-slate-400"
                  >
                    • {item}
                  </p>
                ))}
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Trade-offs
                </div>
                {review.data.recommendation.tradeoffs.map((item) => (
                  <p
                    key={item}
                    className="mt-2 text-xs leading-5 text-slate-400"
                  >
                    • {item}
                  </p>
                ))}
              </div>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}
