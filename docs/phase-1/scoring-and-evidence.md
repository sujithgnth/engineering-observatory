# Scoring and evidence model

## 1. Purpose

The dashboard score is a navigation aid, not a universal measure of software quality. It helps a user compare compatible analyses of the same repository and find evidence. It must never hide uncertainty, replace findings, or convert an AI opinion into a metric.

## 2. Evidence hierarchy

From strongest to weakest:

1. **Measured runtime evidence** — a reproducible performance run with tool version, scenario, achieved load, environment label, and thresholds.
2. **Parsed semantic evidence** — TypeScript/compiler AST, framework metadata, schema/index declarations, lockfiles, and validated configuration.
3. **Structured textual evidence** — manifest/config parsing where semantic tooling is unavailable.
4. **Heuristic evidence** — bounded pattern evidence with an explicit confidence and limitation.

Raw regular-expression matches are not silently promoted to semantic certainty. Each rule declares its evidence kind, supported versions/patterns, known limitations, and confidence policy.

## 3. Finding contract

Every finding has:

- stable `ruleId` and analyzer version;
- one dashboard dimension;
- deterministic severity and confidence;
- concise title and observed-risk statement;
- normalized repository-relative path and precise location when available;
- structured evidence and limitations;
- deterministic remediation summary where the rule can safely provide one;
- stable fingerprint for lineage;
- optional, separate AI review references;
- optional score deduction defined by the score policy, not by AI.

Severity describes potential impact if the finding is valid in production. Confidence describes how strongly the available evidence supports the finding. A high-severity, low-confidence finding is visible but should not be scored as if exploitation or impact were proven.

## 4. Dimensions

| Dimension    | Meaning                                                      | Example evidence                                                                                  | Explicit limitation                                                                       |
| ------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Architecture | Maintainability, boundaries, lifecycle, coupling, complexity | component size/complexity, dependency cycles, layer violations                                    | Not a full design review from source alone                                                |
| Security     | Exposure and unsafe configuration/pattern risk               | redacted secret match, validation gap, vulnerable lockfile advisory                               | Dependency advisory state is time/version dependent; static evidence is not exploit proof |
| Performance  | Behavior against user-configured thresholds                  | measured RPS, latency percentiles, errors, dropped work                                           | No score before a valid performance run; client data alone may not identify root cause    |
| Scalability  | Readiness risks that may limit safe growth                   | unbounded queries, missing pagination evidence, blocking operations, stateful process assumptions | Does not predict maximum users or infrastructure capacity                                 |

Database “missing index” and “inefficient query” findings are reported as candidates when derived from source. A confirmed database bottleneck needs a query plan or runtime telemetry from a user-authorized non-production/test environment.

Static rules may still emit a performance-risk finding—for example an avoidable render pattern or synchronous call in a request path. It appears in the Performance findings view with its confidence and limitations, but it does not manufacture a measured Performance score. The performance score is based only on a compatible run and explicit thresholds.

## 5. Score calculation

Each dimension begins at 100 only after its required evidence coverage is satisfied. The policy subtracts explicit per-rule deductions:

`dimension score = max(0, 100 - sum(capped rule deductions))`

Policy requirements:

- each rule owns a reviewed deduction and per-analysis cap;
- repeated occurrences cannot consume unlimited points merely because a repository is large;
- deductions may account for confidence, but the transformation is fixed in the policy;
- severity labels and point deductions are related by policy but are not assumed interchangeable;
- the response lists every contributing deduction and cap;
- score policy and rule-set versions are stored with the analysis;
- changing a score policy requires a new version. Historical scores are not silently recalculated.

Exact rule deductions are deliberately not invented in Phase 1. They will be calibrated in the analyzer phases against reviewed good, bad, and ambiguous fixtures before `score-v1` is accepted.

## 6. Coverage states

Each check and dimension has one of:

- **assessed** — all required applicable checks completed successfully;
- **partial** — some applicable checks completed, with exact gaps listed;
- **not measured** — runtime evidence required but no valid run exists;
- **not applicable** — profile evidence proves the check does not apply;
- **unavailable** — required tool/data was missing or failed.

