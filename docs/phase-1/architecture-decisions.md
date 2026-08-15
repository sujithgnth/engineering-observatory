# Architecture decisions

These are proposed Phase 1 decisions. “Accepted” means accepted by the implementation only after review; until then they are the design baseline. Each decision includes the reason, alternatives, trade-off, production concern, and test consequence requested for the project.

## D1. Modular monolith with isolated workers

**Decision.** Use one Nx codebase and one PostgreSQL system of record, deployed as frontend, backend, analysis worker, and restricted performance-runner processes.

**Why.** The domain is still evolving and benefits from one type system, transaction boundary, and observable workflow. Long-running and hazardous work still needs process isolation from HTTP traffic.

**Alternatives.** A single backend process is simpler but lets scans/load tests exhaust API capacity. Microservices isolate more aggressively but add network contracts, distributed tracing, deployment, and data-consistency costs before team/scale evidence exists.

**Trade-off.** The worker and runner add deployment units, while the shared database remains a coupling point. This is deliberate and easier to explain than premature service decomposition.

**Production concerns.** Separate identities, concurrency limits, health checks, graceful shutdown, and deployment scaling per process. Avoid app-local in-memory workflow state.

**Testing.** End-to-end flow across real API/DB/worker; API responsiveness while a worker is busy; runner permission tests; worker-crash recovery.

## D2. Deterministic analysis is authoritative

**Decision.** Parsers, AST tools, scanners, load tools, and explicit policies create findings, evidence, severity, measurements, and scores. AI cannot create or mutate those fields.

**Why.** Results must be reproducible, testable, inspectable, and defensible in an interview. An LLM-generated metric would undermine the product's core claim.

**Alternatives.** LLM-first repository review covers broad patterns quickly but is non-deterministic, hard to calibrate, expensive, privacy-sensitive, and can hallucinate locations or impact. A fully non-AI product is viable but loses useful explanation flexibility.

**Trade-off.** Deterministic rules take more engineering and support fewer patterns at first. Optional AI preserves usability without weakening evidence.

**Production concerns.** Pin tool/rule versions, expose limitations, calibrate false positives, and prevent AI fields from entering scoring persistence paths.

**Testing.** Golden rule fixtures; repeated-run determinism; database/API tests proving AI review cannot alter findings/scores; malformed/adversarial model response tests.

## D3. Never execute repository code during static analysis

**Decision.** Do not install dependencies, run lifecycle scripts, import repository modules, run builds/tests, or execute binaries from a cloned/uploaded project.

**Why.** Repositories are untrusted. Executing them turns a portfolio scanner into a remote-code-execution service and makes hosted operation unsafe.

**Alternatives.** Sandboxed builds can improve framework resolution and enable runtime checks, but require hardened ephemeral VMs/containers, dependency/network policy, image lifecycle, and a much larger security budget. Asking users to run a local CLI is a possible later opt-in model.

**Trade-off.** Some aliases, generated metadata, custom decorators, and dynamic configuration cannot be fully resolved. Findings must expose that uncertainty.

**Production concerns.** Parser isolation, resource caps, no child process from analyzers, restricted network egress, and safe temp cleanup.

**Testing.** Canary repositories with malicious install/build/import behavior; assert no file, child process, or network side effect; parser timeout and memory tests.

## D4. Immutable source snapshots and analyses

**Decision.** Bind every analysis to a resolved Git commit SHA or archive digest. Reruns create new immutable analysis records.

**Why.** A branch name or mutable upload label cannot reproduce evidence. Immutability enables honest timelines and auditability.

**Alternatives.** Update one “current scan” row to reduce storage, or bind to a branch. Both destroy historical provenance and create races when source changes during work.

**Trade-off.** More rows and explicit retention/deletion logic. Dashboard queries need a current/latest projection.

**Production concerns.** Deduplicate identical snapshot/rule-policy requests, enforce retention, handle deleted private GitHub commits, and never assume ref text is immutable.

**Testing.** Digest/commit resolution tests; concurrent branch-change test; immutability constraints; timeline tests across snapshots.

## D5. Analyzer plug-ins behind one small contract

**Decision.** Analyzer implementations receive a safe repository view plus project profile and emit normalized findings and coverage through the analyzer-engine contract.

**Why.** Frontend, backend, database, and security rules need separate dependencies and release cadence while sharing orchestration and evidence semantics.

**Alternatives.** One giant scanner is quicker but couples toolchains and makes partial failure/coverage unclear. Runtime-loaded third-party plug-ins are more extensible but create an untrusted-code execution problem.

**Trade-off.** Contract design and adapter mapping add ceremony. V1 analyzers are compile-time Nx libraries, not arbitrary runtime plug-ins.

**Production concerns.** Analyzer timeouts, applicability, versioning, failure isolation, and bounded concurrency.

