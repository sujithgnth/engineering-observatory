# Nx folder structure

## 1. Structure

The implemented layout keeps deployable/process boundaries explicit and consolidates rules that do not yet justify separate packages.

```text
engineering-observatory/
├── apps/
│   ├── frontend/                     # React, Vite, Tailwind, React Query, Recharts
│   ├── desktop/                      # Hardened Electron shell and native acquisition
│   ├── backend/                      # NestJS REST API and composition root
│   ├── worker/                       # NestJS standalone analysis worker
│   ├── performance-runner/           # Restricted k6/autocannon process boundary
│   ├── mcp-server/                    # Optional bounded read-only stdio adapter
│   └── vscode-extension/             # Thin workspace acquisition and graph client
├── libs/
│   ├── shared-types/                 # Transport/domain primitives; no framework imports
│   ├── analyzer-engine/              # Analyzer contract, registry, orchestration, coverage
│   ├── frontend-intelligence/        # AST graph, framework recognizers, health, impact
│   ├── scanners/                     # Repository profiling and project graph detection
│   ├── persistence/                  # PostgreSQL repositories, migrations, job leasing
│   ├── performance-engine/           # Scenario policy, tool ports, normalized metrics
│   └── ai-adapter/                   # Provider port, redaction, schema validation, adapters
├── fixtures/
│   ├── repositories/                 # Small good/bad/mixed static-analysis repositories
│   ├── demo-projects/                # React/Redux, Angular/NgRx, Next/Zustand demos
│   ├── archives/                     # Safe and malicious archive fixtures
│   ├── performance-output/           # Recorded k6/autocannon parser fixtures
│   └── ai-responses/                 # Valid, malformed, and adversarial provider outputs
├── docs/
│   ├── phase-1/                      # Architecture package
│   ├── decisions/                    # Future accepted ADRs
│   └── runbooks/                     # Added with operational implementation
├── tools/                            # Workspace scripts added only when justified
└── .github/                          # CI and templates added during hardening
```

The worker and performance-runner are intentional process boundaries. Long-running source processing must not consume API request capacity, and a load generator needs stricter network/resource isolation than an analyzer. Electron is a local composition root for those canonical processes; the VS Code app is a client of them, not another backend.

## 2. Library responsibilities

| Library                 | Public responsibility                                                    | Allowed dependencies                | Forbidden dependencies               |
| ----------------------- | ------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------ |
| `shared-types`          | Runtime-validated profile, finding, graph, impact, score, and API models | Zod                                 | React, NestJS, SQL, provider SDKs    |
| `analyzer-engine`       | Analyzer contract, deterministic rules, orchestration, scoring           | scanners/shared-types helpers       | DB, UI, AI                           |
| `scanners`              | Safe artifacts/GitHub acquisition and deterministic project profile      | shared types, parsing/archive tools | DB, UI, AI                           |
| `frontend-intelligence` | TypeScript AST graph, framework relationships, health, impact            | scanners, shared types, ts-morph    | DB, UI, AI                           |
| `persistence`           | SQL workflow store, Prisma graph store, migrations, job leases           | shared types, PostgreSQL, Prisma    | React, analyzer implementation logic |
| `performance-engine`    | Validate scenarios, invoke load drivers, normalize measured output       | shared types, tool adapters         | static analyzers, AI                 |
| `ai-adapter`            | Bound context, route providers, validate explanation                     | shared types, provider SDKs         | score/graph mutation, job control    |

## 3. Nx tags and dependency policy

Proposed tags:

- scope: `frontend`, `backend`, `analysis`, `performance`, `shared`;
- type: `app`, `domain`, `feature`, `port`, `adapter`, `data-access`, `util`, `testing`;
- runtime: `browser`, `node`, `universal`, `test`.

Examples of enforced rules:

- browser code cannot depend on Node-only libraries;
- domain and port libraries cannot depend on adapters;
- analysis libraries cannot depend on AI adapters;
- production libraries cannot depend on `testing`;
- frontend features access backend data only through `dashboard-data` and API contracts;
- apps may compose adapters, but apps do not become shared dependencies.

These tags are more valuable than path naming alone because CI can reject an architectural violation.

## 4. Public API discipline

- Each library exposes a small root entry point; internal modules are not imported by path from another project.
- Domain contracts are semantically versioned inside the monorepo through review and migration, not independently published packages.
- Transport DTOs and domain types are related but not assumed identical. The API layer maps between them where security or presentation requires it.
- Provider SDK types stop at the provider adapter.
- Tool-specific k6/autocannon output stops at the load-driver adapter; the rest of the system sees normalized metrics plus preserved provenance.

## 5. Why not fewer or more projects?

One large `libs/core` would be quicker initially but would hide dependency direction and make analyzers hard to test independently. A library per individual rule would create excessive Nx configuration, slow graph operations, and turn normal refactoring into cross-package ceremony.

The chosen middle ground uses one library per capability boundary. Rules remain modules inside their analyzer library. A new library is justified only by a distinct dependency boundary, process reuse, ownership boundary, or test contract—not by file count.

## 6. Testing placement

- Unit tests live beside the rule or mapper they verify.
- Cross-adapter conformance suites live in `libs/testing` and are invoked by each adapter.
- Small repository fixtures live under `fixtures/repositories`; no real customer repository is committed.
- Malicious archives are generated or stored as tiny reviewed fixtures with explicit size limits.
- Backend integration tests use real PostgreSQL in an isolated test environment.
- Frontend component tests mock the API at the network boundary; end-to-end tests use the real backend and worker.
- Tool parsers use recorded bounded outputs; a separate opt-in suite executes installed k6/autocannon binaries.

## 7. Production concerns

- Avoid shared mutable singleton state because the backend and workers scale independently.
- Never place source contents in Nx cache outputs or CI artifacts.
- Pin external tool versions and record them with results; cache invalidation must include rule/tool versions.
- Keep environment validation at each app composition root because API, worker, and runner require different secrets and network permissions.
- Generate source maps for owned application code but prevent captured repository content or secrets from entering telemetry.
- Build each deployable independently even though affected-project CI optimizes the monorepo pipeline.
