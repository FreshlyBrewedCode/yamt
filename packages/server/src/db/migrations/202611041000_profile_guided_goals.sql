-- #24: guided goals. The body profile is a single row (id = 1): what the guided setup asks
-- (sex, birth year, height, optional body fat, daily life, training as JSON
-- {"sessionsPerWeek", "minutes", "type", "intensity"}); weight comes from weight_entries.
CREATE TABLE profile (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  sex           TEXT NOT NULL,
  birth_year    INTEGER NOT NULL,
  height_cm     REAL NOT NULL,
  -- null: not given
  body_fat_pct  REAL,
  daily_life    TEXT NOT NULL,
  training      TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- How a guided goal was calculated (JSON: algorithm version, inputs, choices, the weight it used
-- and every intermediate value with the explanation lines). Null for targets set by hand.
ALTER TABLE goals ADD COLUMN derivation TEXT;
