import { readFile, stat } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { create as createArchive } from "tar";
import * as vscode from "vscode";

import type {
  AIProviderName,
  AnalysisRecord,
  ArchitectureEdge,
  ArchitectureGraph,
  ArchitectureNode,
  ArchitectureReviewResponse,
  ChangeImpact,
} from "@engineering-observatory/shared-types";

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const FINAL_STATES = new Set([
  "completed",
  "completed_with_warnings",
  "failed",
]);

type ProviderAvailability = {
  provider: AIProviderName;
  configured: boolean;
  model: string | null;
};

function configuration() {
  const values = vscode.workspace.getConfiguration("frontendIntelligence");
  return {
    apiBaseUrl: values
      .get<string>("apiBaseUrl", "http://127.0.0.1:3333/api/v1")
      .replace(/\/$/, ""),
    dashboardUrl: values
      .get<string>("dashboardUrl", "http://127.0.0.1:5173")
      .replace(/\/$/, ""),
    analysisId: values.get<string>("analysisId", "").trim(),
  };
}

async function request<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(
    `${configuration().apiBaseUrl}${pathname}`,
    init,
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      detail?: string;
      title?: string;
    };
    throw new Error(
      body.detail ?? body.title ?? `Request failed with ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}

function workspaceRoot() {
  const active = vscode.window.activeTextEditor?.document.uri;
  const folder = active
    ? vscode.workspace.getWorkspaceFolder(active)
    : undefined;
  return folder ?? vscode.workspace.workspaceFolders?.[0];
}

function activeFilePath() {
  const editor = vscode.window.activeTextEditor;
  const folder = editor
    ? vscode.workspace.getWorkspaceFolder(editor.document.uri)
    : undefined;
  if (!editor || !folder || editor.document.uri.scheme !== "file")
    return undefined;
  return path
    .relative(folder.uri.fsPath, editor.document.uri.fsPath)
    .replaceAll(path.sep, "/");
}

async function requireAnalysisId() {
  const id = configuration().analysisId;
  if (id) return id;
  const entered = await vscode.window.showInputBox({
    title: "Engineering Observatory analysis",
    prompt: "Paste an immutable analysis ID or run Analyze Workspace first",
    ignoreFocusOut: true,
  });
  if (!entered?.trim()) throw new Error("An analysis ID is required");
  await vscode.workspace
    .getConfiguration("frontendIntelligence")
    .update("analysisId", entered.trim(), vscode.ConfigurationTarget.Workspace);
  return entered.trim();
}

function excludedFromArchive(entryPath: string) {
  const segments = entryPath.split(/[\\/]/).filter(Boolean);
  return !segments.some((segment) =>
    [
      ".git",
      ".nx",
      ".observatory",
      "coverage",
      "dist",
      "node_modules",
    ].includes(segment),
  );
}

async function createWorkspaceArchive(root: string) {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "frontend-intelligence-vscode-"),
  );
  const archivePath = path.join(temporaryDirectory, "workspace.tgz");
  await createArchive(
    {
      cwd: root,
      file: archivePath,
      gzip: true,
      portable: true,
      filter: excludedFromArchive,
    },
    ["."],
  );
  const info = await stat(archivePath);
  if (info.size > MAX_ARCHIVE_BYTES) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw new Error(
      `Workspace archive is ${(info.size / 1024 / 1024).toFixed(1)} MB; the backend limit is 25 MB`,
    );
  }
  return { temporaryDirectory, archivePath };
}

async function analyzeWorkspace() {
  if (!vscode.workspace.isTrusted) {
    throw new Error(
      "Trust this workspace before sending its source to the configured backend",
    );
  }
  const folder = workspaceRoot();
  if (!folder) throw new Error("Open a project folder first");

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Engineering Observatory",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Creating bounded source archive…" });
      const { temporaryDirectory, archivePath } = await createWorkspaceArchive(
        folder.uri.fsPath,
      );
      try {
        const bytes = await readFile(archivePath);
        const form = new FormData();
        form.set("displayName", folder.name);
        form.set("archive", new Blob([bytes]), `${folder.name}.tgz`);
        progress.report({ message: "Uploading immutable snapshot…" });
        const source = await request<{ snapshot: { id: string } }>(
          "/repositories/archive",
          {
            method: "POST",
            body: form,
          },
        );
        const created = await request<{ analysisId: string }>("/analyses", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ snapshotId: source.snapshot.id }),
        });
        progress.report({ message: "Building architecture graph…" });
        let analysis: AnalysisRecord;
        do {
          await new Promise((resolve) => setTimeout(resolve, 750));
          analysis = await request<AnalysisRecord>(
            `/analyses/${created.analysisId}`,
          );
        } while (!FINAL_STATES.has(analysis.state));
        if (analysis.state === "failed")
          throw new Error(analysis.failureCode ?? "Analysis failed");
        await vscode.workspace
          .getConfiguration("frontendIntelligence")
          .update(
            "analysisId",
            created.analysisId,
            vscode.ConfigurationTarget.Workspace,
          );
        void vscode.window.showInformationMessage(
          `Engineering Observatory mapped ${folder.name}. Analysis ${created.analysisId.slice(0, 8)} is ready.`,
        );
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    },
  );
}

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function panel(
  title: string,
  summary: string,
  rows: Array<[string, string, string]>,
) {
  const view = vscode.window.createWebviewPanel(
    "frontendIntelligence",
    title,
    vscode.ViewColumn.Beside,
    { enableScripts: false },
  );
  view.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
    body{font-family:var(--vscode-font-family);padding:20px;color:var(--vscode-foreground)}
    h1{font-size:20px}p{color:var(--vscode-descriptionForeground);line-height:1.5}
    table{border-collapse:collapse;width:100%;margin-top:18px}th,td{border-bottom:1px solid var(--vscode-panel-border);padding:9px;text-align:left;vertical-align:top}
    th{font-size:11px;text-transform:uppercase;color:var(--vscode-descriptionForeground)}code{font-family:var(--vscode-editor-font-family);font-size:12px}
  </style></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(summary)}</p><table><thead><tr><th>Relationship</th><th>Symbol</th><th>Evidence</th></tr></thead><tbody>
  ${rows.map(([kind, symbol, evidence]) => `<tr><td>${escapeHtml(kind)}</td><td><code>${escapeHtml(symbol)}</code></td><td><code>${escapeHtml(evidence)}</code></td></tr>`).join("") || '<tr><td colspan="3">No statically resolved relationships.</td></tr>'}
  </tbody></table></body></html>`;
}

