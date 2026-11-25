CREATE TABLE reports (
  report_id TEXT PRIMARY KEY NOT NULL,
  submission_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('friction', 'plugin_failure')),
  summary TEXT NOT NULL,
  observed TEXT NOT NULL,
  expected TEXT NOT NULL,
  plugin TEXT,
  plugin_version TEXT,
  plugin_function TEXT,
  platform_version TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  fix_reference TEXT
);
CREATE INDEX reports_triage ON reports(status, received_at DESC);
