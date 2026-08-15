# REST API design

## 1. API principles

- Base path: `/api/v1`.
- Resource-oriented JSON over HTTPS; archive upload is multipart.
- Long-running analysis, AI review, and performance operations return `202 Accepted` and a status resource.
- React Query polls explicit status endpoints in V1. Server-sent events are a later optimization if polling creates measured cost or latency problems.
- Mutation endpoints accept `Idempotency-Key`; retries must not create duplicate analyses or runs.
- Cursor pagination is used for findings, repositories, runs, and audit history.
- Errors use `application/problem+json` with a stable machine-readable `type` and `code`.
- Workspace identity comes from the authenticated session/token. A caller cannot choose another workspace in a request body.
- API schemas distinguish `null`/not assessed from a numeric score.
- Every result exposes provenance: snapshot identity, analyzer/rule version, score-policy version, tool version, and timestamps where applicable.

Authentication mechanics are intentionally not hard-coded in Phase 1. Local portfolio mode can use a seeded local identity; hosted mode needs an external identity provider or secure first-party session. Authorization semantics—workspace membership and role checks—are part of the contract either way.

## 2. Endpoint summary

### System

| Method | Path            | Purpose                                    | Success        |
| ------ | --------------- | ------------------------------------------ | -------------- |
| GET    | `/health/live`  | Process liveness only                      | `200`          |
| GET    | `/health/ready` | Database and required dependency readiness | `200` or `503` |

### Repository sources and snapshots

| Method | Path                                     | Purpose                                                             | Success        |
| ------ | ---------------------------------------- | ------------------------------------------------------------------- | -------------- |
| GET    | `/repositories`                          | List workspace repositories                                         | `200`          |
| POST   | `/repositories/github`                   | Register a selected GitHub repository and resolve a commit snapshot | `201` or `202` |
| POST   | `/repositories/archive`                  | Upload a bounded ZIP/TAR archive and create its digest snapshot     | `201` or `202` |
| GET    | `/repositories/{repositoryId}`           | Repository metadata and latest snapshot summary                     | `200`          |
| POST   | `/repositories/{repositoryId}/snapshots` | Resolve a new GitHub ref or accept a replacement archive            | `202`          |
| DELETE | `/repositories/{repositoryId}`           | Schedule repository data and artifact deletion                      | `202`          |
| GET    | `/github/installations`                  | List authorized GitHub App installations/repositories               | `200`          |
| POST   | `/webhooks/github`                       | Receive signed installation/repository-selection events             | `202`          |

GitHub access uses a GitHub App with read-only repository contents and metadata. The server stores the installation identity, not a long-lived personal access token. Webhook bodies are size-bounded and signature-verified before processing.

### Analyses and dashboard

| Method | Path                                    | Purpose                                                                              | Success |
| ------ | --------------------------------------- | ------------------------------------------------------------------------------------ | ------- |
| POST   | `/analyses`                             | Queue deterministic analysis for a snapshot                                          | `202`   |
| GET    | `/analyses/{analysisId}`                | State, stage progress, warnings, versions, coverage                                  | `200`   |
| POST   | `/analyses/{analysisId}/cancel`         | Request cancellation before a terminal state                                         | `202`   |
| GET    | `/analyses/{analysisId}/profile`        | Detected projects, frameworks, databases, and evidence                               | `200`   |
| GET    | `/analyses/{analysisId}/findings`       | Filtered, cursor-paginated findings                                                  | `200`   |
| GET    | `/analyses/{analysisId}/scorecards`     | Immutable architecture, security, and scalability scorecards                         | `200`   |
| GET    | `/analyses/{analysisId}/architecture`   | Versioned frontend files, nodes, edges, health, and coverage                         | `200`   |
| GET    | `/analyses/{analysisId}/impact`         | Static impact for a `nodeId` or safe repository-relative `filePath`                  | `200`   |
| GET    | `/analyses/{analysisId}/source`         | Bounded source preview for a path present in the persisted graph                     | `200`   |
| GET    | `/analyses/{analysisId}/dashboard`      | Aggregated dashboard read model using its latest compatible health report            | `200`   |
| GET    | `/health-reports/{reportId}`            | Immutable four-dimension snapshot pinned to an analysis and optional performance run | `200`   |
| GET    | `/repositories/{repositoryId}/timeline` | Finding and score changes across compatible analyses                                 | `200`   |
| GET    | `/repositories/{repositoryId}/analyses` | Analysis history                                                                     | `200`   |