Rules:

- skipped, failed, unsupported, and not applicable are distinct;
- “no finding” counts as healthy evidence only when the rule ran successfully;
- no score is emitted for an unassessed dimension;
- the UI cannot map null to 0, 100, green, or red;
- trend comparisons require compatible rule and score-policy versions, or they are labeled non-comparable.

## 7. Overall score

The proposed V1 policy uses equal 25% weights for architecture, security, performance, and scalability. Equal weights are transparent and avoid pretending there is a universal industry weighting before product evidence exists.

An overall numeric score appears only when all four dimensions are assessed. Until then, the dashboard shows the available dimension scores plus a coverage statement such as “3 of 4 dimensions assessed; performance not measured.” It does not average the remaining dimensions and call the result overall health.

Static analysis creates immutable architecture, security, and scalability scorecards. A performance run creates its own immutable performance scorecard. The displayed overall value belongs to an immutable health report that pins those static results and one compatible performance run. A newer run creates a newer report instead of retroactively changing an earlier dashboard.

The equal weighting is a product policy, not a mathematical truth. A future workspace-specific policy could use configured weights, but comparisons are valid only within the same policy version.

## 8. Performance score

Performance scoring needs a successful run and user-configured thresholds. The platform does not define a universal acceptable latency or error rate for every application.

The run records:

- tool and version;
- sanitized target origin and environment label;
- duration and scenario stages;
- requested and achieved virtual users/connections;
- requests per second;
- p50, p95, and p99 latency;
- error rate, timeouts, dropped iterations/work;
- response-size summary when available;
- runner CPU and memory saturation;
- configured thresholds and pass/fail results.

The score policy can deduct from explicit threshold violations after `score-v1` calibration. Raw RPS is not inherently good or bad without workload and resource context. k6 and autocannon results are not merged into one trend unless scenario semantics and normalization are compatible.

## 9. Prioritization

Deterministic default ordering uses:

1. severity;
2. confidence;
3. score impact;
4. rule priority;
5. stable path/rule tie-breakers.

AI may produce an alternative explanation or recommended sequence, but the UI labels it as AI-generated and never replaces the deterministic order. If business criticality is later added by the user, it becomes explicit structured input with provenance.

## 10. Issue timeline

Timeline state uses finding fingerprints across two analyses. A finding is only marked resolved when the responsible analyzer and rule completed compatibly in both analyses. If a rule did not run, the state is unknown rather than resolved.

Charts show:

- new, persistent, resolved, and unknown counts;
- severity distribution by analysis;
- score changes only across compatible score policies;
- markers when snapshot source, rule set, or performance scenario changed.

This avoids a visually attractive but false trend caused by a disabled analyzer or changed rule.

## 11. Testing and calibration

- golden tests assert exact rule ID, location, evidence, severity, confidence, and deduction;
- size-invariance tests prove duplicate occurrences stop at the rule cap;
- coverage tests prove a failed or skipped rule cannot improve a score;
- property tests keep all non-null scores within 0–100 and make calculation order-independent;
- comparison tests cover rule-version incompatibility and unknown/resolved behavior;
- performance fixtures cover threshold boundaries, invalid samples, dropped load, and runner saturation;
- a reviewed calibration corpus records expected true positives, false positives, and accepted ambiguity;
- rule acceptance requires a documented false-positive risk and at least one positive and negative fixture;
- dashboard tests verify null states, score explanations, and accessible non-color-only severity presentation.

## 12. Production concerns

- Lockfile vulnerability results record advisory database/source timestamp; old results may be stale and must say so.
- Generated or vendored paths are excluded by an explicit, visible policy, not silently ignored.
- Monorepos preserve project-level context so one generated app does not dominate a repository score.
- Suppressions require actor, reason, scope, and expiry; suppression does not delete historical evidence.
- Score changes caused only by policy/rule updates are distinguished from code changes.
- No marketing language such as “production ready” or “supports 10,000 users” is derived from a score.
