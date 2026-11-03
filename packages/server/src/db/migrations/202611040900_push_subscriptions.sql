-- #13: Web Push subscriptions, one per device and browser that turned notifications on. The
-- endpoint (the push service's URL for it) identifies it; p256dh and auth are the browser's keys
-- the payload is encrypted with. `events` is a JSON object of toggles ({"analysed": true, …}).
-- A push service answering 404/410 means the subscription is gone: the row is deleted.
CREATE TABLE push_subscriptions (
  id            TEXT PRIMARY KEY,
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  events        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_sent_at  INTEGER,
  last_error    TEXT
);
