# yamt: architecture

What exists today (the scaffold, #3, the meal backend, #6, the nutrition layer with the yamt
MCP server, #7, the analysis job over ACP, #8, the transcription worker, #9, the PWA with
meal capture, #10, the meal detail with questions and corrections, #11, the day view with
goals and weight, #12, Web Push notifications, #13, the guided goal setup, #24, paste and
the iOS Shortcut share target, #26, and the agent settings, #28), how it
fits together, and what comes after wave 1. Why it is built this way:
[ADR 0001](adr/0001-wave-1-architecture.md). Commands and conventions: [AGENTS.md](../AGENTS.md).
The design: [design/design.md](design/design.md).

## Components

```
iPhone (Safari / home-screen PWA), on the tailnet
  │  https://<host>.<tailnet>.ts.net:7444   tailscale serve (foreground, TLS by Tailscale)
  │                                          adds Tailscale-User-Login for user-owned devices
  ▼
yamt start   (one Bun process, binds 127.0.0.1:7890 only)
  ├─ Hono JSON API   /api/*   identity-header auth (except /api/health), same-origin writes,
  │                           zod-validated bodies; meals, captures, media, weight, goals, days,
  │                           push subscriptions, the share target (/api/share: an iOS Shortcut)
  ├─ MCP server      /mcp     bearer tokens (agent runs, interactive Claude Code sessions),
  │                           loopback callers only; the agent's only way to read and write
  ├─ SPA             /*       packages/web/dist   (dev: Vite on 7891 proxies /api); the PWA:
  │                           manifest, icons, /sw.js (app shell, push and notification taps)
  ├─ job worker      drains the `jobs` table: `analyse` (one at a time), `transcribe` (one batch
  │    │             at a time, alongside)
  │    ├─ analysis run: one harness process per run, ACP over stdio, cwd ~/.yamt/runs/<run>/
  │    │    claude-agent-acp (node) → `claude` │ `opencode acp` │ custom ACP command
  │    │    (harness, model and effort: Settings → Agent, see Agent settings)
  │    │    └─ MCP over HTTP back to 127.0.0.1:7890/mcp with a per-run token
  │    ├─ transcription batch: ffmpeg per memo → 16 kHz WAV in a temp dir, then one
  │    │    services/stt process (uv, Python, faster-whisper on the CPU) for the batch
  │    └─ a settled analysis → Web Push (web-push: aes128gcm + VAPID) to each subscription
  └─ SQLite          ~/.yamt/yamt.db   (WAL, foreign keys, 0600)
     data dir        ~/.yamt/  (0700): yamt.db, media/, runs/, models/, config.json, mcp-token,
                               vapid.json
        │
        └─ outbound: Open Food Facts, USDA FoodData Central, recipe pages (timeouts, size caps,
                     rate limits; results cached in `foods`); the model API, via the harness;
                     push services (Apple, Google, Mozilla) with encrypted notifications
```

## Layout

```
packages/shared/src/      contracts shared by server and web (no runtime deps but zod)
  api.ts                  API paths, request schemas, response types (health, me)
  api-meals.ts            meals, captures, transcripts, media: `mealPaths`, enums, bodies, types
  api-weight.ts           weight entries: `weightPaths`, body, types
  api-goals.ts            goals and days: `goalPaths`, bodies, `DayResponse`, `goalInForce`, `goalPeriods`,
                          `dayProgress`, `addDays`, `goalLabel` (shared by server and web)
  goal-calc.ts            guided goals (#24): `calculateGoal` (the algorithm, `ALGORITHM_VERSION`), its
                          presets as data, `defaultChoices`, `goalWeight`, `refusalFor`; pure, no zod
  api-profile.ts          the profile and guided goals: `profilePaths`, `ProfileBody`, `GuidedGoalBody`
  api-nutrition.ts        foods, revisions, items, questions, totals: enums and types
  api-runs.ts             analysis runs and trace lines: `runPaths`, `AnalysisRun`, `TraceEntry`
  api-push.ts             Web Push: `pushPaths`, `PUSH_EVENTS`, `SubscribeBody`, `PushEventsBody`,
                          `PushPayload` (what the service worker receives)
  api-agent.ts            agent settings (#28): `agentPaths`, `HarnessKind`, `AgentSettingsBody`, `AgentResponse`
                          (values with their sources), `AgentOptionsResponse` (discovered models and efforts)
  api-share.ts            the share target: `sharePaths`, `ShareFields`, `ShareResponse`,
                          `SHARE_DRAFT_WINDOW_MS`, `singleUrl` (one URL alone → a link; paste uses it too)
packages/server/src/
  cli.ts                  `yamt start` (flags: --data-dir --port --https-port --local --no-auth --dev --no-build
                          --no-worker), `yamt mcp-token [--rotate]`
  server.ts               composition root: data dir, DB, services, API, static, the job worker
  services.ts             createServices: repositories + domain services, what HTTP talks to
  config.ts               data dir resolution and setup, config.json (login, FDC key, analysis), ports
  procs.ts                stopGroup: SIGTERM, then SIGKILL, to a whole process group
  acp/                    the ACP layer (no DB, no HTTP): protocol.ts (the SDK entrypoint), process.ts
                          (AcpProcess), run.ts (runPrompt: one session, one turn), config-options.ts
                          (model and effort options, generically), discover.ts (what a harness offers,
                          without a prompt), mcp.ts, adapters/ (claude-code, opencode, custom)
  agent/                  agent settings (#28): settings.ts (resolveAgent: the precedence; AgentService:
                          harnesses found here, save checked against the options), discovery.ts
                          (AgentDiscovery: one harness at a time, cached an hour)
  jobs/worker.ts          JobWorker: the in-process loop over `jobs`, handlers by type (single or batch)
  analysis/               job.ts (the `analyse` handler), prompt.ts (prompt and photos), permissions.ts
                          (the policy), skill.ts (loads log-meal), trace.ts (TraceWriter)
  transcription/          job.ts (the `transcribe` handler, settleTranscript, nudgeAnalysis), backend.ts
                          (the SttBackend interface), local.ts (LocalWhisperBackend: the services/stt
                          process and its NDJSON protocol), ffmpeg.ts (normalisation), tools.ts (finding
                          ffmpeg)
  tailscale.ts            `tailscale serve --https=<port>` in the foreground
  build-stamp.ts          rebuild packages/web/dist when its sources changed
  auth/identity.ts        requireTailnetIdentity: the Tailscale-User-Login check, dev bypass
  auth/bearer.ts          requireBearer: token auth for machine clients (/mcp)
  http/                   api.ts (mounts), meals.ts, runs.ts, weight.ts, goals.ts, push.ts, share.ts and agent.ts (routes), file-response.ts
                          (media, ranges), middleware.ts (sameOrigin, errors, readJson),
                          origin.ts (originAllowed, publicOrigin), static.ts
  domain/                 errors.ts (HttpError), meals.ts (MealService: captures, retract, analyse,
                          eaten-at, revision history),
                          revisions.ts (RevisionService: save, views, day summary), foods.ts
                          (FoodService: search, barcode, create), goals.ts (GoalService: goals and the
                          day view), share.ts (ShareService: the share target), time.ts (days and local
                          times)
  nutrition/              nutrients.ts (OFF/FDC → core set), totals.ts (the only totals), ranking.ts,
                          off.ts / fdc.ts (clients), http.ts (timeouts, size caps, rate limits,
                          User-Agent), recipe.ts (fetch + schema.org Recipe JSON-LD)
  mcp/                    endpoint.ts (/mcp: auth, stateless transport), tools.ts (the tools,
                          scopes, instructions), tokens.ts (interactive and per-run tokens)
  media/                  store.ts (write-once files), detect.ts (type sniffing), exif.ts,
                          heic.ts (HEIC → JPEG), downscale.ts (JPEG → ≤ 1600 px, upright)
  db/                     index.ts (open, pragmas, migration runner, newId), migrations/*.sql,
                          repos/ (one per aggregate: meals, captures, transcripts, jobs, weight,
                          foods, revisions, runs, goals, profile, push, settings)
  push/                   vapid.ts (the key pair in vapid.json), sender.ts (PushSender: encrypt, sign,
                          deliver, 404/410 cleanup), messages.ts (what a meal's notification says,
                          notifyMeal)
packages/server/test/     bun tests, temp dirs only; fixtures/ holds made-up images and, in
                          nutrition/, recorded OFF/FDC answers and a trimmed recipe page
                          (record.ts re-records them; the gate never hits the network);
                          fake-agent.ts is a scripted ACP agent (tests never start a real harness),
                          fake-stt.ts a scripted STT process and fake-ffmpeg.ts an ffmpeg stand-in
                          (tests never load a speech model); fixtures/memo-de.m4a is synthetic speech
packages/shared/test/     bun tests: goal-calc (the fixture, equations, caps, floors, rounding, defaults)
packages/web/
  index.html              iOS/PWA metas, manifest and icon links, the dark-mode switch
  public/                 manifest.webmanifest, icons/ (rendered by scripts/icons.ts)
  sw.js                   the service worker template (vite.config.ts fills in the build's files)
  test/                   bun tests: the upload queue, the recorder's logic, the trace parser, the weight
                          trend, the clipboard mapping
packages/web/src/
  main.tsx                router + query client, starts the upload queue, registers the worker
  routes/                 TanStack file routes: __root.tsx, index.tsx (the overview),
                          meals.$mealId.tsx (a meal: its detail or its capture view), days.$date.tsx
                          (the day view), goals.tsx (goals and weight), goals_.guided.tsx (the guided
                          setup, /goals/guided), settings.tsx (notifications, the agent, sharing);
                          routeTree.gen.ts
                          is generated
  lib/api.ts, queries.ts  the fetch client and every TanStack Query hook
  lib/outbox/             the upload queue: outbox.ts (Outbox), store.ts (IndexedDB), transport.ts
                          (fetch/XHR), index.ts (the app's queue and its hooks)
  lib/recorder.ts         the recorder's state machine and helpers; hooks/use-recorder.ts wires it
  lib/trace.ts            a run's NDJSON trace → run metadata and a readable list (parseTrace)
  lib/weight.ts           the weight trend: raw points and the 7-day moving average (weightTrend), kgTicks
  lib/sw.ts, ids.ts, format.ts  worker registration and its messages, client UUIDv7s, number/date formatting
  lib/push.ts             this browser's push support, permission and subscription (subscribeDevice)
  lib/clipboard.ts        Paste: clipboard items and paste events → captures (pasteFromClipboard,
                          capturesFromItems, capturesFromPaste), and what was offered
  components/             slab.tsx (the design's primitives), totals-slab (+ TargetBar), meal-row (+ groupByDay),
                          weight-entry, weight-trend, recorder-band, choice (choice rows, chips, the
                          stepper, the slider, the split bar), goal-explanation,
                          add-strip (photo/note/link/audio/paste, the paste sheet), capture-list (+ useCaptureRows),
                          meal-detail (the detail screen), items-list (provenance, confidence,
                          source), revision-history, trace-view, agent-settings (Settings → Agent, the
                          model picker); ui/ (shadcn: button, input, sheet)
  index.css               Tailwind 4 + the D · Slab theme tokens (light/dark)
e2e/                      Playwright specs (phone viewport)
docs/adr/                 architecture decision records
.agents/skills/log-meal/  SKILL.md: how to analyse a meal (the job's system prompt, and a skill for
                          interactive sessions through the `.claude/skills` link)
services/stt/             the speech-to-text process, a uv project (Python 3.12, faster-whisper; ruff,
                          pytest): run.sh (uv from PATH or nixpkgs; `transcribe`, `check`, `smoke`),
                          yamt_stt/ (__main__: one batch; protocol.py; audio.py; backends.py: Whisper,
                          stub), tests/
```

## Hosting

- The server binds `127.0.0.1` only. `yamt start` runs `tailscale serve --https=7444
  http://127.0.0.1:7890` as a child process in the foreground, so the serve entry exists exactly
  as long as yamt runs and no serve config is left behind. HTTPS matters: the microphone, the
  service worker and Web Push need a secure context.
- In dev (`--dev`), Vite serves the SPA on port+1 with HMR and proxies `/api` to the server;
  `tailscale serve` then points at Vite. The proxy keeps the request headers, so auth and the
  same-origin check behave as in production.
- Ports: 7890 (HTTP), 7891 (Vite in dev), 7444 (tailnet HTTPS), 7898 (e2e). Neighbouring
  projects on the host use 7880/7443/7899 and 443/8443.

## Auth

- **Browser (`/api/*`):** `tailscale serve` adds `Tailscale-User-Login` to every request it
  proxies from a user-owned device (tagged devices get none, and it replaces any such header the
  client sent). `requireTailnetIdentity` accepts the request only if that login matches the
  configured one (`YAMT_LOGIN` or `login` in `<data>/config.json`, compared case-insensitively);
  no login configured means everything is refused. `c.get("login")` carries it to the routes.
- Because the identity rides on every request from the user's devices, including ones a foreign
  page triggers, non-GET requests also need a same-origin `Origin` (`http/origin.ts` understands
  `tailscale serve`'s Host / X-Forwarded-Host and the Vite proxy). A write without an Origin, or
  with `null`, is refused: browsers send Origin on every fetch/XHR write, same-origin ones
  included (the app's `no-referrer` policy doesn't change that for CORS-mode requests). Until #26
  a missing Origin passed. No cookies are used.
- **The one exception: `POST /api/share`** (the iOS Shortcut, #26) also accepts a request
  *without* an Origin (`ORIGINLESS_WRITES` in `http/middleware.ts`, that method and exact path
  only). Shortcuts is not a browser and sends none; the request still comes from the user's
  iPhone through `tailscale serve`, so it carries the identity and passes
  `requireTailnetIdentity` unchanged. CSRF stays covered because the attack is a foreign web
  page making the user's browser post, and browsers always send Origin on cross-site POSTs
  (fetch, XHR, forms; `null` where they hide it): a present Origin that isn't ours is refused on
  this route too.
- **Public:** `/api/health` (status, version, applied migrations) and the SPA's static files,
  which are public code and carry no data.
- **Dev bypass:** `--no-auth`, only together with `--local` (no tailnet URL); every request is
  `local`. The e2e server runs this way.
- **Machine clients (`/mcp`):** `requireBearer(verify)` with `Authorization: Bearer <token>`;
  `McpTokens` (`mcp/tokens.ts`) verifies and returns the principal. Requests carrying `Origin`,
  `X-Forwarded-For`/`-Host` or the Tailscale identity header are refused (403) whatever token they
  have: `/mcp` is for processes on this machine calling 127.0.0.1, never for browsers or the
  tailnet. See [MCP server](#mcp-server).
- Trust boundary: any process on the VM can reach the loopback port and set the header itself.
  The VM is single-user, so that is accepted (ADR 0001).

## Data

- `~/.yamt/` (`--data-dir`, `YAMT_DATA_DIR`), created and kept at 0700 together with `media/`
  (raw captures), `runs/` (one dir per analysis run: the harness's cwd and `trace.ndjson`) and
  `models/` (the speech model's Hugging Face cache, downloaded on first use);
  `discovery/` (0700: the scratch cwd harnesses are started in to read their options, #28),
  `mcp-token` (0600) holds the interactive MCP token, `vapid.json` (0600) the Web Push key pair,
  `config.json` the optional `login`, `fdcApiKey`, `analysis` (see [Analysis](#analysis-8)),
  `transcription` (see [Transcription](#transcription-9)) and `push` (see
  [Notifications](#notifications-13)). Nothing personal is ever inside the repo;
  the `.gitignore` blocks `*.db` and data dirs as a second line of defence.
- `yamt.db`: `bun:sqlite`, `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`,
  `busy_timeout=5000`; the file and its -wal/-shm are chmod 0600 on open.
- **Migrations:** `db/migrations/<YYYYMMDDHHmm>_<what>.sql`, applied in name order on open, each
  in its own transaction, tracked by name in `schema_migrations` together with a SHA-256 of the
  file. A failed migration rolls back and stops the start; an applied file whose checksum changed
  stops it too ("add a new migration instead").
- **Repositories:** no ORM. Each aggregate gets `db/repos/<entity>.ts` with the SQL for it,
  taking a `Db` and returning the shared domain types; services and routes never write SQL.
  Ids are UUIDv7 (`newId()`), so they sort by creation time. `db/repos/meals.ts` and
  `captures.ts` are the reference: a `Row` interface, a `toX` mapper to the shared type, a class
  over `Db`; server-only fields (file paths) live on a `…Record` type that `toX` strips. Times are
  epoch milliseconds everywhere (DB and API).

### Data model

Enum-like columns are validated in code (the zod enums in `@yamt/shared`), not with `CHECK`, so a
new value never needs a table rebuild.

- **meals**: `status` `draft` → `queued` → `analysing` → `analysed` | `needs_input` | `failed`,
  with `analysis_error` (why it failed; kept only while `failed`, cleared by any other status);
  `eaten_at` with `eaten_at_source`: `created` (no capture yet: the creation time), `capture` (the
  earliest live capture), `user` (given on create), `agent` (refined by the analysis, #8). Only
  `created`/`capture` follow the captures: adding or retracting one recomputes it from
  `COALESCE(taken_at, captured_at, created_at)` (EXIF beats the client clock beats arrival).
  `current_revision_id` points at the latest revision (null before the first analysis).
- **captures**: the raw material (`audio`, `image`, `text`, `link`, `file`, `correction`,
  `answer`). Media kinds carry `mime_type`, `media_path` (relative to the data dir), `byte_size`,
  `sha256`, `file_name`, and for HEIC/HEIF photos `jpeg_path`/`jpeg_status` (`ok` | `missing`);
  text-like kinds `text`/`url` (an `answer` or `correction` is either: typed, with `text`, or
  spoken, with the recording as its media and a transcript like a voice memo; `isVoice` in
  `@yamt/shared` tells them apart); `captured_at` is client-reported, `taken_at` the photo's EXIF
  time; `question_id` links an answer to a `meal_questions` row. There is no foreign key (that
  would mean rebuilding this immutable table); captures are only inserted, so an insert trigger
  (`captures_question_of_meal`) enforces the same: the question exists and belongs to the meal.
  The service additionally requires a question of the meal's *current* revision.
  **Immutable**: triggers refuse updates of the raw columns, a second retraction and any delete;
  `retracted_at` is the only change (soft retraction). Meals with captures can't be deleted either.
- **transcripts**: one per voice capture (audio, spoken answer or correction) (`capture_id` is the key), created `pending` with it;
  `done` with text, model, language, duration, `segments` (JSON `[{startMs, endMs, text}]`),
  `elapsed_ms` (the transcription's wall time) and `settings` (JSON: the STT settings it ran
  with), or `failed` with an error. Derived, so replaceable: `upsertPending` resets it for a new
  run (`POST /api/captures/:id/transcribe`).
- **jobs**: see the queue below.
- **runs**: one per analysis attempt: `meal_id`, `job_id`, `attempt`, `harness`, `model` (the one
  that answered, as the harness reports it), `requested_model` (what the settings asked for; null:
  the harness's default), `requested_effort` and `effort` (asked for, and the harness's effort option
  when the prompt went out; null without one), `config_note` (#28: what didn't apply as asked, e.g.
  "Effort max isn't offered for haiku, so the harness's default effort ran."), `status` (`running` → `succeeded` | `failed` |
  `cancelled`), `started_at`/`ended_at`, `stop_reason` (ACP), `usage` (JSON: the turn's tokens and
  the last context report with cost), `error`, `revision_id`. The full event stream is the trace
  file. A revision's `run_id` points back.
- **weight_entries**: `measured_at`, `kg`, `note`, `source` (`manual`). User data, not raw
  captures, so they can be deleted.
- **goals** (#12): `effective_from` (a local calendar date, `YYYY-MM-DD` in the phone's zone),
  daily targets `energy_kcal`, `protein_g`, `fat_g`, `carbohydrate_g`, `fiber_g` (each null = no
  target), `note`. The goal in force on a day is the latest with `effective_from` ≤ that day
  (ties: the larger id, i.e. created later); `GoalRepo.inForce` in SQL and `goalInForce` in
  `@yamt/shared` (the web app's) decide alike, tested together. New targets always add a row, so
  every past day keeps the targets it had; only the latest row can be changed in place (a typo
  fix). Goals are never deleted. Dates rather than times because a goal is about calendar days:
  the same reckoning as the overview's day totals.
- **profile** (#24): one row (`id = 1`): `sex`, `birth_year`, `height_cm`, `body_fat_pct`
  (null: not given), `daily_life`, `training` (JSON `{sessionsPerWeek, minutes, type,
  intensity}`), `updated_at`. What the guided setup asks; saved with every guided goal and
  pre-filling the next one. No weight: that comes from `weight_entries`.
- **goals.derivation** (#24): JSON, null for targets set by hand. A guided goal's whole
  calculation: `version` (`ALGORITHM_VERSION`), `inputs` (the profile, the weight used, the start
  date for the age), `choices` (goal, pace, protein preset, fat %), `weight` (kg, `average` of the
  last 7 days or `latest` entry, how many entries) and `result` (every intermediate value, the
  explanation lines, the notes on floors and caps, the targets). So a later retro can say why a
  target was what it was even after the algorithm changes. A typo fix that changes the targets
  drops it (the numbers are no longer what it explains); a note-only fix keeps it.
- **push_subscriptions** (#13): one per device and browser that turned notifications on:
  `endpoint` (unique; the push service's URL for it), the browser's keys `p256dh` and `auth`,
  `events` (JSON toggles `{"analysed": true, "needs_input": true, "failed": true}`; a missing key
  counts as on), `last_sent_at`, `last_error`. Deleted when the push service answers 404/410 or
  the device turns notifications off.
- **settings** (#28): app settings as `key` → JSON `value`, `updated_at`. `agent`: `{harness,
  model, effort}` (null model or effort: not set here). Never secrets: those stay in config.json and
  the env.
- **foods**: the food cache. `source` (`off`, `fdc`, `label`, `custom`) and `source_ref`
  (barcode or FDC id; unique per source, so a refetch updates the row), `name`, `brand`, the core
  set per 100 g as columns (`energy_kcal`, `protein_g`, `fat_g`, `saturated_fat_g`,
  `carbohydrate_g`, `sugars_g`, `fiber_g`, `salt_g`; null where the source has no value), the
  full profile (`nutrients`, JSON `{name: {value, unit}}`), `portions` (JSON `[{label, grams}]`),
  the source payload (`raw`) and `fetched_at`. `foods_fts` (FTS5, `unicode61 remove_diacritics
  2`, keyed by `food_id`, kept by triggers) indexes name and brand.
- **meal_revisions**: one per analysis, numbered per meal: `run_id` (the #8 run; null when an
  interactive session saved it), `title`, `summary`, `eaten_at`, `assumptions` (JSON list),
  `status` (`analysed` | `needs_input`). **meal_items**: `food_id` (null for a pure estimate),
  `description` as captured, `grams`, `provenance` (`weighed`, `label`, `database`, `estimate`),
  `confidence` (`high`, `medium`, `low`), `note`, and the core set per 100 g **copied from the food
  when saved** (or the estimate), so refreshing a food never changes an old revision's totals.
  **meal_questions**: `question`, `why_it_matters`, `impact_kcal`, `answered_by_capture_id` (the
  latest live answer; recomputed when one arrives or is retracted). Revisions, items and
  questions are immutable and never deleted (triggers); only the answer link changes.

### Media

- Originals are stored byte for byte at `media/<yyyy>/<mm>/<capture id>.<ext>` (UTC month of
  arrival), written once: 0600 files in 0700 dirs, via a `.part` file and a rename, never
  replacing an existing file. The database holds the relative path, size and SHA-256 (the ETag).
- The type comes from the first bytes (JPEG, PNG, HEIC/HEIF, MP4/M4A, WebM, Ogg, WAV, MP3, PDF…),
  then the declared type, then the file name: iOS sends Voice Memos `.m4a` under several types,
  Safari's `MediaRecorder` uploads `audio/mp4`. Without an explicit `kind` the upload becomes
  `image`, `audio` or `file` by type.
- Photos get `taken_at` from EXIF `DateTimeOriginal` (+ `OffsetTimeOriginal`; without an offset
  the server's time zone applies), read with `exifr`.
- **HEIC/HEIF**: the original stays authoritative; a JPEG derivative is written next to it
  (`<capture id>.jpg`) with `heic-decode` (libheif compiled to WASM) and `jpeg-js`: pure JS, no
  system library, about 1.5 s for a 12 MP photo on the VM, loaded lazily. If conversion fails the
  capture is still stored, with `jpeg_status = 'missing'`.
- Served by `GET /api/media/:captureId` (original) and `/api/media/:captureId/jpeg`, behind auth:
  single byte ranges (audio seeking in Safari), ETag/304, `immutable` caching, `nosniff`, a
  sandboxing CSP, and anything that is not plainly image/audio/video/PDF as an attachment.
- Uploads are multipart and buffered in memory (single user); the limit is `MAX_UPLOAD_BYTES`
  (200 MB, Bun's `maxRequestBodySize` answers 413 above it).

### Job queue

`jobs` (`db/repos/jobs.ts`) is a small SQLite queue for one in-process worker loop (analyse,
transcribe). Types and payloads: `transcribe {captureId}`, `analyse {mealId}`.

- `enqueue(type, payload, {dedupeKey, runAfter, maxAttempts})` is idempotent per `dedupe_key`
  while a job is `queued` (a partial unique index backs it): one open `analyse:<meal>` per meal,
  one `transcribe:<capture>` per audio capture. A request while the keyed job *runs* queues a new
  one, which is not claimed until the running one ends (it may have missed new captures).
- `claim({types})` takes the oldest due job in an IMMEDIATE transaction → `running`, attempt + 1.
- `complete(id)` → `done`. `fail(id, error, {retryable})` → back to `queued` after 30 s, 2 min,
  8 min … while attempts remain, else `failed` (final: the worker marks the meal/transcript).
  `reschedule(id, runAfter)` → `queued` without spending an attempt (waiting for transcripts, GPU
  host asleep). A requeue that meets a newer queued job with the same key is `cancelled` instead.
- `expedite(key)` makes a queued job that waits for later due now (a finished transcript wakes
  the analysis waiting for it).
- `cancelQueued(key)` (a retracted audio capture cancels its transcription) and
  `releaseInterrupted()`, which the server runs at startup: jobs a previous process left
  `running` count a failed attempt and are queued again.
- Producers: an audio capture enqueues `transcribe` (with its pending transcript, in the same
  transaction); `POST /api/meals/:id/analyse` sets the meal `queued` and enqueues `analyse`. Adding
  captures to an `analysed`/`needs_input` meal does not queue it; the client calls analyse again.
  Both poke the worker (`services.queue.wake`) so it doesn't wait for its next poll.

**The worker loop** (`jobs/worker.ts`, `JobWorker`): one per server process, started by
`createServer({worker: true})` (`yamt start` does, unless `--no-worker`; tests and tools that
only need the API don't, so they never spawn an agent or an STT process). Handlers register by
job type with their own concurrency (`analyse`: 1; `transcribe`: 1 batch, running alongside).
Every poll (1 s, or at once after `wake()`) fills each type's lane with `claim({types: [type]})`;
a batch handler (`runBatch`, `batchSize`) claims up to that many due jobs per slot and returns one
outcome each. The queue already keeps two jobs with the same key (one meal) from running together. A handler
returns `done`, `failed` (`retryable: false` fails at once) or `reschedule` (no attempt spent);
throwing counts as a retryable failure. `settled(job)` then sees the job as it ended up (`done`,
`queued`, `failed`, `cancelled`). `stop()` (server shutdown) aborts the running handlers' signal
and waits for them; the analysis requeues itself without spending an attempt.

## Nutrition layer (#7)

**The model reads, code computes.** The agent picks foods and grams; `computeTotals`
(`nutrition/totals.ts`) is the only place totals come from: per-100 g values × grams, summed per
nutrient for all items and per provenance, rounded once at the end (kcal whole, grams to 0.1,
salt to 0.01). A missing value counts as 0 and is reported in `missing`. Nothing stores totals:
`RevisionService.view` computes them whenever a revision is read (`GET /api/meals/:id`, the MCP
tools), and a day's totals are computed over all items of the day's current revisions.

- **Core set** (`CORE_NUTRIENTS`): energy (kcal), protein, fat, saturated fat, carbohydrate,
  sugars, fiber, salt. Everything else stays in the full profile.
- **Carbohydrate convention (EU):** `carbohydrate` is *available* carbohydrate, excluding fiber,
  as on EU labels (Regulation 1169/2011, "Kohlenhydrate"); fiber is its own value. Every source is
  mapped to it, so totals never mix definitions: USDA's carbohydrate includes fiber (1005 "by
  difference" = 100 − water, protein, fat, ash, alcohol; 1050 "by summation" = sugars + starch +
  fiber), so the mapping subtracts fiber (1079), never below 0; Open Food Facts' `carbohydrates`
  is the EU value and is taken as is, its `carbohydrates-total` (US/Canadian labels since 2025,
  fiber included) is used minus fiber only when `carbohydrates` is missing. Without a fiber value
  the reported total is kept and fiber stays null (totals list it as missing); such foods are
  mostly meat, dairy, oils or drinks with little or none. Known gap: older non-EU OFF entries
  may hold a US total in `carbohydrates`, and nothing marks them. The full profile and `raw`
  keep the source's own numbers. Labels read by the agent (`create_food`) and its estimates
  follow the same convention (the `log-meal` skill and the tool schema say so). Energy is the
  source's kcal, not recomputed.
- **Open Food Facts** (`nutrition/off.ts`): product by barcode (`/api/v2/product/<code>`, a fixed
  `fields` list) and text search via search-a-licious (`search.openfoodfacts.org`, filtered to
  products sold in Germany, German names first), falling back to the classic `/cgi/search.pl`
  (`cc=de`, `lc=de`) when it fails; the classic search is often 503. Mapping: the `*_100g`
  nutriments; energy from kJ when kcal is missing, salt from sodium × 2.5; the serving size
  becomes a portion. User-Agent `yamt/<version> (https://github.com/FreshlyBrewedCode/yamt)`.
- **USDA FoodData Central** (`nutrition/fdc.ts`): search restricted to Foundation, SR Legacy and
  Survey (FNDDS) (generic foods; branded products are OFF's job), details by FDC id (with
  `foodPortions`, e.g. 1 tbsp olive oil = 13.5 g). Key from `FDC_API_KEY` or `fdcApiKey` in
  `config.json`; without one FDC is reported unavailable and never called. Mapping by nutrient id
  with fallbacks for Foundation foods (energy 1008 → Atwater 2048/2047 → kJ; fat 1004 → 1085;
  sugars 2000 → 1063; carbohydrate 1005 → 1050, minus fiber), the older nutrient numbers for
  the abridged format, sodium mg → salt g.
- **Outbound HTTP** (`nutrition/http.ts`): timeouts (8–10 s), size caps, token-bucket rate limits
  below each API's (OFF: 10 searches / 100 products a minute; FDC: 1000 an hour), manual
  redirects, API keys scrubbed from error messages. A failing source makes a search report it as
  `unavailable`, not fail.
- **Caching:** every product or food a lookup or search returns is saved in `foods` (so each
  candidate has a food id). Lookups reuse a row for 30 days (`refresh` forces a fetch; when OFF is
  down the cached row is returned); search hits never overwrite a fresh row (they are thinner than
  details), and a remote search is remembered in memory for an hour. `get_food` completes an FDC
  food seen only in a search with its details once.
- **Search order and ranking** (`FoodService.search`, `nutrition/ranking.ts`): personal history
  (FTS over the foods used in any revision: all words as prefixes, else any word), Open Food
  Facts and FDC are asked in parallel, then ranked by one score: word match (share of query
  words that start a word of the name/brand, +0.1 if all are in the name, up to +0.1 for a short
  name), origin (history +0.4 and +0.05 per meal used in, up to 4; OFF +0.1; FDC 0), the source's
  own order (−0.02 per place), completeness (−0.5 without energy, −0.05 per missing macro). A
  food found in history and remotely is listed once, as history. Each candidate carries its
  origin (`foundIn`), source and source ref.
- **Barcodes:** a `label` food with that barcode wins (it was made because OFF lacked or misread
  it), then the cached OFF product, then OFF.
- **Labels and custom foods:** `create_food` saves `label` (read off a package photo; barcode and
  capture id recorded) or `custom` foods; values per 100 g, energy required.
- **Recipe links** (`nutrition/recipe.ts`): fetched server-side (10 s, 3 MB, public http(s) hosts
  only: loopback, private, CGNAT/tailnet, link-local and `.ts.net`/`.local` targets are refused,
  for every redirect hop too; a public name resolving to a private address is not caught). The
  first schema.org `Recipe` in any JSON-LD block (top level, arrays, `@graph`, `mainEntity`, `@type`
  lists) gives name, ingredients as written, yield and servings, the page's nutrition, steps
  (strings, `HowToStep`, `HowToSection`); without one, the page as plain text (20 000 chars).
- **Revisions** (`RevisionService.save`): validates every item (a food with an energy value, or
  `estimatePer100g` for a pure estimate, which can't claim `database`/`label` provenance), at most
  two questions, a non-empty result; then, in one transaction, inserts the revision, makes it the
  meal's current one and sets the meal's status: `needs_input` with questions, else `analysed`,
  **except** when another `analyse` job for the meal is queued (captures arrived during the run,
  #6): then the meal stays `queued`. An `eatenAt` from the analysis moves the meal's time (source
  `agent`) unless the user pinned it.

## MCP server

`/mcp` (`mcp/endpoint.ts`) is the yamt MCP server: the analysis agent's (#8) and interactive
sessions' only way to read and write yamt data.

- **Transport:** streamable HTTP in its stateless form (`@modelcontextprotocol/sdk`
  `WebStandardStreamableHTTPServerTransport`, no session id, `enableJsonResponse`): each POST
  carries one JSON-RPC message or batch and gets one JSON answer; GET and DELETE answer 405. A
  fresh SDK `Server` is built per request for the caller's principal. The `instructions` describe
  yamt in two lines. Tool inputs are zod schemas (sent as JSON Schema); invalid arguments, unknown
  ids and refusals come back as tool errors (`isError`) the model can act on.
- **Tools** (`mcp/tools.ts`): `get_meal` (live captures with transcripts, link URLs, local media
  paths, answers; `afterCurrentRevision` flags; the current revision with items, questions and
  answers, totals; earlier revisions), `search_foods`, `get_food`, `lookup_barcode`,
  `create_food`, `fetch_recipe`, `save_meal_revision` (returns the computed totals and the meal's
  status), `get_day_summary` (the meals of a date in the server's zone or a given one, with their
  totals and the day's, the goal in force with `progress` per target — eaten, target, left, over
  — and the weight measured that day), `get_goals` (every goal newest first with the last day it
  held, `until`, and whether a same-day goal replaced it; and the one in force on a date). Times
  go out as ISO 8601 with the zone's offset.
- **Tokens** (`mcp/tokens.ts`, `services.mcpTokens`): `yamt_` + 256 random bits, compared as
  SHA-256 hashes.
  - *Interactive:* one long-lived token in `<data>/mcp-token` (0600), created at the first start
    or by `yamt mcp-token`; `--rotate` replaces it (a running server notices the new file). The
    repo's `.mcp.json` points Claude Code at `http://127.0.0.1:${YAMT_PORT:-7890}/mcp` with
    `Bearer ${YAMT_MCP_TOKEN:-}`; the token itself is never in the repo. Full access.
  - *Per run:* `mintRun({runId, mealId, ttlMs})` → a token scoped to one meal, in memory only
    (runs don't outlive the server), revoked by `revokeRun(runId)` and expiring after 2 h
    regardless. A run token sees `get_meal`/`save_meal_revision` for its meal only, the food tools,
    and not `get_day_summary` or `get_goals`; the revision it saves records its `run_id`, and a second
    `save_meal_revision` with the same run token is refused (a run saves exactly one).

## Analysis (#8)

Pressing **Analyse** queues an `analyse` job; the worker runs it as one **analysis run**: an agent
harness driven over ACP through the meal, which reads with the yamt MCP tools and ends with one
saved revision. ADR 0001 (6–8) has the why.

### The `analyse` job (`analysis/job.ts`)

1. **Transcripts first.** If a live audio capture's transcript is still `pending`, the job is
   rescheduled 15 s later without spending an attempt; a transcript that finishes (or fails for
   good) makes it due at once (`nudgeAnalysis`). A `failed` transcript doesn't block: the prompt
   names it and the skill says to note it.
2. **The run.** A `runs` row (`running`), `<data>/runs/<run id>/` (0700; the harness's cwd and its
   trace), meal → `analysing`, and a run token (`mintRun`, scoped to the meal).
3. **The turn** (`runPrompt`, below): the harness, model and effort in force (read per run, see
   [Agent settings](#agent-settings-28)), the skill as the appended
   system prompt, the yamt MCP server at `http://127.0.0.1:<port>/mcp` with the run token, and the
   prompt (meal id, re-analysis note, photos, failed transcripts). The token is revoked afterwards
   whatever happened.
4. **The verdict.** The run succeeded if it saved its revision (`revisions.forRun`); the revision
   already set the meal's status (`analysed`, `needs_input`, or `queued` when another analysis is
   waiting). Otherwise the attempt failed with the reason: the turn ended without
   `save_meal_revision` (with the agent's last words), the harness crashed (exit code and stderr
   tail), a timeout, a spawn or login problem (not retried: they don't fix themselves). The queue
   retries after 30 s and 2 min (3 attempts); the meal is `queued` in between and `failed` with
   `analysis_error` after the last one (unless another analysis is queued). A server stop cancels
   the run (`cancelled`) and requeues the job without spending an attempt; after a crash the next
   start fails the interrupted run and requeues or fails its meal (`settleMeal`).
5. **Retry:** `POST /api/meals/:id/analyse` on a `failed` meal queues a fresh job (fresh attempts)
   and clears the error.

**Configuration**: see [Agent settings](#agent-settings-28): the app's choice between config.json's
`analysis` and the env. The e2e server runs the fake agent as the custom harness, fixed by the env.

**Photos** (`analysis/prompt.ts`, `media/downscale.ts`): each live photo becomes a JPEG of at most
1600 px on the long side, upright (EXIF orientation applied; the copy has no EXIF), from the
original JPEG or a HEIC's JPEG derivative, with `jpeg-js` and an area-averaging resize in plain JS.
The copy is cached next to the original as `<capture id>.1600.jpg` (written once like all media;
originals are never touched); small upright JPEGs are used as they are, other formats (PNG) as
they are up to 4 MB. If `initialize` reports `promptCapabilities.image`, up to 8 go along as ACP
`image` blocks, each after a line with its capture id; otherwise (or beyond 8) the prompt lists
their paths, which the agent may open with its read tool. A HEIC without a derivative is named as
not viewable.

**Permissions** (`analysis/permissions.ts`): decided on the spot, by tool: the yamt tools
(`mcp__yamt__*`) and web fetch/search are allowed; reading a file only for the meal's photo copies
and the run dir; everything else (shell, edits, writes, other files) is rejected. The answer is
the request's option of that kind (`allow_once` before `allow_always`, `reject_once` before
`reject_always`), or `cancelled` if it has none; a request is never left pending. With Claude
Code the allowed tools are pre-allowed anyway (`allowedTools`), so requests are rare.

### The ACP layer (`acp/`)

Ported from vibe-center's `packages/server/src/acp/` and trimmed to job use. It knows nothing
about the database or HTTP.

- `protocol.ts`: the only import of `@agentclientprotocol/sdk` (2.1.0, its `unstable` surface for
  the spec `systemPrompt` and turn `usage`).
- `process.ts` / **`AcpProcess`**: spawns the harness in its own process group, `initialize`s it
  (no client fs or terminal capabilities) and wires `session/update`, permission requests and
  extension notifications. `close()` stops the whole group (`procs.ts`); a harness that exits by
  itself takes its group with it; `raceExit` turns a crash into an error with the stderr tail.
- `run.ts` / **`runPrompt`**: spawn (with the adapter's `prepareProcess` env), `initialize`, one
  fresh `session/new` (no resume), then the model and the effort through
  `session/set_config_option` (model first, each on the options the last call answered with; values
  not offered are skipped and noted, see [Agent settings](#agent-settings-28)), one
  `session/prompt`, close.
  Timeouts: `initialize` 30 s, session setup 60 s, **idle** 3 min without any update (5 min while
  a tool call is open), a **hard cap** of 10 min on the turn. A timeout or an abort sends
  `session/cancel` and kills the group 5 s later if the harness ignores it. Every event
  (`process.start`, `initialize`, `session.new`, `config`, `prompt`, `update`, `permission`,
  `cancel`, `prompt.end`, `notification`, `process.exit`) goes to `onEvent`; the result has status,
  stop reason, error with a failure class, usage, last context report, the model that answered
  (Claude Code reports it on usage updates; its model config option can be stale), the effort it
  ran with and the config notes. A cancel is trusted over the stop reason the harness answers with
  (OpenCode answers `end_turn`).
- `adapters/`: **Claude Code** (`node <claude-agent-acp>/dist/index.js`, 0.100.0; Bun if there is
  no node): skill via the spec `systemPrompt` (`append`), else `_meta.systemPrompt.append`;
  `_meta.claudeCode.options`: `model`, `allowedTools` (`mcp__yamt`, `WebFetch`, `WebSearch`),
  `tools` (built-ins offered: `Read`, `WebFetch`, `WebSearch`), `settingSources: []` (none of the
  user's own settings, hooks, plugins or CLAUDE.md; the `claude` login still applies),
  `promptSuggestions: false`, env `ENABLE_TOOL_SEARCH=false` (else each MCP tool costs an extra
  model call on first use). The model also goes through its `model` config option when listed;
  `_meta` covers ids its list doesn't have (yamt's default `claude-opus-5-5`; the list says `opus`). claude-agent-acp puts MCP servers on the `claude` command line
  (readable in /proc), so the header says `Bearer ${YAMT_MCP_TOKEN}` and the token goes in the
  session env. **Custom**: any ACP agent; spec `systemPrompt` if advertised, else a
  `<system-instructions>` preamble block; model and effort via config options. **OpenCode**
  (`opencode acp`, ported from vibe-center): no ACP system prompt, so the skill goes into
  `<run dir>/opencode-instructions.md`, named in `OPENCODE_CONFIG_CONTENT` (`instructions`), which
  OpenCode merges over the user's config (providers and logins stay). Its default permissions
  allow everything, so the same env carries job rules (last match wins): `*` ask, `yamt_*`,
  webfetch, websearch and todowrite allow, bash, edit, task, skill, lsp, question and doom_loop
  deny; reads ask, and the job's policy answers. Its MCP tools are named `yamt_<tool>`. Quirks:
  it can hang on provider errors (the idle timeout cancels), answers a cancel with `end_turn`,
  and may ignore it (killed after the grace period); every run is a fresh process anyway.

### Agent settings (#28)

Which harness runs yamt's agent work (today the analysis), which model and which reasoning
effort. Settings → Agent sets them; nothing about the options is hard-coded.

- **Discovery** (`acp/discover.ts`, `agent/discovery.ts`): the server starts the harness in
  `<data>/discovery/` (one scratch dir: harnesses keep per-directory state), `initialize`,
  `session/new` without MCP servers (Claude Code with the job's isolated options), selects the
  model if one is asked for (efforts depend on it), reads `configOptions`, stops it. No prompt, so
  no tokens; about 0.5–2 s. A not-logged-in Claude Code (`_auth/status_update` kind `none`) or an
  ACP auth error is `auth`, a missing command `not_installed`. Results are cached per harness and
  model for an hour, one discovery at a time, concurrent asks share one; Refresh drops the
  harness's entries. Failures aren't cached.
- **Options, generically** (`acp/config-options.ts`): the model is the select in category `model`
  (else id `model`); the effort the select in category `thought_level`, else one with id `effort`,
  `thinking`, `reasoning_effort`, `reasoning` or `thought_level`. Found in Nov 2026:

  | | Claude Code (claude-agent-acp 0.100.0) | OpenCode 1.18.31 |
  |---|---|---|
  | model | `model`/`model`: 13 values (`default`, `opus`, `fable`, `sonnet`, `haiku`, dated ids); current value stale (`haiku` while `_meta` says otherwise) | `model`/`model`: ~585, `provider/model` named "Provider/Model", no groups (the app groups by provider); default `opencode/big-pickle` |
  | effort | `effort`/`thought_level`: default, low, medium, high, xhigh, max; kept across a model switch | `effort`/`thought_level`, per model (GLM-5.3 low/high/max/default, Kimi K3 max/default, none for big-pickle); reset to the model's default on a switch |
  | other | `mode` (mode), `ultracode` (model_config) | `mode` (build/plan) |

- **Precedence** (`resolveAgent`), per value: env (`YAMT_ANALYSIS_HARNESS`, `_MODEL`, `_EFFORT`) >
  the app's setting (`settings.agent`) > config.json `analysis` (`harness`, `model`, `effort`) >
  built-in defaults (Claude Code; `claude-opus-5-5` for it; otherwise the harness's own model and
  effort). A model or effort from the app or config.json counts only for the harness it was set
  for (config.json's for its `harness`, default Claude Code); the env's always. `command`/`args`
  (or `YAMT_ANALYSIS_COMMAND`) replace the command line of config.json's harness; the custom
  harness is only offered with one, and the app never edits a command line.
- **Harnesses found here**: Claude Code when its adapter resolves (node or Bun), OpenCode when
  `opencode` is on PATH, custom when configured; the others are listed as not available.
- **API**: `GET /api/agent` (the three values with `source` `env` | `app` | `config` | `default`
  and the env var, plus the harnesses), `GET /api/agent/options?harness&model&refresh=1`
  (discovered models and efforts, flattened with labels; 503 with `hint` `not_installed` | `auth` |
  `error`), `PUT /api/agent` (`{harness, model, effort}`: the harness must be here, the model
  offered, the effort offered for the model that will run; what the env fixes is kept as it was).
- **Applying**: every run reads the settings afresh (a change applies to the next run), sets the
  model, then the effort. A saved value the harness doesn't offer any more is skipped: the
  harness's default runs and the run's `config_note` says so (Claude Code's unlisted models still
  apply through `_meta`). The trace's `run.start` carries model and effort, `config` lines what
  was set.



### The `log-meal` skill

`.agents/skills/log-meal/SKILL.md` is the single description of how to analyse a meal. The job
reads it at the start of every run (frontmatter stripped) and appends it to the harness's system
prompt; interactive Claude Code sessions in the repo find it as a skill (`.claude/skills` links to
`.agents/skills`). It covers reading every capture, re-analysis from the previous revision,
splitting into items, the grounding order (history → barcode/label on photos → Open Food Facts →
USDA → estimate), amounts (weighed > package > household measures > visual), cooked vs raw,
fats and oils as the most-missed macro, provenance/confidence/assumptions, the question rule (at
most two, only for roughly ≥ 100 kcal), title and summary in the captures' language, and exactly
one `save_meal_revision`. Changing the analysis's behaviour means editing this file.

### Traces

Every run appends its events to `<data>/runs/<run id>/trace.ndjson` (0600), one JSON object per
line: `t` (ms since the run started), `at`, `kind` (`run.start` with harness, model and the skill
text and hash, then the ACP events above, `run.end` with the verdict, usage and duration). Lines
are written synchronously, so a crash keeps everything up to it. The run token is redacted
wherever it appears and image data is replaced by its size. `GET /api/runs/:id/trace` serves the
file as `application/x-ndjson` (not cached; it grows while the run runs); the meal detail's trace viewer (#11) renders it.

## Transcription (#9)

Every audio capture gets a German transcript in the background; it unblocks the meal's analysis.
Spike #4 (phase 1) picked the setup ([ADR 0002](adr/0002-speech-to-text-on-the-cpu.md)): **faster-whisper large-v3-turbo, int8, `de`, on this VM's
CPU** (3.2 % WER on FLEURS German, real-time factor ~0.2, ~1.7 GB RAM, ~5 s model load); the GPU
host stays a possible second backend.

**The `transcribe` job** (`transcription/job.ts`, `TranscribeJob`), created with the capture and
its `pending` transcript (#6). Due jobs run as one **batch**, one batch at a time (the analysis
runs alongside):

1. For each job: the capture must exist, be audio and not retracted (else failed at once).
   **ffmpeg** reads the original (never written) and writes a 16 kHz mono 16-bit PCM WAV into a
   fresh temp dir (`normaliseArgs`: first audio stream only, no video, cover art or metadata;
   iOS `audio/mp4` and `.m4a`, WebM, Ogg, MP3, WAV all work). ffmpeg refusing the file fails the
   job at once (a broken file stays broken).
2. The WAVs go to the **STT backend** in one call (`SttBackend`, `transcription/backend.ts`);
   results arrive one by one, and each is written right away: `done` with text, model
   (`faster-whisper large-v3-turbo int8`), language, duration, segments, wall time and the
   settings. Then `nudgeAnalysis` makes a waiting `analyse` job of the meal due and wakes the
   worker. A result for a capture whose re-run is already queued is dropped (the re-run wins).
3. Failures go through the queue: retried after 30 s and 2 min (3 attempts) while the transcript
   stays `pending`; after the last one (or at once when retrying can't help: an unreadable file,
   a missing ffmpeg or STT command) it is `failed` with the error, the analysis is nudged and
   proceeds without it. A server stop kills the STT process group and requeues unfinished jobs
   without spending an attempt; jobs an earlier process left running count an attempt
   (`releaseInterrupted` → `settleTranscript`). The temp dir is removed whatever happens.

**The STT process** (`services/stt`, `transcription/local.ts`, `LocalWhisperBackend`): a short-lived
process per batch rather than a resident server, so the model's ~1.7 GB are only held while there
is work. The server spawns `services/stt/run.sh transcribe` in its own process group, writes the
request to its stdin (`{settings, items: [{id, path}]}`) and reads NDJSON events from stdout:
`model` (cached or downloading), `download` (bytes so far, every 5 s), `loaded`, `progress`,
`result` (per file, ok or an error), `fatal`, `end`. The server logs the download, the load and
each file's timing (`… 71.8 s of audio in 15.4 s (RTF 0.21)`). The process lowers its priority
(nice 10) and is capped at `threads` threads (default 4 of 6 vCPUs) so the VM stays responsive.
It reads the WAV as int16 scaled to float32 (misread samples silently become zeros, and Whisper
then hallucinates "Vielen Dank." on the silence), runs Silero VAD first (drops silence, where
Whisper hallucinates), decodes greedily (beam 1) with `condition_on_previous_text` off and
timestamps on: Whisper moves each 30 s window to the end of the last complete segment, so long
memos need no chunking of ours and lose no words at window boundaries. The server kills it after
10 min without a line (download progress counts). An exit before every file was answered fails
the rest of the batch (retryable; the stderr tail is the error); exit 127 (no uv, no nix) is not
retried.

**Model download:** on first use faster-whisper downloads the model (large-v3-turbo ~1.6 GB) from
Hugging Face into `<data>/models` (`transcription.modelsDir` to share a cache); the log shows the
download's progress, so a first-run delay of several minutes isn't a mystery.

**Tooling** (this VM is NixOS: neither ffmpeg nor uv is on PATH): `run.sh` takes uv from PATH,
else links `nixpkgs#uv` as `services/stt/.uv` (vibe-center's `services/voice` does the same), and
`uv sync --frozen` provides Python 3.12 and the pinned wheels on every start (fast when nothing
changed; the first run says so and takes a minute). ffmpeg comes from `transcription.ffmpeg` /
`YAMT_FFMPEG`, else PATH, else `nixpkgs#ffmpeg-headless` linked as `services/stt/.ffmpeg-bin`
(built on first use when `nix` exists). `yamt start` looks for ffmpeg at startup and warns loudly
if there is none: voice memos then fail to transcribe (and analyses go on without them) rather
than block. CI installs ffmpeg with apt and uv with `setup-uv`.

**Configuration** (`config.ts`, `<data>/config.json` `transcription`, env wins): `model`
(`large-v3-turbo`), `computeType` (`int8`), `threads` (4), `beamSize` (1), `vad` (true),
`language` (`de`), `initialPrompt` (a vocabulary hint, none by default), `ffmpeg`, `modelsDir`,
`command`/`args` (the STT command line); env `YAMT_STT_MODEL`, `YAMT_STT_COMPUTE_TYPE`,
`YAMT_STT_THREADS`, `YAMT_STT_BEAM_SIZE`, `YAMT_STT_VAD` (0/1), `YAMT_STT_LANGUAGE`,
`YAMT_STT_INITIAL_PROMPT`, `YAMT_STT_MODELS_DIR`, `YAMT_STT_COMMAND`, `YAMT_FFMPEG`. Phase 2 of
the spike (real memos) may still tune these; each transcript records what it ran with.

**Re-running** (`POST /api/captures/:id/transcribe`): resets the transcript to `pending` (the old
text goes; the audio is never touched) and queues a `transcribe` job (idempotent while queued; a
request during a run queues one behind it). It doesn't analyse the meal again: a queued analysis
waits for the new transcript, an analysed meal stays as it is until the user presses analyse.

**Another backend** (e.g. the GPU host's OpenAI-style `/v1/audio/transcriptions` through the
`gpu` CLI) implements `SttBackend.transcribe(items, {signal, onResult})` for the same WAVs; it
would chunk to that server's ≤ 15 s inputs and own the wake/sleep lifecycle.

**Measured on this VM** (6 vCPU, 4 threads, large-v3-turbo int8, beam 1, VAD; FLEURS `de_de`
clips as AAC/M4A): 71.8 s in 15.4 s (RTF 0.21) and 203.5 s in 41.5 s (RTF 0.20), plus ~3 s model
load per batch.

## API

All behind the identity check, writes also same-origin; paths in `mealPaths` / `weightPaths`.

- `POST /api/meals` (`{id?, eatenAt?}`), `GET /api/meals?from&to&limit&tz` (by `eatenAt`, newest
  first, with live capture counts per kind, a cover photo, pending transcripts, and the current
  revision's title, totals and open questions; plus `days`: each day's totals over those meals,
  days reckoned in `tz`, the server's zone by default), `GET /api/meals/:id` (meal, every capture
  including retracted ones, transcripts, and the current revision with items, questions, answers
  and computed totals).
- `POST /api/meals/:id/captures`: `multipart/form-data` with `file` (+ `id`, `kind`,
  `capturedAt`, `questionId`) for audio, image and file, and for spoken `answer` / `correction`
  (audio only; the analysis waits for their transcripts like a memo's); JSON for `text`, `link`
  (http/https `url`), `correction`, `answer`. An answer's optional `questionId` must be a question
  of the meal's current revision, else 400 (also on any other kind). A `capturedAt` more than an hour ahead of the server is refused.
- **Client ids:** meals and captures accept an optional `id` (a UUID; the web app sends UUIDv7s).
  A create with an id that exists answers the stored record with 200 instead of storing it again
  (201 the first time; a capture id of another meal is a 409), so the upload queue can retry after
  a lost response without duplicates.
- `POST /api/captures/:id/retract` (idempotent), `POST /api/meals/:id/analyse` (409 without a live
  capture; on a `failed` meal, the retry), `GET /api/media/:captureId[/jpeg]`.
- `POST /api/captures/:id/transcribe`: re-run an audio capture's transcript (400 for other kinds,
  409 when retracted); answers the `pending` transcript and the job id.
- `GET /api/meals/:id` also lists the meal's analysis runs (`runs`, newest first); a revision's
  `runId` names its run. `GET /api/runs/:id` (the run), `GET /api/runs/:id/trace` (NDJSON).
- `GET /api/meals/:id/revisions` (#11): every revision, newest first, each a full view (items,
  questions with answers, totals computed from its own items by `computeTotals`), so the UI can
  show what a correction changed.
- `PATCH /api/meals/:id` `{eatenAt}` (#11): a time pins it (source `user`: captures and analyses
  leave it alone; more than an hour ahead is 400); `null` unpins it, and it follows the captures
  again. A question's `answer` in a revision view is the answer's text, or a spoken answer's
  transcript (null while pending).
- `POST /api/weight` (`{kg, measuredAt?, note?}`), `GET /api/weight?from&to&limit`,
  `DELETE /api/weight/:id`.
- **Goals** (#12, `goalPaths`): `GET /api/goals` (every goal, newest first), `POST /api/goals`
  (`{energyKcal, protein, fat, carbohydrate, fiber, note, effectiveFrom?}`; an omitted target is
  "none", `effectiveFrom` defaults to today in the server's zone, the web app sends the phone's
  today), `GET /api/goals/current?date&tz` (the goal in force; `date` defaults to today in `tz`),
  `PATCH /api/goals/:id` (same body without the date: a typo fix in place, only for the latest
  goal, else 409).
- `GET /api/days/:date?tz` (#12): a calendar day in `tz` (the server's zone by default): its
  meals as `GET /api/meals` lists them, the day's totals (over the current revisions; meals
  without an analysis are counted in `unanalysed`, not in the totals), the goal in force,
  `progress` per target (`dayProgress`: eaten, target, left, over) and the weight entries
  measured that day.

- **Profile and guided goals** (#24, `profilePaths`): `GET /api/profile` (`{profile}`, null before
  the first guided setup), `PUT /api/profile` (`ProfileBody`), `POST /api/goals/guided`
  (`{profile, choices, pregnantOrBreastfeeding?, weightKg?, effectiveFrom?}`): in one transaction
  it logs `weightKg` as a weight entry (measured now) if given, takes the weight from the log
  (`goalWeight`; 400 without any), runs `calculateGoal` itself (the client's numbers are never
  stored), saves the profile and adds a goal from `effectiveFrom` (the phone's today) with its
  `derivation`; 201 with the goal. A refusal is a 422 (`hint`: `under_18`, `pregnancy`,
  `underweight_cut`) and changes nothing.

- **Share** (#26, `sharePaths`): `POST /api/share`, `multipart/form-data` with one or more `file`
  parts and/or `text` / `url` fields, optional `capturedAt` (epoch ms or ISO 8601; more than an
  hour ahead is 400). Adds the items to the current draft meal (see [Sharing and
  paste](#sharing-and-paste-26)): 201 when it started a new draft, 200 when it added to one. JSON
  (`ShareResponse`: meal, `newMeal`, captures, `summary`, the meal's `url` on the request's
  origin) when `Accept` names `application/json`, else the summary as `text/plain` ("Added 1
  voice memo to Untitled meal, 19:10"), refusals as "Not added: …". No Origin needed (see Auth).

- **Agent** (#28, `agentPaths`): `GET /api/agent`, `GET /api/agent/options`, `PUT /api/agent`, see
  [Agent settings](#agent-settings-28).

- **Push** (#13, `pushPaths`): `GET /api/push` (the VAPID public key and every subscription,
  without keys), `POST /api/push/subscriptions` (a `PushSubscription.toJSON()` plus optional
  `events`; https endpoints on public hosts only; the same endpoint again updates its keys and
  keeps its toggles: 201 new, 200 known), `PATCH /api/push/subscriptions/:id` (the toggles),
  `DELETE /api/push/subscriptions/:id`, `POST /api/push/subscriptions/:id/test` (a test
  notification to that one, whatever its toggles: `{delivery: sent | gone | failed, error}`).

## Guided goals (#24)

A guided way to set the daily targets: cut, maintain or bulk from body data and an activity
self-assessment, every number with a one-line explanation, adjusted through presets and
percentages rather than raw kcal and grams. The research behind every number:
[reports/Goal setting research.md](../reports/Goal%20setting%20research.md).

- **One pure, versioned function**, `calculateGoal(inputs, choices)` in `@yamt/shared`
  (`goal-calc.ts`). The web app runs it live while the user taps presets; the server runs it
  again on save and stores its result, so stored targets never come from the client's
  arithmetic. Change a rule or a number → bump `ALGORITHM_VERSION`; old goals keep the
  derivation they were made with.
- **v2, in short:** resting energy by Mifflin-St Jeor (`rmrEquation`), or Cunningham
  (`500 + 22·FFM`) only for the people it was validated on: body fat given and under 25 % (men)
  / 32 % (women) **and** training of at least 2 sessions and 3 hours a week (ten Haaf 2014's
  inclusion criteria for recreational athletes; `LEAN_BODY_FAT`, `CUNNINGHAM_TRAINING`). Always
  one named equation, never a blend; with body fat given the result also carries the other
  equation's value (`rmr.alternative`) and the reason (`rmr.basis`). v1 used Cunningham whenever
  body fat was lean, whatever the training: lean-mass resting energy times a PAL calibrated on
  population equations overshot for people who train little. The rest is as in v1: × a
  daily-life PAL (1.40 / 1.50 / 1.65 / 1.85, exercise excluded); plus training at 75 % of
  `sessions × hours × (MET − 1) × RMR/24` per week, per day; maintenance rounded to 10, capped at 2.4 × resting. The pace in % body
  weight per week (cut 0.25 / 0.5 / 0.75, bulk 0.1 / 0.25 / 0.4) at 7,700 kcal/kg, a cut's
  deficit at most 25 % of maintenance and 1,000 kcal, a bulk's surplus at most 15 %; never under
  1,200 / 1,500 kcal, a cut never under resting. Protein in g per kg of a reference weight
  (the weight at BMI 25 above it): 1.2 / 1.6 / 2.0 / 2.4, capped at 35 % of energy. Fat as 20–40
  % of energy, never under 0.6 g/kg. Fibre `max(30, 14 g per 1,000 kcal)`. Carbs the rest at EU
  factors (carbs exclude fibre, which counts 2 kcal/g), so 4P + 9F + 4C + 2·fibre matches the
  kcal within ±10 after rounding to 5 g. Defaults: protein by training, goal and age, the
  standard pace, fat 30 %.
- **Transparent by construction:** every explanation line names its formula or source
  (equation and year with its inputs and why it was chosen, PAL with FAO/WHO and DGE, MET from
  the 2024 Compendium and the 75 % discount, 7,700 kcal/kg, the protein tier's reference, DGE
  for fat and fibre, carbs as the remainder). `goalMethod(version)` lists each formula with its
  short citation for the "How this is calculated" disclosure, by version, so a v1 goal still
  explains v1's rule; `METHOD_FOOTER` says it's a starting estimate the weight trend corrects,
  and `GOAL_RESEARCH_URL` links the research report. Stored v1 derivations stay as they were
  (their lines and numbers; `rmr.basis` and `rmr.alternative` are absent).
- **The weight** comes from the log (`goalWeight`): the mean of the last 7 days with at least 4
  entries, else the newest entry. A weight typed in the flow is logged as an entry on save and
  then counts like any other.
- **Light safety:** no targets under 18 or during pregnancy and breastfeeding, no cut at a BMI
  under 18.5 (`refusalFor`, `REFUSALS`: neutral wording); floors and caps are named in notes.
- Simple first: no MCP tool, no nudge to recalculate, no adaptive expenditure (that is the
  later retro's job; the report's section 6 is its start).

## Sharing and paste (#26)

On iOS a home-screen app can't be a share-sheet target, so screenshots, Voice Memos recordings
and links from other apps come in two ways, both straight into a meal (no inbox):

- **Paste** on a meal's capture screen (the add strip's fifth target): `navigator.clipboard.read()`
  first thing in the tap (iOS allows it only from a gesture and shows its "Paste" callout),
  `lib/clipboard.ts` maps each clipboard item to at most one capture, the richest it offers: an
  image, else audio (MIME types, Apple type identifiers like `com.apple.m4a-audio`, a file's name
  or first bytes), else a link (`text/uri-list`, or plain text that is one http(s) URL alone),
  else a note (plain text, else HTML's text). The captures go through the upload queue like all
  others. When `read()` is missing, refused or finds nothing usable, a sheet from the top offers a
  target to touch and hold (a `contenteditable`: iOS offers Paste on editable things, and only
  rich editing takes files); its `paste` event's `clipboardData` (files first, strings only
  without a usable file) can carry types the API doesn't. Nothing usable says so and lists every
  type the clipboard offered, so what Safari exposes for a copied voice memo shows on the device.
- **The share target**: an iOS Shortcut ("Send to yamt", built once from the guide in Settings)
  posts what it receives to `POST /api/share`. `ShareService` (`domain/share.ts`) picks the
  **current draft meal**: the most recently updated meal in `draft` whose `updated_at` is within
  `SHARE_DRAFT_WINDOW_MS` (3 h; `MealRepo.latestDraftSince`), else a new draft. The new draft is
  not pinned: its `eatenAt` follows its captures (a photo's EXIF time, `capturedAt`, arrival),
  so it lands at the items' time. Every item is checked first (sizes as for uploads, the clock,
  something usable at all), so a refused share changes nothing; then each becomes an ordinary
  capture through `MealService.addUpload` / `addJson` (sniffing, HEIC → JPEG, EXIF, a pending
  transcript and `transcribe` job for audio). Nothing is analysed: the user opens the meal and
  presses Analyse. A Shortcut turns some shared things into small files: a text-like `file`
  (≤ 64 KB: `text/*`, `.txt`, `.url`, `.webloc`, untyped UTF-8) becomes a link (one URL alone, a
  web shortcut's URL, a page's canonical or `og:url`) or a note; anything else stays a file. The
  Shortcut shows the plain-text answer in a notification (opening a URL from a Shortcut would land
  in Safari, not the home-screen app).

## Notifications (#13)

Web Push to the home-screen app: the phone hears when an analysis is done, needs input or
failed, and a tap opens the meal.

- **Keys:** a VAPID key pair (P-256) is made at the first start and kept in `<data>/vapid.json`
  (0600); every subscription is bound to its public key, so it never changes on its own (a broken
  file stops the start instead of being replaced). The JWT's subject is `push.subject` in
  `config.json` or `YAMT_PUSH_SUBJECT` (`mailto:` or `https:`), by default the project URL, so no
  personal address is needed.
- **Sending** (`push/sender.ts`, `PushSender`): `web-push` 3.6.7 (works under Bun) encrypts the
  payload for the subscription (RFC 8291, `aes128gcm`) and signs the VAPID JWT (RFC 8292); the
  request goes out through an injectable `fetch` (a recording fake in tests, which decrypt the
  body themselves per the RFCs). TTL 12 h, urgency high for meal events, `Topic` = the meal id,
  so a newer message about a meal replaces one the phone hasn't fetched yet. 2xx records
  `last_sent_at`; **404/410 delete the subscription**; anything else (or a network error) is kept
  with `last_error`. The log names the push service's host and the status, never the payload or
  the endpoint's path.
- **When:** `AnalysisJob.settled` calls `notifyMeal` once the job is `done` or `failed` for good
  (not on a retry or a wait). It notifies only if the meal ended `analysed`, `needs_input` or
  `failed`: a meal left `queued` because another analysis of it is waiting sends nothing, so
  only the final state of the latest run is notified. The message is built from the meal at that
  moment and sent to every subscription whose toggle for the event is on. An analysis that failed
  for good while no server ran (`releaseInterrupted` at the start) is notified too. Interactive
  sessions saving a revision over MCP don't notify.
- **What it says** (`push/messages.ts`; personal data only inside the encrypted payload):
  analysed "<title> · <kcal> kcal" with "Protein · Fat · Carbs" (from the revision view, i.e.
  `computeTotals`); needs input "<title> · needs input" with the first question ("(+1 more)");
  failed "<title> · failed" (or "Meal at HH:MM" in the server's zone without a revision) with the
  error's first clause and "Tap to retry.". The payload (`PushPayload`) carries `url`
  (`/meals/<id>`, `#questions` for needs input) and `tag` (`meal-<id>`: one notification per meal).
- **Service worker** (`sw.js`): `push` always shows a notification (iOS revokes subscriptions
  that receive pushes silently) with the tag (`renotify`), and tells open windows to refresh;
  `notificationclick` focuses an open window of the app and posts it the URL, which the router
  follows (`onWorkerMessage` in `main.tsx`), or opens a new window. The meal detail scrolls to
  `#questions`. In dev, Vite serves the same worker without a file list: no shell cache, push
  only, so push works with `--dev` too.
- **The phone** (`routes/settings.tsx`, `lib/push.ts`): iOS has push only in the home-screen app
  (16.4+), and asks for permission only from a gesture. The settings screen shows this device's
  state: **on** (its subscription is registered: a toggle per event, stored per subscription on
  the server, "Send test notification", "Turn off on this device"), **off** ("Turn on
  notifications": `Notification.requestPermission()` first thing in the tap, then a fresh
  `pushManager.subscribe` with the server's key, registered with the server), **blocked**
  (permission denied: where to allow it), **not installed** (Safari in a tab, `navigator.standalone`
  false and no `PushManager`: the Add to Home Screen steps) or **not available**. A browser
  subscription the server doesn't know (expired, removed) shows as off; turning on replaces it.

## Request flow

1. The iPhone opens `https://<host>.<tailnet>.ts.net:7444/`; `tailscale serve` terminates TLS
   and proxies to `127.0.0.1:7890` with the identity headers.
2. `server.ts` routes `/api/*` and `/mcp` to the Hono app and everything else to the static
   handler (files from `packages/web/dist`, falling back to `index.html` for client routes).
   `/mcp` itself is reached from this machine only (see [MCP server](#mcp-server)).
3. In the API: `/api/health` answers directly; any other path goes through `sameOrigin` (writes:
   our Origin; `POST /api/share` also none) and `requireTailnetIdentity`, then its route (unknown paths: 404 after auth). Errors become
   `{ error, hint? }` JSON (`HttpError`, zod errors → 400).
4. The web app reads server state only through TanStack Query hooks in `lib/queries.ts`.

## Web

- Vite 8, React 19, TanStack Router (file routes, code-split) and Query, Tailwind 4.
- shadcn/ui (`components.json`, new-york style, lucide icons, `cn` from the `cn` package): add
  components with `bunx shadcn@4.23.0 add <name>`. Theme tokens live in `src/index.css`:
  shadcn's semantic names (`background`, `card`, `primary`, `muted`, `destructive`, radii,
  all square) plus the design's bands (see [Design](#design)) for light (`:root`) and dark
  (`.dark`). `index.html` sets `.dark` from `prefers-color-scheme` before first paint and follows
  changes.
- Mobile first: `viewport-fit=cover`, a single column capped at `max-w-md`; the top and side
  safe areas pad `#root`, the bottom one belongs to each screen's bottom slab (its fill runs to the
  edge). The e2e runs at 390×844 with touch.

### Design

Direction D · Slab from spike #5, written down in [design/design.md](design/design.md): screens
are stacks of edge-to-edge filled bands (ink for the one thing on a screen, lime for whatever
wants the user, tint for secondary content, plain lists; orange only for failure), Space Grotesk
(self-hosted, `@fontsource-variable/space-grotesk`), tabular numbers, uppercase micro-labels,
square corners. The tokens are in `index.css` (shadcn's names mapped onto the palette, plus
`ink`, `lime`, `lime-soft`, `tint`, `orange` and their foregrounds); the primitives (`Band`,
`Strip`, `Label`, `SlabButton`, `BottomSlab`, `StatusLabel`) in `components/slab.tsx`.

### Screens (#10, #11, #12, #13, #24)

- **Overview** (`/`): today's totals as the ink slab against the goal in force today (kcal,
  protein, fat, carbs, fibre with what's left; "N meals not counted yet" for those without an
  analysis); a tap opens today's day view. Then the last 14 days by day (a tint strip with the
  day's kcal from `days` against that day's own goal, "2,505 / 2,400 kcal", opening the day), each
  meal a row with time, status, title ("Untitled meal" until analysed), what it holds and its
  kcal ("— not counted" without an analysis); needs input is a lime row, failed an orange one.
  Meals that exist only on this phone so far (started offline) are listed from the upload queue;
  drafts with nothing captured are left out. "Earlier days" opens the day before the 14, from
  where the day view steps back as far as needed. The header's scale opens goals and weight.
  **Log meal** is the sticky lime slab. Goals come from `GET /api/goals` (`useGoals`), resolved
  per day with `goalInForce`.
- **Day view** (`/days/:date`, `useDay` → `GET /api/days/:date?tz=<the phone's zone>`): the
  totals slab with the day's goal and per-target "left" / "over", the meals not counted yet, a
  goal row (since when, its note; to the goals screen), the meals (the server's plus the upload
  queue's for that day), the weight entries of the day; the bottom slab steps to the previous and
  next day (replacing the history entry; not past today). Its query key sits under `meals`, so
  everything that refreshes the meals refreshes it, and it polls while a meal is in motion. A
  malformed date redirects to today.
- **Goals** (`/goals`): the weight entry (lime: kg with a dot or comma, now or a chosen time, Undo
  right after), the trend (`lib/weight.ts`: per calendar day the mean of its entries, the 7-day
  moving average over the days with entries; six weeks shown, a week more fetched so the average
  is whole from the start; a small SVG, no chart library), the weight entries of the window with
  delete (inline confirm), the daily targets (blank = no target) and the goal history (each
  goal's period, "replaced the same day", the one in force). Changing a target brings the bottom
  slab: **Save · from today** (a new goal from the phone's today) or, with the toggle "Fix a typo
  in the current goal", **Fix current goal** (PATCH in place). Above the targets the guided row
  (#24): lime **Guided setup** while no goal is in force, a tint **Guided setup** /
  **Recalculate** (with a saved profile) after; a guided goal in force gets a "Why these targets"
  disclosure with its stored explanation, and guided goals in the history read "Guided · cut,
  standard pace" and open theirs.
- **Guided setup** (#24, `/goals/guided`, from the goals screen's guided row): five steps, one
  question block each, the header saying "Guided setup · n / 5" with a five-part progress bar;
  the header's back goes a step back (answers stay), on the first step it leaves. 1 **You**:
  sex, birth year, height, optional body fat, the weight (the log's figure as placeholder, or a
  new one typed), "pregnant or breastfeeding" for women; refusals replace the bottom slab with a
  band saying why. 2 **Daily life**: four choice rows with examples. 3 **Training**: a stepper for
  sessions per week (0 skips the rest), type, typical length, intensity. 4 **Goal**: cut /
  maintain / bulk, then the paces with what they mean ("≈ 0.4 kg a week, −440 kcal a day"). 5
  **Your targets**: the kcal in the ink slab with maintenance, the change and the macro split
  bar; the explanation lines per section with the pace, protein and fat presets and a fat
  slider, all live; notes on floors and caps; a closed "How this is calculated" disclosure
  (`GoalMethod`, also under a goal's "Why these targets"); **Save · from today** posts the inputs and choices
  (not the numbers) and goes back. The profile (`useProfile`) and the guided goal in force
  pre-fill the next run ("Recalculate").
- Back buttons (`BackButton`) go back in the app's history, or to the overview when the screen
  was opened directly, so a meal opened from a day view returns there.
- **Meal** (`/meals/:id`): one route per meal. A meal with an analysis, or a failed one, opens
  on its **detail** (below); one without (draft, queued or analysing for the first time) on the
  **capture view**, and so does `?add=1`, the detail's "Add to this meal". The route owns the
  meal query and hands it down (a second observer would refetch an errored query on mount).
- **Capture view** (`?new=1` from Log meal): Log meal makes a UUIDv7 on the phone and opens it;
  the server learns of the meal with its first capture, so an abandoned "Log meal" leaves nothing
  behind. Header (time, status, title; back goes to the detail when adding), the recorder (the
  ink slab here), the add strip (Photo: `accept="image/*" multiple`, iOS offers camera or library;
  Audio: `accept="audio/*"` for Voice Memos via Files; Note and Link: sheets; Paste, #26: the
  clipboard, or the paste sheet, see [Sharing and paste](#sharing-and-paste-26)), the capture list
  (thumbnail or playback, transcript snippet, upload state, retract with an inline confirm), and
  the bottom slab: Analyse / Analyse queued / Analysing… / Retry analysis / Re-analyse (only with
  something new since the current revision). Analysing returns to the overview (to the detail
  when adding).
- **Meal detail** (#11, `components/meal-detail.tsx`), top to bottom: the header (back, status
  chip, the eaten-at time, which opens an editor that PATCHes it, title, summary); a failed
  analysis's error (orange); the numbers as the ink slab ("preliminary" with open questions,
  "updating" while re-analysing; on the right the share of kcal that are estimates); the agent's
  questions in lime, each with why it matters and its kcal impact, a text field, **Speak answer**
  (recorded in place with the one recorder of the screen and queued at once as a spoken `answer`
  capture with its `questionId`) and **Skip** (sent as an explicit "No answer: keep your best
  estimate." answer, so the next analysis stops asking); the items (description, grams, kcal, a
  provenance marker, a three-step confidence meter; low confidence lime-soft with the agent's
  note; a tap shows the matched food, its source with a link for OFF/FDC, per-100 g values and
  the item's share); the assumptions (tint); a free correction (typed, or spoken like an answer);
  then collapsed rows: captures (with retract, playback, re-transcribe of a failed transcript, and
  the way to the capture view), revisions (`GET …/revisions` when opened: kcal and the change per
  revision, what arrived before it, each opening to its items, assumptions, questions with answers
  and the trace of its run) and the trace of the current revision's run (or the latest run). The
  bottom slab is the one action: **Answer & re-analyse** / **Correct & re-analyse** /
  **Re-analyse** / **Retry analysis** (lime) once there is something for the next analysis
  (typed answers and the correction are sent through the upload queue first, then the analyse
  entry), disabled with a hint while questions are open, **Add to this meal** (tint) otherwise.
  The screen stays put while it re-analyses and polls like the overview.
- **Trace viewer** (`components/trace-view.tsx`, `lib/trace.ts`): fetched only when its row is
  opened (polled while the run runs). The run's facts (the model that answered and, when it
  differs, the one asked for, the effort, harness, start and attempt, how long, outcome, stop
  reason, tokens, cost when the harness reports it; the run's config note under them), then the trace as a list:
  tool calls (name without `mcp__yamt__`, a one-line input summary per known tool, a result
  summary, the duration from the call to its completed/failed update; a tap shows the full input
  and output), the agent's messages and thoughts (chunks joined, clamped until tapped),
  permission decisions, notes (a config option the harness lacks, the harness being stopped) and
  errors (orange: a failed run, a crashed harness).
- **Settings** (`/settings`, the cog in the overview's header): notifications for this device
  (see [Notifications](#notifications-13)), then "Share from other apps" (#26): what the Shortcut
  does, its URL (`location.origin` + `/api/share`) with a copy button, the five steps to build it
  in the Shortcuts app, and the paste route. In between, **Agent** (#28,
  `components/agent-settings.tsx`): the harness as choice rows (the running agent's name and
  version on the chosen one), the model as one row opening a top sheet of the harness's models by
  label (grouped by provider, a search field above 15), the effort as preset chips of the
  discovered values, each heading with where its value comes from ("Set here", "From
  config.json", "Default", "Fixed by YAMT_ANALYSIS_…"; fixed controls are greyed out), Refresh
  ("Read 4 min ago"), loading and failure (orange, with how to fix it) states. A harness switch
  clears model and effort; a model switch keeps the effort only if the new model offers it.
- **Live status:** the overview polls `GET /api/meals` every 3 s while a meal is
  queued, analysing or has a pending transcript, the meal screen polls its meal likewise. A push
  arriving while the app is open refreshes the meals at once.

### Recording

`hooks/use-recorder.ts` over the DOM-free `lib/recorder.ts` (state machine idle → requesting →
recording → stopping → idle | error): `getUserMedia` + `MediaRecorder` with the first supported
of `audio/mp4` (iOS Safari, AAC like Voice Memos), `audio/webm;codecs=opus`, `audio/webm`,
`audio/ogg;codecs=opus`, 1 s timeslices; a level meter from a Web Audio `AnalyserNode` (RMS of
the time-domain frame, every 120 ms, 22 bars); a screen wake lock while recording where the
browser has `navigator.wakeLock`. iOS stops a home-screen app's recording when the screen locks
or the app goes to the background, so the screen says so, and the recorder stops itself on
`visibilitychange`/`pagehide` and keeps what it has. The recording becomes an audio capture
(`voice-memo-<date>-<time>.m4a|webm`, `capturedAt` = the start) through the upload queue.

### The upload queue (`lib/outbox`)

**Uploads never lose data.** Every capture goes through one queue (`Outbox`), never straight to
the API:

1. `addCapture` writes the entry (the blob as it is, file name, type, kind, the client's
   `capturedAt`, a UUIDv7 that becomes the capture's id) to IndexedDB (`yamt` / `outbox`) and only
   then returns; files over `MAX_UPLOAD_BYTES` or empty ones are refused right there with a message
   (Bun would answer 413 with an empty body).
2. One sender works through the entries oldest first: it creates the meal (`POST /api/meals {id}`,
   idempotent, once per meal and session), then sends the capture (JSON with fetch, uploads with
   XHR for progress) with its id, so a retry after a lost response is answered with the stored
   capture. Before the entry is deleted the meal's queries are refreshed, so the row never blinks.
3. A network failure or a 5xx/408/429 retries with backoff (2 s, 4 s … 60 s); `online`,
   `offline` and the app becoming visible wake the queue at once. While `navigator.onLine` is
   false nothing is attempted. Any other refusal (4xx: a broken file, a skewed clock) marks the
   entry refused with the server's reason; the row turns orange with Retry and Discard.
4. **Analyse** is an entry too (`requestAnalyse`): it waits until every capture of its meal has
   left the queue, so pressing Analyse while uploads run, or offline, is fine; a refused upload
   holds it until the user retries or discards it.
5. The queue starts with the app (`startOutbox` in `main.tsx`) and sends what an earlier visit
   left. Without IndexedDB (rare) it falls back to memory and says so in the console.

The screens merge the queue's entries (`useMealOutbox`) with the server's captures by id.

### PWA

- `public/manifest.webmanifest`: `display: standalone`, portrait, start URL and scope `/`, page
  colour as theme and background colour, icons 192/512 (`any`) and 512 `maskable`;
  `apple-touch-icon` 180 px. The icons (a black "y" in Space Grotesk on lime) are rendered by
  `bun packages/web/scripts/icons.ts` with Chromium and committed.
- `index.html`: `apple-mobile-web-app-capable`, status bar style `default`, `theme-color` per
  colour scheme (the page colours), `viewport-fit=cover`.
- **Service worker** (`/sw.js`, built from `packages/web/sw.js` by the `serviceWorker` plugin in
  `vite.config.ts`, which inserts the build's file list and a version hash; production builds
  only): precaches the shell (`/`, hashed assets, icons, manifest), answers navigations network
  first (4 s) with the cached shell as the fallback, other shell files cache first; it never
  handles `/api` or `/mcp`. It takes over at once (`skipWaiting`, `clients.claim`) and drops older
  shell caches; a page that then misses an old lazy chunk gets a 404 (the static handler no longer
  answers a missing `/assets/*` with `index.html`) and reloads itself (`vite:preloadError`).
  `lib/sw.ts` registers it (dev too, see below) and exports `serviceWorkerReady` (the active
  registration) and `onWorkerMessage`; the worker's `push` and `notificationclick` handlers are
  described under [Notifications](#notifications-13).

## Planned (epic #2)

Meals, captures, media storage, the job queue and weight entries (#6), the nutrition layer
with the MCP server (#7), the ACP runtime with the analysis job and worker loop (#8), and the
transcription worker (#9), the PWA with meal capture (#10), the meal detail with questions and
corrections (#11), the day view with goals and weight (#12) and Web Push notifications (#13)
are in: wave 1 is complete. On top of it, the guided goal setup (#24), paste with the iOS
Shortcut share target (#26) and the agent settings (#28). Spike #4 (speech-to-text) decided ADR 0002; spike #5's chosen design is
[design/design.md](design/design.md). See the epic for the decisions each one builds on.
