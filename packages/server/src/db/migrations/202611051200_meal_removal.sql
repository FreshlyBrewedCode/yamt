-- Removing a meal is soft: the meal row gets `removed_at` (epoch ms) and drops out of every list,
-- day, month, total, history and share target; restoring clears it. Captures, media files,
-- revisions, items, questions and runs stay as they are (they are immutable anyway).

ALTER TABLE meals ADD COLUMN removed_at INTEGER;

-- Nothing new lands on a removed meal: the services refuse it with a 409 first; these catch
-- whatever slips past them (a run that was mid-flight when the meal was removed).
CREATE TRIGGER captures_not_on_removed_meal
BEFORE INSERT ON captures
WHEN (SELECT removed_at FROM meals WHERE id = NEW.meal_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'the meal was removed');
END;
CREATE TRIGGER revisions_not_on_removed_meal
BEFORE INSERT ON meal_revisions
WHEN (SELECT removed_at FROM meals WHERE id = NEW.meal_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'the meal was removed');
END;