**Testing.** Contract conformance suite; positive/negative fixtures per analyzer; one-analyzer-fails coverage tests; unsupported-profile tests.

## D6. PostgreSQL as persistence and initial durable job queue

**Decision.** Use PostgreSQL for product data and leased jobs with row locking and retry metadata.

**Why.** PostgreSQL is already required, supplies the needed transactions, and avoids Redis/RabbitMQ before throughput evidence justifies another system.

**Alternatives.** In-memory queues lose work and do not scale processes. BullMQ/Redis is ergonomic but adds operations and split consistency. A managed broker is stronger at high throughput but unnecessary for the expected initial job volume.

**Trade-off.** Polling and queue writes add database load; advanced broker features must be built deliberately.

**Production concerns.** Partial indexes, lease expiry, backoff/jitter, dead-letter visibility, idempotency, connection-pool budgets, and queue lag metrics. Revisit if measured queue contention or throughput requires it.

**Testing.** Multi-worker lease contention; crash/expiry/retry; duplicate delivery; dead-letter transition; API/job transaction atomicity; production-shaped query plans.

## D7. Normalized relational core with validated JSONB edges

**Decision.** Store stable identity/state/query fields relationally and evolving project profiles, evidence, and tool metrics as versioned validated JSONB.

**Why.** Repository ecosystems and tool outputs vary, while ownership, status, severity, timestamps, and joins need constraints and indexes.

**Alternatives.** Fully normalized evidence creates many sparse tables and migrations per rule. Document-only storage weakens transactions, relationships, and reporting. Everything in JSONB hides integrity and makes simple queries expensive.

**Trade-off.** Application schemas must be versioned and validated; some JSONB queries are less convenient.

**Production concerns.** Payload limits, migrations for schema versions, selective promotion of hot fields, no speculative GIN indexes, and safe JSON serialization.

**Testing.** Schema-validation tests; legacy-payload migration fixtures; invalid/oversized JSON rejection; dashboard query-plan tests.

## D8. Artifact store port instead of database archive blobs

**Decision.** Store uploaded source through an artifact-store port: filesystem for local development and S3-compatible storage for hosted deployment.

**Why.** Async workers need durable access, but large source archives do not belong in transactional rows or backups.

**Alternatives.** PostgreSQL `bytea` is operationally simple at tiny scale but inflates backups/WAL and competes with queries. API-to-worker streaming fails across retries. Re-cloning works only for GitHub, not uploads.

**Trade-off.** Hosted mode needs object-store lifecycle, encryption, and orphan cleanup. Local mode needs a shared path between processes.

**Production concerns.** Tenant-prefixed opaque keys, encryption, integrity digest, short retention, least-privilege signed access, and cleanup reconciliation.

**Testing.** Adapter conformance; corrupted digest; expired/missing artifact; retry access; deletion/orphan cleanup; cross-tenant key tests.

## D9. GitHub App with read-only selected-repository access

**Decision.** Use a GitHub App installation and short-lived tokens rather than asking users for personal access tokens.

**Why.** It supports selected-repository least privilege, revocation, auditable installation identity, and hosted multi-user use.

**Alternatives.** Personal access tokens are faster for a local demo but have confusing scopes and unsafe storage expectations. Public clone URLs cannot access private portfolios. OAuth alone still needs a repository-access token model.

**Trade-off.** App registration, callback/webhook handling, and local setup are more work. Archive upload remains the zero-integration path.

**Production concerns.** Minimal permissions, installation revocation, webhook verification, token caching lifetime, API rate limits, and repository rename/transfer identity.

**Testing.** Mocked contract tests plus an opt-in test installation; revoked/no-access cases; signed webhook replay; commit resolution race.

## D10. Versioned, coverage-aware, transparent scoring

**Decision.** Use capped rule deductions, explicit coverage, nullable unassessed scores, and equal dimension weights for the initial overall policy. No overall number until all dimensions are assessed. Static performance-risk findings remain visible but cannot create a measured Performance score.

**Why.** A dashboard needs prioritization, but a green score created by skipped checks or absent performance evidence is worse than no score.

**Alternatives.** Raw issue counts bias large repositories. Severity averages hide coverage. AI scoring is non-reproducible. Always displaying an overall score is visually convenient but dishonest.

**Trade-off.** Users may see “not measured” instead of a satisfying gauge. Rule deductions require calibration and versioning.

**Production concerns.** Prevent gaming by duplicate findings/suppressions, label policy changes, preserve historical comparability, and avoid universal “production-ready” claims.

**Testing.** Mathematical properties; occurrence caps; skipped/failed coverage; score explanation sum; incompatible-version trends; null UI rendering.

## D11. REST plus polling for asynchronous workflows

**Decision.** Use versioned REST resources and bounded polling through React Query for job state in V1.

**Why.** Analysis progress changes relatively slowly, REST is easy to inspect and test, and polling avoids another connection/state mechanism before it is needed.

