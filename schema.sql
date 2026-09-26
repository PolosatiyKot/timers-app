-- Run this AFTER dropping the old per-user schema (see README "Migration" section)
-- if you already applied the previous version of schema.sql.

DROP TABLE IF EXISTS users;

CREATE TABLE IF NOT EXISTS accounts (
  role          TEXT PRIMARY KEY,          -- 'admin' | 'user' | 'viewer'
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  role       TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  target_time TEXT NOT NULL,   -- ISO 8601 datetime the timer counts down to
  created_by  TEXT,            -- role that created it ('admin' / 'user')
  created_at  TEXT DEFAULT (datetime('now'))
);
