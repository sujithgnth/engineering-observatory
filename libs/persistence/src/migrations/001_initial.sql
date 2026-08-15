CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO workspaces (id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Local workspace')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS repositories (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('archive', 'github')),
  provider_repository_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_snapshots (
  id uuid PRIMARY KEY,
  repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('archive', 'github')),
  artifact_path text NOT NULL,
  commit_sha text,
  archive_sha256 text,
  resolved_ref text,
  state text NOT NULL CHECK (state IN ('ready', 'rejected', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (source_kind = 'archive' AND archive_sha256 IS NOT NULL) OR
    (source_kind = 'github' AND commit_sha IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS snapshots_archive_identity
  ON source_snapshots (repository_id, archive_sha256)
  WHERE archive_sha256 IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS snapshots_commit_identity
  ON source_snapshots (repository_id, commit_sha)
  WHERE commit_sha IS NOT NULL;

CREATE TABLE IF NOT EXISTS analyses (
  id uuid PRIMARY KEY,
  repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES source_snapshots(id) ON DELETE RESTRICT,
  state text NOT NULL,
  stage text,
  rule_set_version text NOT NULL,
  score_policy_version text NOT NULL,
  failure_code text,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS analyses_repository_created
  ON analyses (repository_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analyses_state_created
  ON analyses (state, created_at);

CREATE TABLE IF NOT EXISTS project_profiles (
  analysis_id uuid PRIMARY KEY REFERENCES analyses(id) ON DELETE CASCADE,
  profile jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS findings (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  analyzer_id text NOT NULL,
  analyzer_version text NOT NULL,
  rule_id text NOT NULL,
  dimension text NOT NULL,
  severity text NOT NULL,
  confidence text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  file_path text NOT NULL,
  line_start integer,
  line_end integer,
  evidence jsonb NOT NULL,
  remediation text NOT NULL,
  score_deduction numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS findings_analysis_severity
  ON findings (analysis_id, severity);
CREATE INDEX IF NOT EXISTS findings_fingerprint
  ON findings (fingerprint);

CREATE TABLE IF NOT EXISTS scorecards (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  dimension text NOT NULL,
  assessment_state text NOT NULL,
  score numeric,
  policy_version text NOT NULL,
  deductions jsonb NOT NULL,
  coverage jsonb NOT NULL,
  UNIQUE (analysis_id, dimension),
  CHECK (score IS NULL OR (score >= 0 AND score <= 100))
);

CREATE TABLE IF NOT EXISTS ai_reviews (
  id uuid PRIMARY KEY,
  finding_id uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  state text NOT NULL,
  recommendation jsonb,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS performance_runs (
  id uuid PRIMARY KEY,
  repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  analysis_id uuid REFERENCES analyses(id) ON DELETE SET NULL,
  scenario jsonb NOT NULL,
  state text NOT NULL,
  tool_version text,
  requested_load jsonb NOT NULL,
  achieved_load jsonb,
  metrics jsonb,
  runner_metrics jsonb,
  threshold_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS performance_runs_repository_created
  ON performance_runs (repository_id, created_at DESC);

CREATE TABLE IF NOT EXISTS health_reports (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  performance_run_id uuid REFERENCES performance_runs(id) ON DELETE RESTRICT,
  assessment_state text NOT NULL,
  overall_score numeric,
  policy_version text NOT NULL,
  dimension_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100))
);

CREATE UNIQUE INDEX IF NOT EXISTS health_reports_initial_analysis
  ON health_reports (analysis_id)
  WHERE performance_run_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS health_reports_performance_run
  ON health_reports (performance_run_id)
  WHERE performance_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS health_reports_analysis_created
  ON health_reports (analysis_id, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  job_type text NOT NULL CHECK (job_type IN ('analysis', 'ai-review', 'performance')),
  target_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('queued', 'leased', 'completed', 'failed', 'cancelled')),
  attempt integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  leased_by text,
  safe_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_type, target_id)
);

CREATE INDEX IF NOT EXISTS jobs_available
  ON jobs (available_at, created_at)
  WHERE state = 'queued';
CREATE INDEX IF NOT EXISTS jobs_expired_lease
  ON jobs (lease_expires_at)
  WHERE state = 'leased';

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
