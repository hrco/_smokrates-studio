export type Migration = {
  version: number;
  name: string;
  sql: string;
};

const INITIAL_SCHEMA_SQL = `
CREATE TABLE plans (
  week_start TEXT PRIMARY KEY
    CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved')),
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  week_start TEXT NOT NULL REFERENCES plans (week_start) ON DELETE CASCADE,
  night INTEGER NOT NULL CHECK (night BETWEEN 1 AND 7),
  format TEXT NOT NULL CHECK (format IN ('track_card', 'scene', 'loop', 'title')),
  track_slug TEXT NOT NULL,
  start_second INTEGER NOT NULL CHECK (start_second >= 0),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds BETWEEN 1 AND 60),
  claim TEXT NOT NULL,
  caption TEXT NOT NULL,
  publish_at_ms INTEGER NOT NULL,
  label_decision TEXT NOT NULL CHECK (label_decision IN ('label_on', 'label_off')),
  status TEXT NOT NULL
    CHECK (status IN ('planned', 'rendering', 'ready', 'approved', 'skipped', 'not_new')),
  UNIQUE (week_start, night)
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('still', 'clip')),
  parent_asset_id TEXT REFERENCES assets (id),
  grok_tool TEXT NOT NULL,
  prompt TEXT NOT NULL,
  file_path TEXT NOT NULL,
  is_approved INTEGER NOT NULL DEFAULT 0 CHECK (is_approved IN (0, 1)),
  created_at_ms INTEGER NOT NULL,
  CHECK (kind <> 'clip' OR parent_asset_id IS NOT NULL)
);

CREATE TABLE renders (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes (id),
  file_path TEXT NOT NULL,
  duration_seconds REAL NOT NULL,
  frame_count INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('render', 'asset', 'send')),
  episode_id TEXT REFERENCES episodes (id),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  message TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE UNIQUE INDEX jobs_one_heavy_running ON jobs ((1))
  WHERE status = 'running' AND kind IN ('render', 'asset');

CREATE TABLE publishes (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes (id),
  platform TEXT NOT NULL CHECK (platform IN ('tiktok', 'youtube')),
  external_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing', 'sent', 'stalled', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  last_checked_at_ms INTEGER,
  UNIQUE (episode_id, platform)
);

CREATE TABLE canon (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets (id),
  approved_at_ms INTEGER NOT NULL
);
`;

const GROKS_PROMPT_SQL = `
ALTER TABLE episodes ADD COLUMN groks_prompt TEXT;
`;

/** Append-only. Never edit or reorder a released migration: add a new one. */
export const MIGRATIONS: readonly Migration[] = [
  {version: 1, name: 'initial_schema', sql: INITIAL_SCHEMA_SQL},
  {version: 2, name: 'episode_groks_prompt', sql: GROKS_PROMPT_SQL},
];
