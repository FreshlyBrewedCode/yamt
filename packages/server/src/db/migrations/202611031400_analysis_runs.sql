-- Wave 1 (#8): one row per analysis run (an attempt of an `analyse` job driving an agent over
-- ACP). The full event stream lives in <data>/runs/<run id>/trace.ndjson; this row is the summary.
-- Revisions link their run through meal_revisions.run_id.

CREATE TABLE runs (
  id           TEXT PRIMARY KEY,
  meal_id      TEXT NOT NULL REFERENCES meals(id),
  job_id       TEXT REFERENCES jobs(id),
  -- the job's attempt this run was (1, 2, …)
  attempt      INTEGER NOT NULL,
  -- claude-code | custom
  harness      TEXT NOT NULL,
  model        TEXT,
  -- running | succeeded | failed | cancelled
  status       TEXT NOT NULL DEFAULT 'running',
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  -- the ACP stop reason (end_turn, max_tokens, refusal, cancelled, …)
  stop_reason  TEXT,
  -- JSON {turn: ACP Usage | null, context: {used, size, cost} | null}
  usage        TEXT,
  error        TEXT,
  -- the revision it saved (exactly one when it succeeded)
  revision_id  TEXT REFERENCES meal_revisions(id)
);
CREATE INDEX runs_meal ON runs(meal_id, started_at);

-- Why the meal's analysis failed for good; set together with status 'failed', cleared by any
-- other status.
ALTER TABLE meals ADD COLUMN analysis_error TEXT;