function selectedNodes(graph: ArchitectureGraph, filePath: string | undefined) {
  if (!filePath) return [];
  return graph.nodes.filter((node) => node.location.path === filePath);
}

function relationshipRows(
  graph: ArchitectureGraph,
  edges: ArchitectureEdge[],
): Array<[string, string, string]> {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    return [
      edge.kind,
      `${source?.name ?? "?"} → ${target?.name ?? "?"}`,
      `${edge.evidence.path}:${edge.evidence.lineStart} · ${edge.confidence}`,
    ];
  });
}

async function graphContext() {
  const analysisId = await requireAnalysisId();
  const graph = await request<ArchitectureGraph>(
    `/analyses/${analysisId}/architecture`,
  );
  return { analysisId, graph, filePath: activeFilePath() };
}

async function showDependencies() {
  const { graph, filePath } = await graphContext();
  if (!filePath)
    throw new Error("Open a source file inside the workspace first");
  const ids = new Set(selectedNodes(graph, filePath).map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) => ids.has(edge.source) || ids.has(edge.target),
  );
  panel("File dependencies", filePath, relationshipRows(graph, edges));
}

async function showImpact() {
  const analysisId = await requireAnalysisId();
  const filePath = activeFilePath();
  if (!filePath)
    throw new Error("Open a source file inside the workspace first");
  const query = new URLSearchParams({ filePath });
  const impact = await request<ChangeImpact>(
    `/analyses/${analysisId}/impact?${query.toString()}`,
  );
  const graph = await request<ArchitectureGraph>(
    `/analyses/${analysisId}/architecture`,
  );
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  panel(
    "Change impact",
    `${filePath} · ${impact.risk} risk · ${impact.counts.totalNodes} nodes across ${impact.affectedFiles.length} files`,
    impact.paths.map((nodeIds) => {
      const pathNodes = nodeIds
        .map((id) => nodes.get(id))
        .filter((node): node is ArchitectureNode => Boolean(node));
      return [
        "depends on",
        pathNodes.map((node) => node.name).join(" → "),
        pathNodes
          .map((node) => `${node.location.path}:${node.location.lineStart}`)
          .join(" → "),
      ];
    }),
  );
}