### AI explanations

| Method | Path                                      | Purpose                                                             | Success |
| ------ | ----------------------------------------- | ------------------------------------------------------------------- | ------- |
| GET    | `/ai/providers`                           | Available configured providers and capability state, never secrets  | `200`   |
| PUT    | `/ai/providers/{provider}`                | Create/update a provider secret through the configured secret store | `200`   |
| DELETE | `/ai/providers/{provider}`                | Disable and remove provider secret reference                        | `204`   |
| POST   | `/findings/{findingId}/ai-reviews`        | Queue optional review for one immutable finding                     | `202`   |
| GET    | `/findings/{findingId}/ai-reviews`        | List generated reviews and provenance                               | `200`   |
| GET    | `/ai-reviews/{reviewId}`                  | Review state or validated recommendation                            | `200`   |
| POST   | `/analyses/{analysisId}/architect-review` | Explain a bounded canonical graph/impact slice without mutating it  | `200`   |

The client never submits finding severity, evidence, or score to the review endpoint. The backend reloads the canonical finding, applies redaction, and builds the provider input.

### Performance scenarios and runs

| Method | Path                                            | Purpose                                                         | Success |
| ------ | ----------------------------------------------- | --------------------------------------------------------------- | ------- |
| POST   | `/performance-scenarios`                        | Validate and save a k6 or autocannon scenario                   | `201`   |
| GET    | `/performance-scenarios/{scenarioId}`           | Read sanitized scenario details                                 | `200`   |
| POST   | `/performance-runs`                             | Queue an authorized scenario run                                | `202`   |
| GET    | `/performance-runs/{runId}`                     | State, requested/achieved load, metrics, thresholds, provenance | `200`   |
| POST   | `/performance-runs/{runId}/cancel`              | Stop an active or queued run                                    | `202`   |
| GET    | `/repositories/{repositoryId}/performance-runs` | Cursor-paginated measured run history                           | `200`   |

## 3. Primary request and response contracts

The JSON below is illustrative contract documentation, not implementation code.

### Register a GitHub source

Request to `POST /api/v1/repositories/github`:

```json
{
  "repositoryUrl": "https://github.com/example-org/example-repository",
  "ref": "main"
}
```

Response:

```json
{
  "repositoryId": "5da9d4ef-2848-4d38-8c31-f483e220f2af",
  "snapshot": {
    "id": "20743e3b-d47c-48e9-87fa-4d459f159da4",
    "state": "ready",
    "sourceKind": "github",
    "resolvedRef": "main",
    "commitSha": "full-commit-sha"
  }
}
```

The local MVP accepts public repositories and private repositories readable by a server-side `GITHUB_TOKEN`. It validates a plain HTTPS `github.com/{owner}/{repository}` URL, resolves `ref` to a full commit SHA, and persists the resolved identity. The older `{ owner, name, ref }` body remains accepted for API compatibility. A hosted deployment should replace a long-lived token with a GitHub App and verify installation access to the exact provider repository ID; repository name text alone is not an authorization decision.

### Upload an archive

`POST /api/v1/repositories/archive` accepts:

- multipart part `archive`: `.zip`, `.tar`, or `.tar.gz` subject to policy;
- multipart field `displayName`;
- optional expected client-side SHA-256 used only as a consistency check.

The response does not mean extraction is safe merely because upload completed. It returns a source state such as `validating`, `ready`, or `rejected`; validation errors use stable codes such as `archive_too_large`, `archive_path_traversal`, `archive_too_many_entries`, or `archive_unsupported_type`.

The browser local-folder picker is an acquisition adapter over this endpoint. It excludes generated directories, applies client-side file/count/byte limits, creates a temporary ZIP, and then uses the same server-side archive validation. Client limits improve usability but never replace server enforcement.

### Queue analysis

Request to `POST /api/v1/analyses`:

```json
{
  "snapshotId": "20743e3b-d47c-48e9-87fa-4d459f159da4",
  "requestedAnalyzers": "applicable"
}
```

Response:

```json
{
  "analysisId": "6d29088b-466a-49e9-a68c-5e8be04bf77c",
  "state": "queued",
  "statusUrl": "/api/v1/analyses/6d29088b-466a-49e9-a68c-5e8be04bf77c"
}
```

