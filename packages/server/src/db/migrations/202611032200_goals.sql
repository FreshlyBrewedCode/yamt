-- #12: daily goals. A goal holds targets from a local calendar date (`YYYY-MM-DD`, the phone's
-- zone) until the next one starts; the goal in force on a day is the latest with
-- effective_from <= that day (ties: the later id, UUIDv7). New targets add a row; only a typo
-- fix updates the latest row in place, so the history stays intact.
CREATE TABLE goals (
  id               TEXT PRIMARY KEY,
  effective_from   TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- null: no target for it
  energy_kcal      REAL,
  protein_g        REAL,
  fat_g            REAL,
  carbohydrate_g   REAL,
  fiber_g          REAL,
  note             TEXT NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX goals_effective_from ON goals(effective_from, id);
