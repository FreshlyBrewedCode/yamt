# yamt: architecture

What exists today (the scaffold, #3, the meal backend, #6, the nutrition layer with the yamt
MCP server, #7, the analysis job over ACP, #8, the transcription worker, #9, the PWA with
meal capture, #10, the meal detail with questions and corrections, #11, and the day view with
goals and weight, #12), how it fits
together, and where wave 1 goes next. Why it is built this way:
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
  │                           zod-validated bodies; meals, captures, media, weight, goals, days
  ├─ MCP server      /mcp     bearer tokens (agent runs, interactive Claude Code sessions),
  │                           loopback callers only; the agent's only way to read and write
  ├─ SPA             /*       packages/web/dist   (dev: Vite on 7891 proxies /api); the PWA:
  │                           manifest, icons, /sw.js (app shell only)
  ├─ job worker      drains the `jobs` table: `analyse` (one at a time), `transcribe` (one batch
  │    │             at a time, alongside)
  │    ├─ analysis run: one harness process per run, ACP over stdio, cwd ~/.yamt/runs/<run>/
  │    │    claude-agent-acp (node) → `claude` │ custom ACP command
  │    │    └─ MCP over HTTP back to 127.0.0.1:7890/mcp with a per-run token
  │    └─ transcription batch: ffmpeg per memo → 16 kHz WAV in a temp dir, then one
  │         services/stt process (uv, Python, faster-whisper on the CPU) for the batch
  └─ SQLite          ~/.yamt/yamt.db   (WAL, foreign keys, 0600)
     data dir        ~/.yamt/  (0700): yamt.db, media/, runs/, models/, config.json, mcp-token
        │
        └─ outbound: Open Food Facts, USDA FoodData Central, recipe pages (timeouts, size caps,
                     rate limits; results cached in `foods`); the model API, via the harness
```

## Layout

```
packages/shared/src/      contracts shared by server and web (no runtime deps but zod)
  api.ts                  API paths, request schemas, response types (health, me)
  api-meals.ts            meals, captures, transcripts, media: `mealPaths`, enums, bodies, types
  api-weight.ts           weight entries: `weightPaths`, body, types
  api-goals.ts            goals and days: `goalPaths`, bodies, `DayResponse`, `goalInForce`, `goalPeriods`,
                          `dayProgress`, `addDays` (shared by server and web)
  api-nutrition.ts        foods, revisions, items, questions, totals: enums and types
  api-runs.ts             analysis runs and trace lines: `runPaths`, `AnalysisRun`, `TraceEntry`
packages/server/src/
  cli.ts                  `yamt start` (flags: --data-dir --port --https-port --local --no-auth --dev --no-build
                          --no-worker), `yamt mcp-token [--rotate]`
  server.ts               composition root: data dir, DB, services, API, static, the job worker
  services.ts             createServices: repositories + domain services, what HTTP talks to
  config.ts               data dir resolution and setup, config.json (login, FDC key, analysis), ports
  procs.ts                stopGroup: SIGTERM, then SIGKILL, to a whole process group
  acp/                    the ACP layer (no DB, no HTTP): protocol.ts (the SDK entrypoint), process.ts
                          (AcpProcess), run.ts (runPrompt: one session, one turn), mcp.ts, adapters/
                          (claude-code, custom)
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
  http/                   api.ts (mounts), meals.ts, runs.ts, weight.ts and goals.ts (routes), file-response.ts
                          (media, ranges), middleware.ts (sameOrigin, errors, readJson),
                          origin.ts, static.ts
  domain/                 errors.ts (HttpError), meals.ts (MealService: captures, retract, analyse,
                          eaten-at, revision history),
                          revisions.ts (RevisionService: save, views, day summary), foods.ts
                          (FoodService: search, barcode, create), goals.ts (GoalService: goals and the
                          day view), time.ts (days and local times)
  nutrition/              nutrients.ts (OFF/FDC → core set), totals.ts (the only totals), ranking.ts,
                          off.ts / fdc.ts (clients), http.ts (timeouts, size caps, rate limits,
                          User-Agent), recipe.ts (fetch + schema.org Recipe JSON-LD)
  mcp/                    endpoint.ts (/mcp: auth, stateless transport), tools.ts (the tools,
                          scopes, instructions), tokens.ts (interactive and per-run tokens)
  media/                  store.ts (write-once files), detect.ts (type sniffing), exif.ts,
                          heic.ts (HEIC → JPEG), downscale.ts (JPEG → ≤ 1600 px, upright)
  db/                     index.ts (open, pragmas, migration runner, newId), migrations/*.sql,
                          repos/ (one per aggregate: meals, captures, transcripts, jobs, weight,
                          foods, revisions, runs, goals)
packages/server/test/     bun tests, temp dirs only; fixtures/ holds made-up images and, in
                          nutrition/, recorded OFF/FDC answers and a trimmed recipe page
                          (record.ts re-records them; the gate never hits the network);
                          fake-agent.ts is a scripted ACP agent (tests never start a real harness),
                          fake-stt.ts a scripted STT process and fake-ffmpeg.ts an ffmpeg stand-in
                          (tests never load a speech model); fixtures/memo-de.m4a is synthetic speech
packages/web/
  index.html              iOS/PWA metas, manifest and icon links, the dark-mode switch
  public/                 manifest.webmanifest, icons/ (rendered by scripts/icons.ts)
  sw.js                   the service worker template (vite.config.ts fills in the build's files)
  test/                   bun tests: the upload queue, the recorder's logic, the trace parser, the weight
                          trend
packages/web/src/
  main.tsx                router + query client, starts the upload queue, registers the worker
  routes/                 TanStack file routes: __root.tsx, index.tsx (the overview),
                          meals.$mealId.tsx (a meal: its detail or its capture view), days.$date.tsx
                          (the day view), goals.tsx (goals and weight); routeTree.gen.ts
                          is generated
  lib/api.ts, queries.ts  the fetch client and every TanStack Query hook
  lib/outbox/             the upload queue: outbox.ts (Outbox), store.ts (IndexedDB), transport.ts
                          (fetch/XHR), index.ts (the app's queue and its hooks)
  lib/recorder.ts         the recorder's state machine and helpers; hooks/use-recorder.ts wires it
  lib/trace.ts            a run's NDJSON trace → run metadata and a readable list (parseTrace)
  lib/weight.ts           the weight trend: raw points and the 7-day moving average (weightTrend), kgTicks
  lib/sw.ts, ids.ts, format.ts  worker registration, client UUIDv7s, number/date formatting
  components/             slab.tsx (the design's primitives), totals-slab (+ TargetBar), meal-row (+ groupByDay),
                          weight-entry, weight-trend, recorder-band,
                          add-strip (photo/note/link/audio), capture-list (+ useCaptureRows),
                          meal-detail (the detail screen), items-list (provenance, confidence,
                          source), revision-history, trace-view; ui/ (shadcn: button, input, sheet)
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
  `tailscale serve`'s Host / X-Forwarded-Host and the Vite proxy). No cookies are used.
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
  `mcp-token` (0600) holds the interactive MCP token, `config.json` the optional `login`,
  `fdcApiKey`, `analysis` (see [Analysis](#analysis-8)) and `transcription` (see
  [Transcription](#transcription-9)). Nothing personal is ever inside the repo;
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
  that answered, as the harness reports it), `status` (`running` → `succeeded` | `failed` |
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
3. **The turn** (`runPrompt`, below): the configured harness and model, the skill as the appended
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

**Configuration** (`config.ts`, `<data>/config.json`, env wins): `analysis.harness`
(`claude-code`, the default, or `custom`), `command`/`args` (required for `custom`; override the
preset's otherwise), `env`, `model` (default `claude-opus-5-5`); `YAMT_ANALYSIS_HARNESS`,
`YAMT_ANALYSIS_COMMAND` (a command line, split on spaces), `YAMT_ANALYSIS_MODEL`. The e2e server
runs the fake agent this way.

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
- `run.ts` / **`runPrompt`**: spawn, `initialize`, one fresh `session/new` (no resume), the model
  through `session/set_config_option` for adapters that use it, one `session/prompt`, close.
  Timeouts: `initialize` 30 s, session setup 60 s, **idle** 3 min without any update (5 min while
  a tool call is open), a **hard cap** of 10 min on the turn. A timeout or an abort sends
  `session/cancel` and kills the group 5 s later if the harness ignores it. Every event
  (`process.start`, `initialize`, `session.new`, `config`, `prompt`, `update`, `permission`,
  `cancel`, `prompt.end`, `notification`, `process.exit`) goes to `onEvent`; the result has status,
  stop reason, error with a failure class, usage, last context report, and the model that answered
  (Claude Code reports it on usage updates; its model config option can be stale).
- `adapters/`: **Claude Code** (`node <claude-agent-acp>/dist/index.js`, 0.100.0; Bun if there is
  no node): skill via the spec `systemPrompt` (`append`), else `_meta.systemPrompt.append`;
  `_meta.claudeCode.options`: `model`, `allowedTools` (`mcp__yamt`, `WebFetch`, `WebSearch`),
  `tools` (built-ins offered: `Read`, `WebFetch`, `WebSearch`), `settingSources: []` (none of the
  user's own settings, hooks, plugins or CLAUDE.md; the `claude` login still applies),
  `promptSuggestions: false`, env `ENABLE_TOOL_SEARCH=false` (else each MCP tool costs an extra
  model call on first use). claude-agent-acp puts MCP servers on the `claude` command line
  (readable in /proc), so the header says `Bearer ${YAMT_MCP_TOKEN}` and the token goes in the
  session env. **Custom**: any ACP agent; spec `systemPrompt` if advertised, else a
  `<system-instructions>` preamble block; the model via its `model` config option if offered.

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

## Request flow

1. The iPhone opens `https://<host>.<tailnet>.ts.net:7444/`; `tailscale serve` terminates TLS
   and proxies to `127.0.0.1:7890` with the identity headers.
2. `server.ts` routes `/api/*` and `/mcp` to the Hono app and everything else to the static
   handler (files from `packages/web/dist`, falling back to `index.html` for client routes).
   `/mcp` itself is reached from this machine only (see [MCP server](#mcp-server)).
3. In the API: `/api/health` answers directly; any other path goes through `sameOrigin` and
   `requireTailnetIdentity`, then its route (unknown paths: 404 after auth). Errors become
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

### Screens (#10, #11, #12)

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
  in the current goal", **Fix current goal** (PATCH in place).
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
  Audio: `accept="audio/*"` for Voice Memos via Files; Note and Link: sheets), the capture list
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
  opened (polled while the run runs). The run's facts (model, harness, start and attempt, how
  long, outcome, stop reason, tokens, cost when the harness reports it), then the trace as a list:
  tool calls (name without `mcp__yamt__`, a one-line input summary per known tool, a result
  summary, the duration from the call to its completed/failed update; a tap shows the full input
  and output), the agent's messages and thoughts (chunks joined, clamped until tapped),
  permission decisions, notes (a config option the harness lacks, the harness being stopped) and
  errors (orange: a failed run, a crashed harness).
- **Live status:** no push channel; the overview polls `GET /api/meals` every 3 s while a meal is
  queued, analysing or has a pending transcript, the meal screen polls its meal likewise.

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
  `lib/sw.ts` registers it and exports `serviceWorkerReady`, which #13 awaits to subscribe to push;
  #13 adds its `push` and `notificationclick` handlers to `sw.js`.

## Planned (epic #2)

Meals, captures, media storage, the job queue and weight entries (#6), the nutrition layer
with the MCP server (#7), the ACP runtime with the analysis job and worker loop (#8), and the
transcription worker (#9), the PWA with meal capture (#10), the meal detail with questions and
corrections (#11) and the day view with goals and weight (#12) are in. Still to come: Web Push
(#13). Spike #4 (speech-to-text) decided ADR 0002; spike #5's chosen design is
[design/design.md](design/design.md). See the epic for the decisions each one builds on.
