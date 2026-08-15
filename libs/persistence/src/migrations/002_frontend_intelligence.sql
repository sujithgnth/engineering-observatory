CREATE TABLE IF NOT EXISTS architecture_graphs (
  analysis_id uuid PRIMARY KEY REFERENCES analyses(id) ON DELETE CASCADE,
  schema_version text NOT NULL,
  analyzer_version text NOT NULL,
  snapshot_id uuid NOT NULL,
  frameworks text[] NOT NULL DEFAULT '{}',
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  health jsonb NOT NULL DEFAULT '[]'::jsonb,
  coverage jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analysis_files (
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  path text NOT NULL,
  language text NOT NULL,
  line_count integer NOT NULL CHECK (line_count > 0),
  byte_size integer NOT NULL CHECK (byte_size >= 0),
  content_hash text NOT NULL,
  is_test boolean NOT NULL DEFAULT false,
  PRIMARY KEY (analysis_id, path)
);

CREATE TABLE IF NOT EXISTS architecture_nodes (
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  id text NOT NULL,
  stable_key text NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  framework text NOT NULL,
  file_path text NOT NULL,
  line_start integer,
  line_end integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (analysis_id, id),
  UNIQUE (analysis_id, stable_key)
);

CREATE INDEX IF NOT EXISTS architecture_nodes_analysis_kind
  ON architecture_nodes (analysis_id, kind);
CREATE INDEX IF NOT EXISTS architecture_nodes_analysis_file
  ON architecture_nodes (analysis_id, file_path);

CREATE TABLE IF NOT EXISTS architecture_edges (
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  id text NOT NULL,
  source_node_id text NOT NULL,
  target_node_id text NOT NULL,
  kind text NOT NULL,
  confidence text NOT NULL,
  evidence_path text NOT NULL,
  evidence_line integer,
  PRIMARY KEY (analysis_id, id),
  FOREIGN KEY (analysis_id, source_node_id)
    REFERENCES architecture_nodes(analysis_id, id) ON DELETE CASCADE,
  FOREIGN KEY (analysis_id, target_node_id)
    REFERENCES architecture_nodes(analysis_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS architecture_edges_source
  ON architecture_edges (analysis_id, source_node_id, kind);
CREATE INDEX IF NOT EXISTS architecture_edges_target
  ON architecture_edges (analysis_id, target_node_id, kind);
