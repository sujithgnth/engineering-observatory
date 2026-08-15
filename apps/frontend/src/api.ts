import type {
  AIProviderName,
  AIReview,
  AnalysisRecord,
  ArchitectureGraph,
  ArchitectureReviewResponse,
  ChangeImpact,
  Dashboard,
  PerformanceRun,
  PerformanceScenarioInput,
  RepositoryRecord,
} from "@engineering-observatory/shared-types";

type Problem = { detail?: string; title?: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, init);
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as Problem;
    throw new Error(
      problem.detail ??
        problem.title ??
        `Request failed with ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}

export type SourceCreated = {
  repository: RepositoryRecord;
  snapshot: {
    id: string;
    repositoryId: string;
    sourceKind: "archive" | "github";
    commitSha: string | null;
    archiveSha256: string | null;
    resolvedRef: string | null;
    state: "ready" | "rejected" | "expired";
    createdAt: string;
  };
};

export type ProviderAvailability = {
  provider: AIProviderName;
  configured: boolean;
  model: string | null;
};

export type TimelinePoint = {
  analysisId: string;
  createdAt: string;
  total: number;
  new: number;
  persistent: number;
  resolved: number;
};

export const api = {
  repositories: () => request<RepositoryRecord[]>("/repositories"),
  analyses: (repositoryId: string) =>
    request<AnalysisRecord[]>(`/repositories/${repositoryId}/analyses`),
  timeline: (repositoryId: string) =>
    request<TimelinePoint[]>(`/repositories/${repositoryId}/timeline`),
  upload: async (file: File, displayName: string) => {
    const form = new FormData();
    form.set("archive", file);
    form.set("displayName", displayName);
    return request<SourceCreated>("/repositories/archive", {
      method: "POST",
      body: form,
    });
  },
  github: (repositoryUrl: string, ref: string) =>
    request<SourceCreated>("/repositories/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repositoryUrl, ref }),
    }),
  createAnalysis: (snapshotId: string) =>
    request<{ analysisId: string; state: string; statusUrl: string }>(
      "/analyses",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshotId }),
      },
    ),
  analysis: (analysisId: string) =>
    request<AnalysisRecord>(`/analyses/${analysisId}`),
  dashboard: (analysisId: string) =>
    request<Dashboard>(`/analyses/${analysisId}/dashboard`),
  architecture: (analysisId: string) =>
    request<ArchitectureGraph>(`/analyses/${analysisId}/architecture`),
  impact: (
    analysisId: string,
    selection: { nodeId?: string; filePath?: string },
  ) => {
    const search = new URLSearchParams();
    if (selection.nodeId) search.set("nodeId", selection.nodeId);
    if (selection.filePath) search.set("filePath", selection.filePath);
    return request<ChangeImpact>(
      `/analyses/${analysisId}/impact?${search.toString()}`,
    );
  },
  source: (analysisId: string, filePath: string) =>
    request<{
      path: string;
      content: string;
      byteSize: number;
      contentHash: string;
    }>(
      `/analyses/${analysisId}/source?${new URLSearchParams({ path: filePath }).toString()}`,
    ),
  providers: () => request<ProviderAvailability[]>("/ai/providers"),
  createReview: (findingId: string, provider: AIProviderName) =>
    request<AIReview>(`/findings/${findingId}/ai-reviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider }),
    }),
  review: (reviewId: string) => request<AIReview>(`/ai-reviews/${reviewId}`),
  architectReview: (
    analysisId: string,
    input: {
      provider: AIProviderName;
      question: string;
      nodeId?: string;
      filePath?: string;
    },
  ) =>
    request<ArchitectureReviewResponse>(
      `/analyses/${analysisId}/architect-review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    ),
  createPerformanceRun: (scenario: PerformanceScenarioInput) =>
    request<PerformanceRun>("/performance-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scenario),
    }),
  performanceRun: (runId: string) =>
    request<PerformanceRun>(`/performance-runs/${runId}`),
};
