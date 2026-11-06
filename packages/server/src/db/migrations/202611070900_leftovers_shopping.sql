-- #49 (epic #36): leftovers that feed the next plan, and the shopping list's checks and own lines.
-- A short list, not a pantry. Enum-like columns are validated in code (the zod enums in
-- @yamt/shared).

CREATE TABLE leftovers (
  id               TEXT PRIMARY KEY,
  -- "Hokkaido", "Kürbis-Curry" (a cooked one: the recipe's title)
  description      TEXT NOT NULL,
  -- the food it is, when known (a pack the agent matched)
  food_id          TEXT REFERENCES foods(id),
  -- as said: "½", "1 bunch"
  quantity         TEXT,
  grams            REAL CHECK (grams IS NULL OR grams > 0),
  -- a cooked one: the portions still left (eating one from the plan takes it off)
  portions         REAL CHECK (portions IS NULL OR portions >= 0),
  -- cooked (extra portions of a planned meal) | pack (a remainder) | user (added by hand)
  source           TEXT NOT NULL,
  -- cooked: the planned meal cooked with the extra portions, its recipe and its date
  planned_meal_id  TEXT REFERENCES planned_meals(id) ON DELETE SET NULL,
  recipe_id        TEXT REFERENCES recipes(id),
  cooked_on        TEXT,
  -- pack: the planning round whose agent noted it, and the suggestion that leaves it over: such a
  -- one is on the list only once that suggestion's planned meal is logged (cooked)
  round_id         TEXT REFERENCES planning_rounds(id),
  suggestion_id    TEXT REFERENCES planning_suggestions(id),
  note             TEXT,
  -- open | used | gone
  status           TEXT NOT NULL DEFAULT 'open',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  -- when it became used or gone
  closed_at        INTEGER
);
CREATE INDEX leftovers_status ON leftovers(status, created_at);
-- one cooked leftover per planned meal
CREATE UNIQUE INDEX leftovers_cooked ON leftovers(planned_meal_id) WHERE planned_meal_id IS NOT NULL;
CREATE INDEX planned_meals_leftover_of ON planned_meals(leftover_of) WHERE leftover_of IS NOT NULL;

-- The shopping list itself is computed from the plan; only what the user did to it is stored: a
-- check of a computed line (by its key, with the grams it had, for the range it was made in) and
-- lines of their own. A row applies to every range that overlaps its own, so a change in the plan
-- or a narrower range keeps the checks where the line still exists.
CREATE TABLE shopping_items (
  id               TEXT PRIMARY KEY,
  -- check (of a computed line) | line (the user's own)
  kind             TEXT NOT NULL,
  -- check: the computed line's key ("food:<id>", "name:<words>")
  line_key         TEXT,
  -- check: the grams to buy when it was checked (a line that needs more later is open again)
  grams            REAL,
  -- line: what to buy
  text             TEXT,
  -- line: 0 | 1 (a check row is checked by existing)
  checked          INTEGER NOT NULL DEFAULT 0,
  range_from       TEXT NOT NULL,
  range_to         TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX shopping_items_range ON shopping_items(range_to, range_from);