async function showFlow(kind: "state" | "api") {
  const { graph, filePath } = await graphContext();
  const allowed =
    kind === "state"
      ? new Set(["reads-state", "writes-state", "dispatches", "selects"])
      : new Set(["calls-api"]);
  const fileIds = new Set(
    selectedNodes(graph, filePath).map((node) => node.id),
  );
  let edges = graph.edges.filter((edge) => allowed.has(edge.kind));
  if (fileIds.size > 0) {
    const adjacent = new Set(
      edges
        .filter((edge) => fileIds.has(edge.source) || fileIds.has(edge.target))
        .flatMap((edge) => [edge.source, edge.target]),
    );
    edges = edges.filter(
      (edge) => adjacent.has(edge.source) || adjacent.has(edge.target),
    );
  }
  panel(
    kind === "state" ? "State flow" : "API flow",
    filePath
      ? `Resolved flow around ${filePath}`
      : "All resolved repository flow",
    relationshipRows(graph, edges),
  );
}

async function explainComponent() {
  const { analysisId, graph, filePath } = await graphContext();
  if (!filePath)
    throw new Error("Open a source file inside the workspace first");
  const providers = await request<ProviderAvailability[]>("/ai/providers");
  const configured = providers.filter((provider) => provider.configured);
  if (configured.length === 0) {
    throw new Error("No optional AI provider is configured on the backend");
  }
  const selected = await vscode.window.showQuickPick(
    configured.map((provider) => ({
      label: provider.provider,
      description: provider.model ?? "configured",
      provider: provider.provider,
    })),
    { title: "Choose an explanation provider" },
  );
  if (!selected) return;
  const question = await vscode.window.showInputBox({
    title: "Ask the architecture reviewer",
    value: `Explain the responsibilities, dependencies, and change risks for ${filePath}.`,
    ignoreFocusOut: true,
  });
  if (!question?.trim()) return;
  const node = selectedNodes(graph, filePath).find((item) =>
    ["component", "page", "hook", "service"].includes(item.kind),
  );
  const review = await request<ArchitectureReviewResponse>(
    `/analyses/${analysisId}/architect-review`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: selected.provider,
        question: question.trim(),
        filePath,
        ...(node ? { nodeId: node.id } : {}),
      }),
    },
  );
  panel("Architect explanation", review.recommendation.explanation, [
    ["Production impact", review.recommendation.productionImpact, filePath],
    [
      "Recommended solution",
      review.recommendation.recommendedSolution,
      selected.provider,
    ],
    [
      "Alternatives",
      review.recommendation.alternatives.join(" · "),
      "Model-generated; graph-grounded",
    ],
    [
      "Trade-offs",
      review.recommendation.tradeoffs.join(" · "),
      "Model-generated; verify before changing code",
    ],
  ]);
}

async function openDashboard() {
  const analysisId = await requireAnalysisId();
  const url = vscode.Uri.parse(
    `${configuration().dashboardUrl}/?analysis=${encodeURIComponent(analysisId)}`,
  );
  await vscode.env.openExternal(url);
}

function guarded(command: () => Promise<void>) {
  return async () => {
    try {
      await command();
    } catch (error) {
      void vscode.window.showErrorMessage(
        error instanceof Error
          ? error.message
          : "Engineering Observatory command failed",
      );
    }
  };
}

export function activate(context: vscode.ExtensionContext) {
  const commands: Array<[string, () => Promise<void>]> = [
    ["frontendIntelligence.analyzeArchitecture", analyzeWorkspace],
    ["frontendIntelligence.openDashboard", openDashboard],
    ["frontendIntelligence.showDependencies", showDependencies],
    ["frontendIntelligence.showImpact", showImpact],
    ["frontendIntelligence.findStateFlow", () => showFlow("state")],
    ["frontendIntelligence.findApiFlow", () => showFlow("api")],
    ["frontendIntelligence.explainComponent", explainComponent],
  ];
  context.subscriptions.push(
    ...commands.map(([name, command]) =>
      vscode.commands.registerCommand(name, guarded(command)),
    ),
  );
}

export function deactivate() {}
