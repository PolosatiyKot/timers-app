CREATE TABLE IF NOT EXISTS accounts (
  role          TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  role       TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Timers were redesigned (system/player/description/EVE time + duration-based
-- countdown with start/pause/stop). Re-running this drops any timers created
-- under the old schema.
DROP TABLE IF EXISTS timers;

CREATE TABLE timers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  system            TEXT NOT NULL DEFAULT '',
  player            TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  eve_time          TEXT NOT NULL DEFAULT '',
  duration_seconds  INTEGER NOT NULL DEFAULT 0,
  remaining_seconds INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'stopped',   -- 'stopped' | 'running' | 'paused'
  target_time       TEXT,                              -- ISO datetime, set only while running
  created_by        TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);
