-- Wave 1 (#7): the food cache (Open Food Facts, USDA FDC, labels, custom foods) with a full-text
-- index, and analysis revisions with their items and questions. Revisions, items and questions
-- are written once and kept forever; only a question's answered_by_capture_id changes.

CREATE TABLE foods (
  id                TEXT PRIMARY KEY,
  -- off | fdc | label | custom
  source            TEXT NOT NULL,
  -- barcode (off, label) or FDC id (fdc); null for custom foods
  source_ref        TEXT,
  name              TEXT NOT NULL,
  brand             TEXT,
  -- the core set per 100 g (kcal, grams); null where the source has no value
  energy_kcal       REAL,
  protein_g         REAL,
  fat_g             REAL,
  saturated_fat_g   REAL,
  carbohydrate_g    REAL,
  sugars_g          REAL,
  fiber_g           REAL,
  salt_g            REAL,
  -- JSON {<name>: {value, unit}}: the full profile per 100 g as the source reports it
  nutrients         TEXT NOT NULL DEFAULT '{}',
  -- JSON [{label, grams}]: known portions (FDC portions, the OFF serving size, a label's)
  portions          TEXT NOT NULL DEFAULT '[]',
  -- JSON: the source payload as fetched (or what a label/custom food was made from)
  raw               TEXT,
  fetched_at        INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
-- one cached row per source record: lookups refresh it in place
CREATE UNIQUE INDEX foods_source_ref ON foods(source, source_ref) WHERE source_ref IS NOT NULL;

-- Personal-history search over name and brand; umlauts fold (käse matches kase). A plain FTS
-- table keyed by food_id rather than external content: the implicit rowid of a TEXT-keyed table
-- may change on VACUUM.
CREATE VIRTUAL TABLE foods_fts USING fts5(
  food_id UNINDEXED, name, brand, tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER foods_fts_insert AFTER INSERT ON foods BEGIN
  INSERT INTO foods_fts (food_id, name, brand) VALUES (NEW.id, NEW.name, COALESCE(NEW.brand, ''));
END;
CREATE TRIGGER foods_fts_update AFTER UPDATE OF name, brand ON foods BEGIN
  DELETE FROM foods_fts WHERE food_id = OLD.id;
  INSERT INTO foods_fts (food_id, name, brand) VALUES (NEW.id, NEW.name, COALESCE(NEW.brand, ''));
END;
CREATE TRIGGER foods_fts_delete AFTER DELETE ON foods BEGIN
  DELETE FROM foods_fts WHERE food_id = OLD.id;
END;

CREATE TABLE meal_revisions (
  id           TEXT PRIMARY KEY,
  meal_id      TEXT NOT NULL REFERENCES meals(id),
  -- 1, 2, … per meal
  number       INTEGER NOT NULL,
  -- the analysis run (#8); null when an interactive session saved it
  run_id       TEXT,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  eaten_at     INTEGER,
  -- JSON list of strings ("assumed 1 tbsp olive oil")
  assumptions  TEXT NOT NULL DEFAULT '[]',
  -- analysed | needs_input
  status       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE (meal_id, number)
);

CREATE TABLE meal_items (
  id               TEXT PRIMARY KEY,
  revision_id      TEXT NOT NULL REFERENCES meal_revisions(id),
  position         INTEGER NOT NULL,
  -- null for a pure estimate (then the per-100 g columns are the estimate)
  food_id          TEXT REFERENCES foods(id),
  description      TEXT NOT NULL,
  grams            REAL NOT NULL CHECK (grams > 0),
  -- weighed | label | database | estimate
  provenance       TEXT NOT NULL,
  -- high | medium | low
  confidence       TEXT NOT NULL,
  note             TEXT,
  -- the core set per 100 g as used: copied from the food when saved, so a refreshed food never
  -- changes an old revision's totals
  energy_kcal      REAL,
  protein_g        REAL,
  fat_g            REAL,
  saturated_fat_g  REAL,
  carbohydrate_g   REAL,
  sugars_g         REAL,
  fiber_g          REAL,
  salt_g           REAL
);
CREATE INDEX meal_items_revision ON meal_items(revision_id, position);
CREATE INDEX meal_items_food ON meal_items(food_id);

CREATE TABLE meal_questions (
  id                      TEXT PRIMARY KEY,
  revision_id             TEXT NOT NULL REFERENCES meal_revisions(id),
  position                INTEGER NOT NULL,
  question                TEXT NOT NULL,
  why_it_matters          TEXT NOT NULL,
  impact_kcal             REAL NOT NULL,
  -- the latest live answer capture (captures.question_id points back here)
  answered_by_capture_id  TEXT REFERENCES captures(id)
);
CREATE INDEX meal_questions_revision ON meal_questions(revision_id, position);

-- Written once, kept forever.
CREATE TRIGGER meal_revisions_immutable BEFORE UPDATE ON meal_revisions
BEGIN
  SELECT RAISE(ABORT, 'revisions are immutable');
END;
CREATE TRIGGER meal_revisions_never_deleted BEFORE DELETE ON meal_revisions
BEGIN
  SELECT RAISE(ABORT, 'revisions are never deleted');
END;
CREATE TRIGGER meal_items_immutable BEFORE UPDATE ON meal_items
BEGIN
  SELECT RAISE(ABORT, 'revision items are immutable');
END;
CREATE TRIGGER meal_items_never_deleted BEFORE DELETE ON meal_items
BEGIN
  SELECT RAISE(ABORT, 'revision items are never deleted');
END;
CREATE TRIGGER meal_questions_immutable
BEFORE UPDATE OF id, revision_id, position, question, why_it_matters, impact_kcal ON meal_questions
BEGIN
  SELECT RAISE(ABORT, 'questions are immutable');
END;
CREATE TRIGGER meal_questions_never_deleted BEFORE DELETE ON meal_questions
BEGIN
  SELECT RAISE(ABORT, 'questions are never deleted');
END;

-- captures.question_id (#6) has no foreign key: adding one would mean rebuilding the immutable
-- captures table. Captures are only ever inserted, so checking on insert is equivalent: the
-- question must exist and belong to the same meal. (The service also requires the meal's current
-- revision.)
CREATE TRIGGER captures_question_of_meal
BEFORE INSERT ON captures WHEN NEW.question_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'question_id must name a question of the same meal')
  WHERE NOT EXISTS (
    SELECT 1 FROM meal_questions q JOIN meal_revisions r ON r.id = q.revision_id
    WHERE q.id = NEW.question_id AND r.meal_id = NEW.meal_id
  );
END;
