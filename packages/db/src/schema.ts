/** 建表 DDL。启动时幂等执行 (IF NOT EXISTS)。详细字段说明见 docs/DESIGN.md §3。 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  template_id TEXT,
  aspect      TEXT NOT NULL DEFAULT 'original',
  status      TEXT NOT NULL DEFAULT 'draft',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  path        TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  width       INTEGER NOT NULL DEFAULT 0,
  height      INTEGER NOT NULL DEFAULT 0,
  fps         REAL    NOT NULL DEFAULT 0,
  codec       TEXT    NOT NULL DEFAULT '',
  has_audio   INTEGER NOT NULL DEFAULT 0,
  thumb_path  TEXT,
  probe_json  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_project ON sources(project_id);

CREATE TABLE IF NOT EXISTS clips (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  start_ms    INTEGER NOT NULL,
  end_ms      INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  thumb_path  TEXT,
  score       REAL,
  order_index INTEGER NOT NULL DEFAULT 0,
  included    INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clips_project ON clips(project_id);

CREATE TABLE IF NOT EXISTS analyses (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id  TEXT,
  kind       TEXT NOT NULL,
  data_json  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analyses_project ON analyses(project_id);

CREATE TABLE IF NOT EXISTS renders (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  spec_json   TEXT,
  out_path    TEXT,
  thumb_path  TEXT,
  duration_ms INTEGER,
  aspect      TEXT NOT NULL DEFAULT 'original',
  template_id TEXT,
  ai_refined  INTEGER NOT NULL DEFAULT 0,
  prompt      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_renders_project ON renders(project_id);

CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  project_id   TEXT NOT NULL,
  payload_json TEXT,
  status       TEXT NOT NULL DEFAULT 'queued',
  priority     INTEGER NOT NULL DEFAULT 0,
  progress     REAL NOT NULL DEFAULT 0,
  worker_id    TEXT,
  error        TEXT,
  lease_until  INTEGER,
  created_at   INTEGER NOT NULL,
  started_at   INTEGER,
  finished_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(status, priority DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS job_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     TEXT NOT NULL,
  project_id TEXT NOT NULL,
  progress   REAL NOT NULL DEFAULT 0,
  message    TEXT,
  ts         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_events_project ON job_events(project_id, id);
`;
