-- #45 (epic #36): the runs of `plan` jobs, one per attempt at filling a planning round, as
-- `runs` holds an analysis's. A sibling rather than a nullable `runs.meal_id`: SQLite can only
-- loosen that column by rebuilding `runs`, which `meal_revisions.run_id` references, and the
-- migration runner keeps foreign keys on. The trace lives in <data>/runs/<run id>/ alike.

CREATE TABLE planning_runs (
  id                TEXT PRIMARY KEY,
  round_id          TEXT NOT NULL REFERENCES planning_rounds(id),
  job_id            TEXT REFERENCES jobs(id),
  -- the job's attempt this run was (1, 2, …)
  attempt           INTEGER NOT NULL,
  -- claude-code | opencode | custom
  harness           TEXT NOT NULL,
  -- the model that answered (else the one asked for), and what the settings asked for
  model             TEXT,
  requested_model   TEXT,
  requested_effort  TEXT,
  effort            TEXT,
  config_note       TEXT,
  -- running | succeeded | failed | cancelled
  status            TEXT NOT NULL DEFAULT 'running',
  started_at        INTEGER NOT NULL,
  ended_at          INTEGER,
  stop_reason       TEXT,
  -- JSON {turn: ACP Usage | null, context: {used, size, cost} | null}
  usage             TEXT,
  error             TEXT,
  -- suggestions of the round that were ready when it ended
  ready             INTEGER
);
CREATE INDEX planning_runs_round ON planning_runs(round_id, started_at);

-- No plan job ran before this migration: a run id set so far names no run.
UPDATE planning_rounds SET run_id = NULL;

-- `planning_rounds.run_id` names one of the round's own runs (a foreign key would need a rebuild
-- of `planning_rounds`, which inputs and suggestions reference).
CREATE TRIGGER planning_rounds_run_insert
BEFORE INSERT ON planning_rounds
WHEN NEW.run_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM planning_runs WHERE id = NEW.run_id AND round_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'run_id: not a run of this round');
END;
CREATE TRIGGER planning_rounds_run_update
BEFORE UPDATE OF run_id ON planning_rounds
WHEN NEW.run_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM planning_runs WHERE id = NEW.run_id AND round_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'run_id: not a run of this round');
END;
CREATE TRIGGER planning_runs_never_deleted
BEFORE DELETE ON planning_runs
BEGIN
  SELECT RAISE(ABORT, 'planning runs are never deleted');
END;
