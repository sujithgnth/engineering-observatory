import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle2,
  FolderOpen,
  GitBranch,
  KeyRound,
  LoaderCircle,
  Play,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "./api";
import { buildFolderArchive, selectedFolderName } from "./folder-archive";

type Props = { onAnalysisCreated: (analysisId: string) => void };
type SourceMode = "folder" | "github" | "archive";

export function SourcePanel({ onAnalysisCreated }: Props) {
  const desktop = window.engineeringObservatory;
  const queryClient = useQueryClient();
  const repositories = useQuery({
    queryKey: ["repositories"],
    queryFn: api.repositories,
  });
  const [mode, setMode] = useState<SourceMode>("folder");
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [desktopSelection, setDesktopSelection] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [reference, setReference] = useState("main");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Creating analysis…");
  const [error, setError] = useState<string | null>(null);
  const [githubToken, setGithubToken] = useState("");
  const [githubCredential, setGithubCredential] = useState<{
    configured: boolean;
    source: "secure-store" | "environment" | "none";
    encryptionAvailable: boolean;
  } | null>(null);
  const [credentialBusy, setCredentialBusy] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    void desktop
      .githubStatus()
      .then(setGithubCredential)
      .catch(() => setGithubCredential(null));
  }, [desktop]);

  async function chooseDesktopRepository() {
    if (!desktop) return;
    setError(null);
    try {
      const selected = await desktop.chooseRepository();
      if (!selected) return;
      setDesktopSelection(selected);
      if (!displayName.trim()) setDisplayName(selected.name);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not open the project folder",
      );
    }
  }

  async function configureGithubToken() {
    if (!desktop) return;
    setCredentialBusy(true);
    setError(null);
    try {
      const status = await desktop.configureGithubToken(githubToken.trim());
      setGithubCredential(status);
      setGithubToken("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save the GitHub credential",
      );
    } finally {
      setCredentialBusy(false);
    }
  }

  async function clearGithubToken() {
    if (!desktop) return;
    setCredentialBusy(true);
    setError(null);
    try {
      setGithubCredential(await desktop.clearGithubToken());
      setGithubToken("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not clear the GitHub credential",
      );
    } finally {
      setCredentialBusy(false);
    }
  }

  async function createFromSource() {
    setBusy(true);
    setBusyLabel("Preparing source…");
    setError(null);
    try {
      let source;
      if (mode === "folder") {
        if (desktop) {
          if (!desktopSelection)
            throw new Error("Choose a project folder first");
          setBusyLabel("Packaging and uploading project…");
          source = await desktop.uploadRepository(
            desktopSelection.id,
            displayName.trim() || desktopSelection.name,
          );
          setDesktopSelection(null);
        } else {
          const archive = await buildFolderArchive(folderFiles);
          setBusyLabel("Uploading folder…");
          source = await api.upload(
            archive,
            displayName.trim() || selectedFolderName(folderFiles),
          );
        }
      } else if (mode === "archive") {
        if (!file) throw new Error("Choose an archive first");
        setBusyLabel("Uploading archive…");
        source = await api.upload(file, displayName.trim() || file.name);
      } else {
        setBusyLabel("Fetching GitHub snapshot…");
        source = await api.github(repositoryUrl, reference);
      }
      setBusyLabel("Creating analysis…");
      const analysis = await api.createAnalysis(source.snapshot.id);
      await queryClient.invalidateQueries({ queryKey: ["repositories"] });
      onAnalysisCreated(analysis.analysisId);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create analysis",
      );
    } finally {
      setBusy(false);
    }
  }

  async function openLatest(repositoryId: string) {
    setBusy(true);
    setError(null);
    try {
      const analyses = await api.analyses(repositoryId);
      const latest = analyses[0];
      if (!latest) throw new Error("This repository has no analysis yet");
      onAnalysisCreated(latest.id);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load analysis",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid max-w-7xl gap-10 px-6 py-14 lg:grid-cols-[1.15fr_0.85fr]">
      <section>
        <p className="mb-4 text-sm font-medium uppercase tracking-[0.2em] text-cyan-300">
          Deterministic frontend architecture intelligence
        </p>
        <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
          Understand a frontend before you change it.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
          Map React, Angular, and Next.js components, routes, state, services,
          API calls, tests, and change impact. Every relationship links back to
          source evidence.
        </p>

        <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div
            className="flex flex-wrap gap-2 border-b border-slate-800 pb-5"
            role="tablist"
            aria-label="Repository source"
          >
            <button
              className={`rounded-lg px-4 py-2 text-sm font-medium ${mode === "folder" ? "bg-cyan-400 text-slate-950" : "text-slate-300 hover:bg-slate-800"}`}
              onClick={() => setMode("folder")}
              role="tab"
              aria-selected={mode === "folder"}
            >
              <FolderOpen
                className="mr-2 inline"
                size={16}
                aria-hidden="true"
              />{" "}
              Local folder
            </button>
            <button
              className={`rounded-lg px-4 py-2 text-sm font-medium ${mode === "github" ? "bg-cyan-400 text-slate-950" : "text-slate-300 hover:bg-slate-800"}`}
              onClick={() => setMode("github")}
              role="tab"
              aria-selected={mode === "github"}
            >
              <GitBranch className="mr-2 inline" size={16} aria-hidden="true" />{" "}
              GitHub URL
            </button>
            <button
              className={`rounded-lg px-4 py-2 text-sm font-medium ${mode === "archive" ? "bg-cyan-400 text-slate-950" : "text-slate-300 hover:bg-slate-800"}`}
              onClick={() => setMode("archive")}
              role="tab"
              aria-selected={mode === "archive"}
            >
              <Upload className="mr-2 inline" size={16} aria-hidden="true" />{" "}
              Archive
            </button>
          </div>

          {mode === "folder" ? (
            <div className="mt-6 grid gap-4">
              <label className="grid gap-2 text-sm font-medium">
                Project name
                <input
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Checkout service"
                />
              </label>
              {desktop ? (
                <div className="grid gap-2 text-sm font-medium">
                  Project folder
                  <button
                    type="button"
                    className="flex items-center gap-3 rounded-lg border border-dashed border-slate-600 bg-slate-950 px-4 py-5 text-left hover:border-cyan-400"
                    onClick={() => void chooseDesktopRepository()}
                  >
                    <FolderOpen size={20} className="text-cyan-300" />
                    <span>
                      <span className="block text-slate-100">
                        {desktopSelection?.name ?? "Choose project folder"}
                      </span>
                      <span className="mt-1 block text-xs font-normal text-slate-400">
                        Native desktop selection; the browser never receives an
                        arbitrary filesystem path.
                      </span>
                    </span>
                  </button>
                </div>
              ) : (
                <label className="grid gap-2 text-sm font-medium">
                  Project folder
                  <input
                    className="rounded-lg border border-dashed border-slate-600 bg-slate-950 px-3 py-5 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-200"
                    type="file"
                    multiple
                    ref={(element) => {
                      if (element) element.webkitdirectory = true;
                    }}
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      setFolderFiles(files);
                      if (!displayName.trim() && files.length > 0) {
                        setDisplayName(selectedFolderName(files));
                      }
                    }}
                  />
                </label>
              )}
              <p className="text-sm leading-6 text-slate-400">
                {!desktop && folderFiles.length > 0
                  ? `${folderFiles.length.toLocaleString()} files selected. `
                  : null}
                Nothing is installed or executed. Generated folders such as
                node_modules, dist, coverage, and .git are skipped.{" "}
                {desktop
                  ? "Desktop acquisition supports up to 20,000 files and 150 MB before the existing 25 MB compressed API boundary."
                  : "Browser acquisition is capped at 5,000 files and 50 MB before upload."}
              </p>
            </div>
          ) : null}

          {mode === "github" ? (
            <div className="mt-6 grid gap-4">
              <label className="grid gap-2 text-sm font-medium">
                GitHub repository URL
                <input
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5"
                  type="url"
                  value={repositoryUrl}
                  onChange={(event) => setRepositoryUrl(event.target.value)}
                  placeholder="https://github.com/openai/openai-node"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Branch, tag, or commit
                <input
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              </label>
              <p className="text-sm leading-6 text-slate-400">
                Public repositories work immediately. Private repositories
                require GitHub access. The resolved commit is stored with the
                analysis.
              </p>
              {desktop ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {githubCredential?.configured ? (
                        <CheckCircle2
                          size={16}
                          className="text-emerald-300"
                          aria-hidden="true"
                        />
                      ) : (
                        <KeyRound
                          size={16}
                          className="text-amber-300"
                          aria-hidden="true"
                        />
                      )}
                      Private GitHub access
                    </p>
                    <span className="text-xs text-slate-400">
                      {githubCredential?.configured
                        ? `Configured via ${githubCredential.source.replace("-", " ")}`
                        : "Not configured"}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                      type="password"
                      autoComplete="off"
                      value={githubToken}
                      onChange={(event) => setGithubToken(event.target.value)}
                      placeholder="Fine-grained GitHub token"
                    />
                    <button
                      type="button"
                      className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700 disabled:opacity-50"
                      disabled={
                        credentialBusy ||
                        githubToken.trim().length < 20 ||
                        githubCredential?.encryptionAvailable === false
                      }
                      onClick={() => void configureGithubToken()}
                    >
                      Save encrypted token
                    </button>
                    {githubCredential?.source === "secure-store" ? (
                      <button
                        type="button"
                        className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
                        disabled={credentialBusy}
                        onClick={() => void clearGithubToken()}
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-400">
                    The token is encrypted by the operating system credential
                    service and passed only to the local GitHub adapter. Use a
                    fine-grained token limited to repository contents read.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {mode === "archive" ? (
            <div className="mt-6 grid gap-4">
              <label className="grid gap-2 text-sm font-medium">
                Project name
                <input
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Checkout service"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                ZIP, TAR, TAR.GZ, or TGZ — maximum 25 MB
                <input
                  className="rounded-lg border border-dashed border-slate-600 bg-slate-950 px-3 py-5 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-200"
                  type="file"
                  accept=".zip,.tar,.tar.gz,.tgz"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          ) : null}

          {error ? (
            <p className="mt-4 text-sm text-rose-300" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-5 py-3 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={
              busy ||
              (mode === "folder"
                ? desktop
                  ? !desktopSelection
                  : folderFiles.length === 0
                : mode === "archive"
                  ? !file
                  : !repositoryUrl.trim() || !reference.trim())
            }
            onClick={() => void createFromSource()}
          >
            {busy ? (
              <LoaderCircle
                className="animate-spin"
                size={18}
                aria-hidden="true"
              />
            ) : (
              <Play size={18} aria-hidden="true" />
            )}
            {busy ? busyLabel : "Analyze repository"}
          </button>
        </div>
      </section>

      <aside>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-lg font-semibold">Recent repositories</h2>
          <p className="mt-1 text-sm text-slate-400">
            Open the latest immutable analysis.
          </p>
          <div className="mt-5 space-y-3">
            {repositories.isLoading ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : null}
            {repositories.data?.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-700 p-5 text-sm text-slate-400">
                No repository snapshots yet.
              </p>
            ) : null}
            {repositories.data?.map((repository) => (
              <button
                key={repository.id}
                className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-left hover:border-slate-600"
                onClick={() => void openLatest(repository.id)}
              >
                <span className="flex items-center gap-3">
                  <Archive
                    size={18}
                    className="text-cyan-300"
                    aria-hidden="true"
                  />
                  <span>
                    <span className="block font-medium">
                      {repository.displayName}
                    </span>
                    <span className="mt-1 block text-xs text-slate-400">
                      {repository.sourceKind} ·{" "}
                      {new Date(repository.createdAt).toLocaleString()}
                    </span>
                  </span>
                </span>
                <span className="text-slate-500">→</span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </main>
  );
}