**Alternatives.** WebSockets are bidirectional but unnecessary. Server-sent events fit progress better but need reconnection/proxy behavior. GraphQL can reduce endpoint count but adds schema/cache complexity without a clear need.

**Trade-off.** Polling creates repeated reads and up to one interval of UI latency.

**Production concerns.** Backoff after initial activity, stop on terminal state, ETags, workspace quotas, and aggregate endpoints. Add SSE only after measuring unacceptable polling load/latency.

**Testing.** Poll-state transitions, cancellation races, ETags, rate limits, stale client recovery, and end-to-end React Query behavior.

## D12. AI review is opt-in, structured, and isolated

**Decision.** Implement one AI provider port with OpenAI, Claude, Gemini, and Ollama adapters. Input is minimal/redacted; output is schema-validated explanation only.

**Why.** It meets the explanation goal without making AI availability, cost, or behavior a core system dependency.

**Alternatives.** One provider is simpler but creates lock-in. An OpenAI-compatible generic adapter reduces code but does not cover different authentication/capability semantics cleanly. Autonomous agents violate the product principle and expand risk.

**Trade-off.** Provider conformance, prompt/version management, and divergent errors require work. Results can still be wrong and must be labeled.

**Production concerns.** Current provider terms/capabilities must be verified in Phase 7, keys stay in a secret store, context/cost limits, timeouts, retries only when safe, and repository prompt injection defenses.

**Testing.** Provider contract fixtures; schema failures; timeouts/rate limits; canary leakage; prompt injection; AI-disabled full product flow.

## D13. Isolated, policy-controlled performance runner

**Decision.** Run k6/autocannon only in a separate restricted process with tool-specific scenario schemas, target validation, resource ceilings, cancellation, and measured provenance.

**Why.** Load testing is resource-intensive and can be abused for SSRF or denial of service. Tool semantics differ and cannot be hidden behind a vague “users” field.

**Alternatives.** Spawn tools from the API for less code but unacceptable blast radius. Browser-only load generation is inconsistent and constrained. A managed distributed platform is stronger but costly and outside the initial scope.

**Trade-off.** Another deployable and safety policy. A single runner may reject or fail to achieve 10,000 VUs.

**Production concerns.** Authorization evidence, network policy, redirect/DNS revalidation, secret/header handling, quotas, kill switch, process-group cleanup, runner saturation, and explicit requested-versus-achieved reporting.

**Testing.** Controlled fixture target; SSRF/DNS/redirect suite; command injection; resource/cancellation; parser fixtures; threshold boundaries; achieved-load shortfall reporting.

## D14. Static database findings are candidates, not runtime proof

**Decision.** The database analyzer reports source-backed index/query/schema risk candidates with confidence. Confirmation requires an optional user-authorized query plan or telemetry integration outside the first static scope.

**Why.** Whether an index is useful depends on data distribution, selectivity, workload, existing indexes, and planner behavior. Source alone cannot prove a bottleneck.

**Alternatives.** Label every queried field without a visible index as “missing index,” which produces authoritative-looking false positives. Connect automatically to databases, which introduces severe credential and production-safety risk.

**Trade-off.** Findings use more cautious language and some remain unconfirmed. The initial demo cannot claim real database optimization from source alone.

**Production concerns.** Detect ORM abstractions carefully, show analysis limits, never request production credentials, and use read-only/test environments for any future explain adapter.

**Testing.** MongoDB/PostgreSQL ORM fixtures with present/absent/composite indexes, dynamic-query ambiguity, false-positive corpus, and wording assertions.

## D15. Create libraries just in time

**Decision.** The folder structure is a target map; each phase creates only the libraries needed by its vertical slice.

**Why.** Empty abstractions and dozens of generated packages give the appearance of architecture without evidence. Boundaries should exist because code and dependencies require them.

**Alternatives.** Scaffold the entire tree in Phase 2 for a visually complete monorepo, or keep everything inside apps until late refactoring.

**Trade-off.** The project graph grows across phases and some code may move once a boundary is proven.

**Production concerns.** Keep moves small, preserve public contracts, enforce tags from the first relevant dependency, and avoid cyclic “shared” dumping grounds.

**Testing.** Nx graph/boundary checks per phase; affected builds/tests; no empty production library accepted without a current consumer and contract.

## Decision review triggers

Revisit a decision only with evidence, for example:

- queue lag/locking shows PostgreSQL is the bottleneck;
- hosted security requirements justify sandboxed repository execution or a local CLI;
- polling traffic/latency justifies SSE;
- artifact volumes/retention justify a different store;
- a second team or independent scaling/data ownership justifies a service split;
- calibration shows equal scoring weights are misleading;
- single-runner measurements justify distributed performance infrastructure.

The interview value is the reasoning and evidence for change, not loyalty to the first diagram.
