-- Wave 1 (#6): meals, their immutable captures, transcripts of audio captures, the job queue and
-- weight entries. Times are epoch milliseconds. Enum-like columns are validated in code (shared
-- zod enums), not with CHECK, so adding a value never needs a table rebuild.

CREATE TABLE meals (
  id                   TEXT PRIMARY KEY,
  -- draft | queued | analysing | analysed | needs_input | failed
  status               TEXT NOT NULL DEFAULT 'draft',
  eaten_at             INTEGER NOT NULL,
  -- created | capture | user | agent: only created/capture follow the captures
  eaten_at_source      TEXT NOT NULL DEFAULT 'created',
  -- the analysis revision shown (#7); no FK until the revisions table exists
  current_revision_id  TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX meals_eaten_at ON meals(eaten_at);

-- Raw material, never edited or deleted: only retracted_at may change (once).
CREATE TABLE captures (
  id               TEXT PRIMARY KEY,
  meal_id          TEXT NOT NULL REFERENCES meals(id),
  -- audio | image | text | link | file | correction | answer
  kind             TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  -- client-reported capture time, and the EXIF DateTimeOriginal of photos
  captured_at      INTEGER,
  taken_at         INTEGER,
  -- media kinds: the original under <data>/media/<yyyy>/<mm>/<capture id>.<ext>
  mime_type        TEXT,
  media_path       TEXT,
  byte_size        INTEGER,
  sha256           TEXT,
  file_name        TEXT,
  -- HEIC/HEIF photos: a JPEG next to the original; 'missing' if it could not be made
  jpeg_path        TEXT,
  jpeg_status      TEXT,
  -- text-like kinds (a link may carry a note in text)
  text             TEXT,
  url              TEXT,
  -- answer captures: the question answered; the questions table and its FK come with #7/#11
  question_id      TEXT,
  retracted_at     INTEGER
);
CREATE INDEX captures_meal ON captures(meal_id, created_at);
-- Enforced here too, not just by the repository: the raw columns can never change, a retraction
-- is set once, and nothing is deleted. (The JPEG derivative may be re-made.)
CREATE TRIGGER captures_immutable
BEFORE UPDATE OF id, meal_id, kind, created_at, captured_at, taken_at, mime_type, media_path, byte_size,
  sha256, file_name, text, url, question_id ON captures
BEGIN
  SELECT RAISE(ABORT, 'captures are immutable');
END;
CREATE TRIGGER captures_retract_once
BEFORE UPDATE OF retracted_at ON captures WHEN OLD.retracted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'capture already retracted');
END;
CREATE TRIGGER captures_never_deleted
BEFORE DELETE ON captures
BEGIN
  SELECT RAISE(ABORT, 'captures are never deleted');
END;

-- Derived from an audio capture and replaceable (re-transcribe with a better model).
CREATE TABLE transcripts (
  capture_id   TEXT PRIMARY KEY REFERENCES captures(id),
  -- pending | done | failed
  status       TEXT NOT NULL DEFAULT 'pending',
  text         TEXT,
  model        TEXT,
  language     TEXT,
  duration_ms  INTEGER,
  -- JSON [{startMs, endMs, text}]
  segments     TEXT,
  error        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- A small queue for the in-process worker loop (#8 analyse, #9 transcribe).
CREATE TABLE jobs (
  id            TEXT PRIMARY KEY,
  -- transcribe | analyse
  type          TEXT NOT NULL,
  payload       TEXT NOT NULL DEFAULT '{}',
  -- e.g. analyse:<meal id>: at most one queued job per key, never two running at once
  dedupe_key    TEXT,
  -- queued | running | done | failed | cancelled
  status        TEXT NOT NULL DEFAULT 'queued',
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  run_after     INTEGER NOT NULL,
  last_error    TEXT,
  claimed_at    INTEGER,
  finished_at   INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX jobs_due ON jobs(status, run_after);
CREATE UNIQUE INDEX jobs_queued_key ON jobs(dedupe_key) WHERE status = 'queued' AND dedupe_key IS NOT NULL;

CREATE TABLE weight_entries (
  id           TEXT PRIMARY KEY,
  measured_at  INTEGER NOT NULL,
  kg           REAL NOT NULL CHECK (kg > 0),
  note         TEXT NOT NULL DEFAULT '',
  -- manual (later: imports such as Garmin)
  source       TEXT NOT NULL DEFAULT 'manual',
  created_at   INTEGER NOT NULL
);
CREATE INDEX weight_entries_measured_at ON weight_entries(measured_at);
