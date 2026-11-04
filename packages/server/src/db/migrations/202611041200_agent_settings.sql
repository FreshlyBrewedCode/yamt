-- #28: agent settings made in the app (key/value, JSON values; no secrets ever), and what each
-- analysis run asked for and ran with.

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  -- JSON; `agent`: {harness, model, effort}
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- the model the settings asked for (`model` stays the one that answered)
ALTER TABLE runs ADD COLUMN requested_model TEXT;
-- the effort asked for, and the one the session ran with (null: the harness has no effort option)
ALTER TABLE runs ADD COLUMN requested_effort TEXT;
ALTER TABLE runs ADD COLUMN effort TEXT;
-- what didn't apply as asked (a model or effort the harness doesn't offer), null when all did
ALTER TABLE runs ADD COLUMN config_note TEXT;
