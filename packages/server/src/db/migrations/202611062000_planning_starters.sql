-- #48 (epic #36): the starters a nightly planning run writes for the entry screen. Stored without
-- a number (the app computes it live from the kind and the reference); a later save of the same
-- round replaces its set, so rows are derived and may be deleted. Enum-like columns are validated
-- in code (the zod enums in @yamt/shared).

CREATE TABLE planning_starters (
  id               TEXT PRIMARY KEY,
  -- the nightly round that wrote it
  round_id         TEXT NOT NULL REFERENCES planning_rounds(id),
  -- 0, 1, … in the order the agent gave
  position         INTEGER NOT NULL,
  -- protein_gap | use_up | variety | like_meal | season | last_request | other
  kind             TEXT NOT NULL,
  text             TEXT NOT NULL,
  detail           TEXT NOT NULL DEFAULT '',
  -- JSON StarterFilters: what a tap applies over the defaults
  filters          TEXT NOT NULL DEFAULT '{}',
  -- JSON StarterRef: {mealId?, requestId?, recipeId?, leftoverId?}
  ref              TEXT NOT NULL DEFAULT '{}',
  created_at       INTEGER NOT NULL,
  UNIQUE (round_id, position)
);
CREATE INDEX planning_starters_created ON planning_starters(created_at);