`requestedAnalyzers: applicable` means the scanner profile selects supported analyzers. A future expert mode can request a subset, but it cannot request analyzers the caller is not authorized to use or make skipped coverage appear complete.

### Analysis status

```json
{
  "id": "6d29088b-466a-49e9-a68c-5e8be04bf77c",
  "state": "analyzing",
  "stage": {
    "name": "frontend-analyzer",
    "completedUnits": 3,
    "totalUnits": 6
  },
  "snapshot": {
    "sourceKind": "github",
    "commitSha": "full-commit-sha"
  },
  "versions": {
    "ruleSet": "rules-v1",
    "scorePolicy": "score-v1"
  },
  "coverage": {
    "state": "partial",
    "completed": ["repository-profile", "security-secrets"],
    "pending": ["frontend", "backend"],
    "skipped": []
  },
  "warnings": []
}
```

Progress counts are stage units, not fake percentages. A worker cannot reliably predict the duration of an unknown repository from file count alone.

### Finding

```json
{
  "id": "e37fd63c-e8ae-40cb-a949-a44f2bd2e62b",
  "fingerprint": "stable-non-secret-fingerprint",
  "ruleId": "nestjs.input-validation.missing",
  "analyzer": {
    "id": "backend-analyzer",
    "version": "1.0.0"
  },
  "dimension": "security",
  "severity": "high",
  "confidence": "high",
  "title": "Request body reaches a handler without validated DTO evidence",
  "location": {
    "path": "apps/api/src/orders/orders.controller.ts",
    "lineStart": 31,
    "lineEnd": 35
  },
  "evidence": {
    "kind": "ast-path",
    "observed": "Body parameter type has no detected validation metadata",
    "limitations": [
      "Global custom validation outside supported NestJS patterns may not be detected"
    ]
  },
  "scoreImpact": {
    "dimension": "security",
    "deduction": 8,
    "policyVersion": "score-v1"
  }
}
```

The wording describes observed evidence and limitations. It does not claim exploitability or runtime behavior that static analysis did not establish.

### Health-report performance entry

```json
{
  "dimension": "performance",
  "assessmentState": "not_measured",
  "score": null,
  "policyVersion": "score-v1",
  "coverage": {
    "requiredEvidence": "successful bounded performance run with configured thresholds",
    "available": false
  },
  "deductions": []
}
```

This performance entry is part of the health-report response, not a mutation of the analysis scorecards. The response contract preserves `null`; the frontend must render “Not measured,” not a gauge at zero or 100. Completing or selecting a compatible performance run creates a new immutable health report with that run pinned.

### Request a finding review

Request to `POST /api/v1/findings/{findingId}/ai-reviews`:

```json
{
  "provider": "ollama",
  "model": "configured-model-alias",
  "regenerate": false
}
```

Validated terminal response:

```json
{
  "id": "345aefb9-8b15-4457-a4e7-5b4f814e43f8",
  "state": "completed",
  "provider": "ollama",
  "model": "resolved-model-identifier",
  "promptPolicyVersion": "finding-review-v1",
  "recommendation": {
    "explanation": "...",
    "productionImpact": "...",
    "recommendedSolution": "...",
    "alternatives": ["..."],
    "tradeoffs": ["..."]
  },
  "generatedAt": "2026-08-15T10:00:00Z"
}
```

There is deliberately no AI-generated severity, score, evidence, file location, or automated action field.

### Save and run a performance scenario

Illustrative scenario request:

```json
{
  "repositoryId": "5da9d4ef-2848-4d38-8c31-f483e220f2af",
  "name": "Orders read baseline",
  "tool": "k6",
  "target": {
    "origin": "https://staging.example.test",
    "method": "GET",
    "path": "/api/orders",
    "credentialReference": "secret-reference-or-null"
  },
  "load": {
    "virtualUsers": 100,
    "durationSeconds": 60,
    "gracefulStopSeconds": 10
  },
  "thresholds": {
    "p95LatencyMs": 500,
    "errorRatePercent": 1
  },
  "authorizationConfirmed": true
}
```

The 1,000 and 10,000 presets use the same tool-specific contract, but server policy may reject them based on runner capacity, target policy, or deployment tier. The boolean affirmation is necessary but not sufficient; target validation and rate/resource caps are server-side.

Terminal run response includes:

