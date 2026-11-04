-- #30: log a meal again. The new meal names the meal it was logged again from; its one revision
-- is a copy of that meal's current revision (same items and per-100 g snapshots, grams scaled),
-- saved without a run. Revisions stay immutable: adding columns updates no row.

ALTER TABLE meals ADD COLUMN source_meal_id TEXT REFERENCES meals(id);

-- analysis (a run or an interactive session saved it) | copy (logged again, no run)
ALTER TABLE meal_revisions ADD COLUMN kind TEXT NOT NULL DEFAULT 'analysis';
-- a copy's original: the source meal's revision it was copied from
ALTER TABLE meal_revisions ADD COLUMN source_revision_id TEXT REFERENCES meal_revisions(id);
