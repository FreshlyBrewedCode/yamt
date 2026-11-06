-- #44 (epic #36): planning requests, their inputs (made like captures), the rounds a `plan` job
-- fills and their suggestions. Inputs are a sibling of `captures` rather than more rows in it
-- (`captures.meal_id` is NOT NULL and the table is immutable, with transcripts and questions
-- hanging off it). Enum-like columns are validated in code (the zod enums in @yamt/shared).

CREATE TABLE planning_requests (
  id               TEXT PRIMARY KEY,
  -- from the filters ("Dinners Tue–Thu"), or the outline's
  title            TEXT NOT NULL,
  -- user | nightly
  origin           TEXT NOT NULL DEFAULT 'user',
  -- JSON: the complete filters (defaults filled in when the request was made)
  filters          TEXT NOT NULL,
  -- the IANA zone its days are in (the phone's)
  time_zone        TEXT NOT NULL,
  archived_at      INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX planning_requests_open ON planning_requests(created_at) WHERE archived_at IS NULL;

CREATE TABLE planning_rounds (
  id               TEXT PRIMARY KEY,
  request_id       TEXT NOT NULL REFERENCES planning_requests(id),
  -- 1, 2, … within the request
  number           INTEGER NOT NULL,
  -- first | more | steer
  kind             TEXT NOT NULL,
  -- queued | running | done | failed
  status           TEXT NOT NULL DEFAULT 'queued',
  -- suggestions asked for
  count            INTEGER NOT NULL CHECK (count > 0),
  -- the run filling it (#45); no foreign key: runs belong to meals until #45 widens them
  run_id           TEXT,
  error            TEXT,
  created_at       INTEGER NOT NULL,
  started_at       INTEGER,
  ended_at         INTEGER,
  UNIQUE (request_id, number)
);
-- one open round per request
CREATE UNIQUE INDEX planning_rounds_one_open ON planning_rounds(request_id) WHERE status IN ('queued', 'running');

CREATE TABLE planning_inputs (
  id               TEXT PRIMARY KEY,
  request_id       TEXT NOT NULL REFERENCES planning_requests(id),
  -- text | link | audio | image | file
  kind             TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  captured_at      INTEGER,
  taken_at         INTEGER,
  -- media inputs, stored like captures' (media/<yyyy>/<mm>/<input id>.<ext>)
  mime_type        TEXT,
  media_path       TEXT,
  byte_size        INTEGER,
  sha256           TEXT,
  file_name        TEXT,
  jpeg_path        TEXT,
  jpeg_status      TEXT,
  text             TEXT,
  url              TEXT,
  -- the round it went into: set once, when the next round starts
  round_id         TEXT REFERENCES planning_rounds(id),
  retracted_at     INTEGER
);
CREATE INDEX planning_inputs_request ON planning_inputs(request_id, created_at);

-- Immutable like captures: only the round (once) and the retraction (once) are ever set.
CREATE TRIGGER planning_inputs_immutable
BEFORE UPDATE OF id, request_id, kind, created_at, captured_at, taken_at, mime_type, media_path, byte_size,
  sha256, file_name, jpeg_path, jpeg_status, text, url ON planning_inputs
BEGIN
  SELECT RAISE(ABORT, 'planning inputs are immutable');
END;
CREATE TRIGGER planning_inputs_round_once
BEFORE UPDATE OF round_id ON planning_inputs WHEN OLD.round_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'the input is in a round already');
END;
CREATE TRIGGER planning_inputs_retract_once
BEFORE UPDATE OF retracted_at ON planning_inputs WHEN OLD.retracted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'input already retracted');
END;
CREATE TRIGGER planning_inputs_never_deleted
BEFORE DELETE ON planning_inputs
BEGIN
  SELECT RAISE(ABORT, 'planning inputs are never deleted');
END;

-- A voice input's transcript, as `transcripts` is a voice capture's. Derived, so replaceable.
CREATE TABLE planning_transcripts (
  input_id         TEXT PRIMARY KEY REFERENCES planning_inputs(id),
  -- pending | done | failed
  status           TEXT NOT NULL,
  text             TEXT,
  model            TEXT,
  language         TEXT,
  duration_ms      INTEGER,
  -- JSON [{startMs, endMs, text}]
  segments         TEXT,
  elapsed_ms       INTEGER,
  -- JSON: the STT settings it ran with
  settings         TEXT,
  error            TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE planning_suggestions (
  id               TEXT PRIMARY KEY,
  round_id         TEXT NOT NULL REFERENCES planning_rounds(id),
  -- 0, 1, … in the outline's order
  position         INTEGER NOT NULL,
  -- outlined | ready | failed
  status           TEXT NOT NULL DEFAULT 'outlined',
  title            TEXT NOT NULL,
  -- one line
  approach         TEXT NOT NULL DEFAULT '',
  -- published | adapted | composed
  source_mode      TEXT NOT NULL,
  source_url       TEXT,
  proposed_date    TEXT,
  proposed_slot    TEXT,
  -- set when ready: the suggestion is this insert-only recipe
  recipe_id        TEXT REFERENCES recipes(id),
  -- JSON list of up to four short lines
  why              TEXT NOT NULL DEFAULT '[]',
  -- the agent's reason when failed
  failure          TEXT,
  -- picked | rejected | null
  verdict          TEXT,
  planned_meal_id  TEXT REFERENCES planned_meals(id) ON DELETE SET NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  UNIQUE (round_id, position)
);
CREATE INDEX planning_suggestions_planned_meal ON planning_suggestions(planned_meal_id) WHERE planned_meal_id IS NOT NULL;