```json
{
  "id": "9d66b898-bd65-4678-86ed-30a21dbdbf55",
  "state": "completed",
  "tool": "k6",
  "toolVersion": "recorded-version",
  "requestedLoad": {
    "virtualUsers": 100,
    "durationSeconds": 60
  },
  "achievedLoad": {
    "peakVirtualUsers": 100,
    "completedRequests": 28642,
    "droppedIterations": 0
  },
  "metrics": {
    "requestsPerSecond": 477.37,
    "latencyMs": {
      "p50": 91.2,
      "p95": 184.8,
      "p99": 311.4
    },
    "errorRatePercent": 0.18,
    "timeouts": 2
  },
  "thresholdResults": [
    {
      "name": "p95 latency",
      "passed": true,
      "threshold": 500,
      "observed": 184.8,
      "unit": "ms"
    }
  ],
  "interpretationLimits": [
    "Client-side measurements alone do not identify the server-side root cause"
  ]
}
```

The numeric values are example contract values only. Product screens must never present fixture numbers as a real repository result.

## 4. Filtering, ordering, and pagination

Finding query parameters:

- `severity`: repeatable critical/high/medium/low/info;
- `dimension`: architecture/security/performance/scalability;
- `analyzerId` and `ruleId`;
- `pathPrefix` after normalized repository-path validation;
- `confidence`;
- `lineage`: new/persistent/resolved/unknown when using the timeline endpoint;
- `sort`: severity, path, or created order with a stable ID tie-breaker;
- `cursor` and bounded `limit`.

The API returns `nextCursor`, never an unbounded total by default. Dashboard aggregate endpoints may return exact counts already calculated for the analysis. User-provided sort column names are mapped to an allow-list and never interpolated into SQL.

## 5. Error contract

Example:

```json
{
  "type": "https://engineering-observatory.local/problems/archive-path-traversal",
  "title": "Archive rejected",
  "status": 422,
  "code": "archive_path_traversal",
  "detail": "The archive contains an entry that cannot be extracted safely.",
  "requestId": "request-correlation-id"
}
```

Rules:

- details are safe for the caller and never include credentials, raw source, command lines with headers, stack traces, or provider response bodies;
- validation errors may include field pointers;
- authorization returns `404` where exposing cross-workspace resource existence would leak information;
- rate limiting returns `429` with `Retry-After`;
- unavailable optional AI providers return `409 provider_not_configured`, not a platform-wide `503`;
- a rejected performance target returns `422 target_policy_rejected` with a safe reason category;
- internal logs correlate by request/job ID but follow the same redaction policy.

## 6. Caching and consistency

- Immutable completed analysis resources can use an ETag derived from analysis ID and result version.
- Running status resources use `Cache-Control: no-store`.
- Repository timelines are invalidated when a new analysis reaches a terminal state.
- AI reviews are not part of deterministic analysis ETags.
- Dashboard reads come from a committed immutable health report; partial analysis/performance stage writes are not exposed as completed data.
- Cancellation is cooperative. A `202` cancellation response means requested, not guaranteed; the final state is authoritative.

## 7. API production concerns

- archive requests use streaming upload, byte/time limits, content sniffing, and backpressure;
- request body and multipart limits differ by route;
- GitHub webhooks verify signature, delivery ID deduplication, event allow-list, and timestamp policy;
- endpoints that start expensive jobs have workspace quotas and concurrency caps;
- AI review batches have item/token/cost caps and explicit opt-in;
- performance targets are revalidated by the runner immediately before network access, including redirect and DNS resolution;
- OpenAPI is generated and checked into CI in Phase 2; contract-breaking changes require versioning or a migration path;
- metrics use route templates, not raw IDs, paths, target URLs, or repository names as labels.

## 8. API testing strategy

- schema tests for every request, success response, and problem response;
- authorization matrix tests across workspace roles and cross-workspace IDs;
- idempotency tests for same key/same payload and same key/conflicting payload;
- real PostgreSQL integration tests for create-job transactions and cursor ordering;
- multipart streaming tests for maximum size, disconnects, slow uploads, and content mismatch;
- GitHub webhook signature and replay tests;
- state-transition tests for cancel/complete races;
- tests proving AI provider failure does not modify deterministic records;
- tests proving unassessed scores serialize as null and remain labeled;
- performance target policy tests including private addresses, redirects, DNS rebinding, forbidden ports, and unsafe credentials;
- generated-client compatibility tests and a small end-to-end upload → analysis → dashboard flow.
