-- #39 (epic #36): recipes with ingredients matched to foods, planned meals on days, and meals
-- logged from the plan ("Ate it"). Recipes are insert-only like revisions: a changed recipe is a
-- new row, so a planned meal's numbers never move under it. Enum-like columns are validated in
-- code (the zod enums in @yamt/shared).

CREATE TABLE recipes (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  -- one line
  summary          TEXT NOT NULL DEFAULT '',
  -- published (as published) | adapted (based on a real recipe) | composed (the agent's own)
  source_mode      TEXT NOT NULL,
  source_url       TEXT,
  -- "chefkoch.de"
  source_name      TEXT,
  -- JSON list of short strings: what an adapted recipe changed ("Sahne → Kokosmilch light")
  changes          TEXT NOT NULL DEFAULT '[]',
  -- the portions the item grams are for
  servings         INTEGER NOT NULL CHECK (servings > 0),
  time_active_min  INTEGER,
  time_total_min   INTEGER,
  -- JSON list of strings
  steps            TEXT NOT NULL DEFAULT '[]',
  notes            TEXT,
  created_at       INTEGER NOT NULL
);

CREATE TABLE recipe_items (
  id               TEXT PRIMARY KEY,
  recipe_id        TEXT NOT NULL REFERENCES recipes(id),
  position         INTEGER NOT NULL,
  -- null for a pure estimate (then the per-100 g columns are the estimate)
  food_id          TEXT REFERENCES foods(id),
  -- as written: "½ Hokkaido (ca. 500 g)"
  description      TEXT NOT NULL,
  -- for the recipe's servings
  grams            REAL NOT NULL CHECK (grams > 0),
  -- weighed | label | database | estimate
  provenance       TEXT NOT NULL,
  -- high | medium | low
  confidence       TEXT NOT NULL,
  note             TEXT,
  -- 0 | 1: "Feta, optional"
  optional         INTEGER NOT NULL DEFAULT 0,
  -- the core set per 100 g, copied from the food when saved (as meal_items do)
  energy_kcal      REAL,
  protein_g        REAL,
  fat_g            REAL,
  saturated_fat_g  REAL,
  carbohydrate_g   REAL,
  sugars_g         REAL,
  fiber_g          REAL,
  salt_g           REAL
);
CREATE INDEX recipe_items_recipe ON recipe_items(recipe_id, position);
CREATE INDEX recipe_items_food ON recipe_items(food_id);

CREATE TRIGGER recipes_immutable BEFORE UPDATE ON recipes
BEGIN
  SELECT RAISE(ABORT, 'recipes are immutable: save a new one');
END;
CREATE TRIGGER recipes_never_deleted BEFORE DELETE ON recipes
BEGIN
  SELECT RAISE(ABORT, 'recipes are never deleted');
END;
CREATE TRIGGER recipe_items_immutable BEFORE UPDATE ON recipe_items
BEGIN
  SELECT RAISE(ABORT, 'recipe items are immutable');
END;
CREATE TRIGGER recipe_items_never_deleted BEFORE DELETE ON recipe_items
BEGIN
  SELECT RAISE(ABORT, 'recipe items are never deleted');
END;

CREATE TABLE planned_meals (
  id               TEXT PRIMARY KEY,
  -- the local calendar date (YYYY-MM-DD), like goals
  date             TEXT NOT NULL,
  -- breakfast | lunch | dinner | snack
  slot             TEXT NOT NULL,
  -- 0, 1, … within the date's slot
  position         INTEGER NOT NULL,
  recipe_id        TEXT NOT NULL REFERENCES recipes(id),
  -- the recipe's
  title            TEXT NOT NULL,
  -- 0 for a leftover (cooked with another planned meal; validated in code)
  portions_cooked  REAL NOT NULL DEFAULT 1 CHECK (portions_cooked >= 0),
  -- a factor of one portion
  portion_eaten    REAL NOT NULL DEFAULT 1 CHECK (portion_eaten > 0),
  -- planned | logged | skipped
  status           TEXT NOT NULL DEFAULT 'planned',
  logged_meal_id   TEXT REFERENCES meals(id),
  -- the planned meal whose extra cooked portion this is
  leftover_of      TEXT REFERENCES planned_meals(id) ON DELETE SET NULL,
  -- the suggestion it was picked from (#36, subtask 5 on)
  suggestion_id    TEXT,
  note             TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX planned_meals_day ON planned_meals(date, slot, position);
-- one planned meal per logged meal
CREATE UNIQUE INDEX planned_meals_logged_meal ON planned_meals(logged_meal_id) WHERE logged_meal_id IS NOT NULL;

-- Unplanning deletes a planned meal; one that was logged or skipped is history.
CREATE TRIGGER planned_meals_keep_history BEFORE DELETE ON planned_meals WHEN OLD.status != 'planned'
BEGIN
  SELECT RAISE(ABORT, 'only a planned meal can be unplanned');
END;

-- "Ate it": the meal logged from a planned meal. Its revision 1 has kind `plan` (meal_revisions.kind,
-- validated in code) and no source revision. No foreign key: removing that meal puts the planned
-- meal back to `planned`, and unplanning it then deletes a row the removed meal still names.
ALTER TABLE meals ADD COLUMN source_planned_meal_id TEXT;
CREATE INDEX meals_source_planned_meal ON meals(source_planned_meal_id) WHERE source_planned_meal_id IS NOT NULL;
