# Local development runbook

## Electron desktop

1. Copy `.env.example` to `.env` and keep provider credentials out of source control.
2. Start PostgreSQL with `docker compose up -d postgres`.
3. Run `npm run desktop:dev`.

The Electron main process applies the idempotent database migrations, chooses free loopback ports, and starts the API, analysis worker, performance runner, local UI server, and hardened renderer. It stops those child processes with the app. PostgreSQL remains external and is not stopped automatically.

Choose one source in the desktop app:

- **Local folder**: use the native directory picker. The renderer receives an opaque selection ID; it never receives arbitrary filesystem authority.
- **GitHub URL**: paste `https://github.com/owner/repository`. Public repositories need no token. For private repositories, configure a fine-grained read-only token in the UI. It is encrypted with the operating-system credential backend and kept out of the renderer. If secure storage is unavailable, launch with `GITHUB_TOKEN` instead.
- **Archive**: upload a ZIP, TAR, TAR.GZ, or TGZ.

Build and exercise the desktop artifacts with:

```bash
npm run desktop:smoke
npm run desktop:pack
npm run desktop:dist
```

`desktop:smoke` proves the managed services, preload bridge, and source UI render. `desktop:pack` creates an unpacked app under `release/`; `desktop:dist` creates current-platform installers. Local artifacts are unsigned. Any public preview must be marked as a pre-release and explicitly state the supported architecture, unsigned/notarized status, external PostgreSQL prerequisite, and verification boundary. A stable desktop release still requires signing/notarization, trusted updates, and Windows/Linux release tests.

## Optional MCP server

With Electron running, build and verify the local read-only MCP adapter:

```bash
npm run mcp:build
npm run mcp:smoke
```

Electron publishes its current loopback API URL to a short-lived runtime file, so the stdio MCP process can discover the dynamic port. Register the built server with the desired MCP host; [MCP integration](../mcp-integration.md) contains vendor-neutral development and packaged-app examples. This adapter is not an agent and is not needed for normal analysis.

## Browser development

1. Copy `.env.example` to `.env` and keep provider credentials out of source control.
2. Start PostgreSQL with `docker compose up -d postgres`.
3. Apply the idempotent schema with `npm run db:migrate`.
4. Start frontend, API, and analysis worker with `npm run dev`.
5. Start `npm run dev:performance-runner` only when running an authorized load test.

Open `http://localhost:5173`, then choose one source:

- **Local folder**: select a project directory directly. The browser skips common generated folders and uploads a bounded temporary archive.
- **GitHub URL**: paste `https://github.com/owner/repository` and select a branch, tag, or commit. Public repositories need no token; private repositories require `GITHUB_TOKEN` in `.env`.
- **Archive**: upload a ZIP, TAR, TAR.GZ, or TGZ up to 25 MB.

The scanner reads source and metadata only. It does not run package installation, builds, scripts, or repository binaries.

## VS Code companion

Keep the API and worker running, then build the extension:

```bash
npx nx run vscode-extension:build
```

Open the repository root in VS Code and press `F5` to launch an Extension Development Host. In a trusted target workspace, run **Engineering Observatory: Analyze Workspace**. Defaults point to the API at `http://127.0.0.1:3333/api/v1` and dashboard at `http://127.0.0.1:5173`; both are configurable under `frontendIntelligence`. Right-click a TypeScript or JavaScript file for dependency, impact, state-flow, API-flow, and architect-explanation commands.

The command skips `.git`, `node_modules`, build output, coverage, Nx state, and Observatory state, then enforces the backend's 25 MB compressed limit. The immutable analysis ID is stored in workspace configuration. Contextual commands use the active file and canonical persisted graph.

Stop application processes with `Ctrl+C`. Stop PostgreSQL with `docker compose stop postgres`. `docker compose down -v` destroys local database data and should be used only when that deletion is intended.

## Health and diagnosis

- Liveness: `GET http://127.0.0.1:3333/api/v1/health/live`
- PostgreSQL readiness: `GET http://127.0.0.1:3333/api/v1/health/ready`
- A job that exhausts three attempts records a bounded `failure_code`; it does not expose repository content in the API error.
- `completed_with_warnings` is a valid result. Inspect the analysis warnings and scorecard coverage before interpreting a score.
- `404 Architecture graph not available` on an older analysis means it predates the graph migration; create a new immutable analysis.
- `k6_unavailable` means the separate k6 CLI is absent from the runner environment. Autocannon remains available through the Node dependency.

## Safe local performance testing

Private and loopback targets are blocked by default. For the controlled local backend only:

```bash
ALLOW_PRIVATE_PERFORMANCE_TARGETS=true \
DATABASE_URL=postgres://observatory:observatory@127.0.0.1:5432/observatory \
npm run dev:performance-runner
```

The API requires `authorizationConfirmed: true`, but that checkbox is not a security boundary. Production must add identity, authorization, quotas, egress restrictions, target ownership verification, and isolated runner resources.

## Reproducible gates

```bash
npm run verify
npm audit
npm run quality:bundle
npm run quality:lighthouse
npm run smoke:e2e
RUN_PERFORMANCE_SMOKE=true npm run smoke:e2e
```

The last command is opt-in because it generates load. It should target only the local controlled backend unless a separate authorization process has approved another destination.

The bundle command creates local treemap, raw JSON, and Markdown reports in `artifacts/bundle/`. The Lighthouse command builds and serves the trusted frontend, runs three desktop-simulated audits, and writes HTML/JSON plus a median summary to `artifacts/lighthouse/latest/`. Category and metric limits live in `quality/lighthouse-thresholds.json`; ratchet them from observed CI history instead of choosing aspirational numbers with no baseline.

Set `LIGHTHOUSE_URL` only for a deployed URL you are authorized to audit. Do not add package installation or build execution to the repository analysis worker. Third-party build measurement belongs in a separate disposable, rootless, network-restricted runner with no ambient credentials.
