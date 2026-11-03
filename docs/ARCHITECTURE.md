# yamt: architecture

What exists today (the scaffold, #3, the meal backend, #6, and the nutrition layer with the yamt
MCP server, #7), how it fits together, and where wave 1 goes next. Why it is built this way: [ADR 0001](adr/0001-wave-1-architecture.md).
Commands and conventions: [AGENTS.md](../AGENTS.md).

## Components

```
iPhone (Safari / home-screen PWA), on the tailnet
  │  https://<host>.<tailnet>.ts.net:7444   tailscale serve (foreground, TLS by Tailscale)
  │                                          adds Tailscale-User-Login for user-owned devices
  ▼
yamt start   (one Bun process, binds 127.0.0.1:7890 only)
  ├─ Hono JSON API   /api/*   identity-header auth (except /api/health), same-origin writes,
  │                           zod-validated bodies; meals, captures, media, weight
  ├─ MCP server      /mcp     bearer tokens (agent runs, interactive Claude Code sessions),
  │                           loopback callers only; the agent's only way to read and write
  ├─ SPA             /*       packages/web/dist   (dev: Vite on 7891 proxies /api)
  └─ SQLite          ~/.yamt/yamt.db   (WAL, foreign keys, 0600)
     data dir        ~/.yamt/  (0700): yamt.db, media/, runs/, config.json, mcp-token
     job queue       the `jobs` table; the worker loop that drains it arrives with #8/#9
        │
        └─ outbound: Open Food Facts, USDA FoodData Central, recipe pages (timeouts, size caps,
                     rate limits; results cached in `foods`)
```

## Layout

```
packages/shared/src/      contracts shared by server and web (no runtime deps but zod)
  api.ts                  API paths, request schemas, response types (health, me)
  api-meals.ts            meals, captures, transcripts, media: `mealPaths`, enums, bodies, types
  api-weight.ts           weight entries: `weightPaths`, body, types
  api-nutrition.ts        foods, revisions, items, questions, totals: enums and types
packages/server/src/
  cli.ts                  `yamt start` (flags: --data-dir --port --https-port --local --no-auth --dev --no-build),
                          `yamt mcp-token [--rotate]`
  server.ts               composition root: data dir, DB, services, API, static; the mount points
  services.ts             createServices: repositories + domain services, what HTTP talks to
  config.ts               data dir resolution and setup, config.json, ports, version
  tailscale.ts            `tailscale serve --https=<port>` in the foreground
  build-stamp.ts          rebuild packages/web/dist when its sources changed
  auth/identity.ts        requireTailnetIdentity: the Tailscale-User-Login check, dev bypass
  auth/bearer.ts          requireBearer: token auth for machine clients (/mcp)
  http/                   api.ts (mounts), meals.ts and weight.ts (routes), file-response.ts
                          (media, ranges), middleware.ts (sameOrigin, errors, readJson),
                          origin.ts, static.ts
  domain/                 errors.ts (HttpError), meals.ts (MealService: captures, retract, analyse),
                          revisions.ts (RevisionService: save, views, day summary), foods.ts
                          (FoodService: search, barcode, create), time.ts (days and local times)
  nutrition/              nutrients.ts (OFF/FDC → core set), totals.ts (the only totals), ranking.ts,
                          off.ts / fdc.ts (clients), http.ts (timeouts, size caps, rate limits,
                          User-Agent), recipe.ts (fetch + schema.org Recipe JSON-LD)
  mcp/                    endpoint.ts (/mcp: auth, stateless transport), tools.ts (the tools,
                          scopes, instructions), tokens.ts (interactive and per-run tokens)
  media/                  store.ts (write-once files), detect.ts (type sniffing), exif.ts,
                          heic.ts (HEIC → JPEG)
  db/                     index.ts (open, pragmas, migration runner, newId), migrations/*.sql,
                          repos/ (one per aggregate: meals, captures, transcripts, jobs, weight,
                          foods, revisions)
packages/server/test/     bun tests, temp dirs only; fixtures/ holds made-up images and, in
                          nutrition/, recorded OFF/FDC answers and a trimmed recipe page
                          (record.ts re-records them; the gate never hits the network)
packages/web/src/
  main.tsx                router + query client
  routes/                 TanStack file routes (__root.tsx, index.tsx); routeTree.gen.ts is generated
  lib/api.ts, queries.ts  the fetch client and every TanStack Query hook
  components/ui/          shadcn/ui components (button, card, input, badge, sheet, tabs)
  index.css               Tailwind 4 + the theme tokens (light/dark)
e2e/                      Playwright specs (phone viewport)
docs/adr/                 architecture decision records
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
  (raw captures) and `runs/` (agent traces); `mcp-token` (0600) holds the interactive MCP token,
  `config.json` the optional `login` and `fdcApiKey`. Nothing personal is ever inside the repo;
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

- **meals**: `status` `draft` → `queued` → `analysing` → `analysed` | `needs_input` | `failed`;
  `eaten_at` with `eaten_at_source`: `created` (no capture yet: the creation time), `capture` (the
  earliest live capture), `user` (given on create), `agent` (refined by the analysis, #8). Only
  `created`/`capture` follow the captures: adding or retracting one recomputes it from
  `COALESCE(taken_at, captured_at, created_at)` (EXIF beats the client clock beats arrival).
  `current_revision_id` points at the latest revision (null before the first analysis).
- **captures**: the raw material (`audio`, `image`, `text`, `link`, `file`, `correction`,
  `answer`). Media kinds carry `mime_type`, `media_path` (relative to the data dir), `byte_size`,
  `sha256`, `file_name`, and for HEIC/HEIF photos `jpeg_path`/`jpeg_status` (`ok` | `missing`);
  text-like kinds `text`/`url`; `captured_at` is client-reported, `taken_at` the photo's EXIF
  time; `question_id` links an answer to a `meal_questions` row. There is no foreign key (that
  would mean rebuilding this immutable table); captures are only inserted, so an insert trigger
  (`captures_question_of_meal`) enforces the same: the question exists and belongs to the meal.
  The service additionally requires a question of the meal's *current* revision.
  **Immutable**: triggers refuse updates of the raw columns, a second retraction and any delete;
  `retracted_at` is the only change (soft retraction). Meals with captures can't be deleted either.
- **transcripts**: one per audio capture (`capture_id` is the key), created `pending` with it;
  `done` with text, model, language, duration and `segments` (JSON `[{startMs, endMs, text}]`), or
  `failed` with an error. Derived, so replaceable: `upsertPending` resets it for a new run.
- **jobs**: see the queue below.
- **weight_entries**: `measured_at`, `kg`, `note`, `source` (`manual`). User data, not raw
  captures, so they can be deleted.
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

`jobs` (`db/repos/jobs.ts`) is a small SQLite queue for one in-process worker loop (#8 analyse,
#9 transcribe). Types and payloads: `transcribe {captureId}`, `analyse {mealId}`.

- `enqueue(type, payload, {dedupeKey, runAfter, maxAttempts})` is idempotent per `dedupe_key`
  while a job is `queued` (a partial unique index backs it): one open `analyse:<meal>` per meal,
  one `transcribe:<capture>` per audio capture. A request while the keyed job *runs* queues a new
  one, which is not claimed until the running one ends (it may have missed new captures).
- `claim({types})` takes the oldest due job in an IMMEDIATE transaction → `running`, attempt + 1.
- `complete(id)` → `done`. `fail(id, error, {retryable})` → back to `queued` after 30 s, 2 min,
  8 min … while attempts remain, else `failed` (final: the worker marks the meal/transcript).
  `reschedule(id, runAfter)` → `queued` without spending an attempt (waiting for transcripts, GPU
  host asleep). A requeue that meets a newer queued job with the same key is `cancelled` instead.
- `cancelQueued(key)` (a retracted audio capture cancels its transcription) and
  `releaseInterrupted()`, which the server runs at startup: jobs a previous process left
  `running` count a failed attempt and are queued again.
- Producers: an audio capture enqueues `transcribe` (with its pending transcript, in the same
  transaction); `POST /api/meals/:id/analyse` sets the meal `queued` and enqueues `analyse`. Adding
  captures to an `analysed`/`needs_input` meal does not queue it; the client calls analyse again.

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
  totals and the day's). Times go out as ISO 8601 with the zone's offset.
- **Tokens** (`mcp/tokens.ts`, `services.mcpTokens`): `yamt_` + 256 random bits, compared as
  SHA-256 hashes.
  - *Interactive:* one long-lived token in `<data>/mcp-token` (0600), created at the first start
    or by `yamt mcp-token`; `--rotate` replaces it (a running server notices the new file). The
    repo's `.mcp.json` points Claude Code at `http://127.0.0.1:${YAMT_PORT:-7890}/mcp` with
    `Bearer ${YAMT_MCP_TOKEN:-}`; the token itself is never in the repo. Full access.
  - *Per run:* `mintRun({runId, mealId, ttlMs})` → a token scoped to one meal, in memory only
    (runs don't outlive the server), revoked by `revokeRun(runId)` and expiring after 2 h
    regardless. A run token sees `get_meal`/`save_meal_revision` for its meal only, the food tools,
    and not `get_day_summary`; revisions it saves record its `run_id`.

## API

All behind the identity check, writes also same-origin; paths in `mealPaths` / `weightPaths`.

- `POST /api/meals` (`{eatenAt?}`), `GET /api/meals?from&to&limit` (by `eatenAt`, newest first,
  with live capture counts per kind and a cover photo), `GET /api/meals/:id` (meal, every capture
  including retracted ones, transcripts, and the current revision with items, questions, answers
  and computed totals).
- `POST /api/meals/:id/captures`: `multipart/form-data` with `file` (+ `kind`, `capturedAt`) for
  audio, image and file; JSON for `text`, `link` (http/https `url`), `correction`, `answer`
  (optional `questionId`: a question of the meal's current revision, else 400).
  A `capturedAt` more than an hour ahead of the server is refused.
- `POST /api/captures/:id/retract` (idempotent), `POST /api/meals/:id/analyse` (409 without a live
  capture), `GET /api/media/:captureId[/jpeg]`.
- `POST /api/weight` (`{kg, measuredAt?, note?}`), `GET /api/weight?from&to&limit`,
  `DELETE /api/weight/:id`.

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
  shadcn's semantic names (`background`, `card`, `primary`, `muted`, `destructive`, `chart-1…5`,
  radii) for light (`:root`) and dark (`.dark`). `index.html` sets `.dark` from
  `prefers-color-scheme` before first paint and follows changes.
- Mobile first: `viewport-fit=cover`, safe-area padding on `#root`, a single column capped at
  `max-w-md`; the e2e runs at 390×844 with touch.

## Planned (epic #2)

Meals, captures, media storage, the job queue and weight entries (#6), and the nutrition layer
with the MCP server (#7) are in. Still to come, in stack order: the ACP runtime and the meal
analysis job, with the worker loop draining `jobs` and minting per-run MCP tokens (#8); the transcription worker
(#9); the PWA shell and meal capture (#10); meal detail, questions and corrections (#11); the day
view, goals and weight (#12); Web Push (#13). Spikes #4 (speech-to-text, CPU vs GPU) and #5
(design directions; the result becomes `docs/design/design.md` and replaces the neutral theme
tokens) run alongside. See the epic for the decisions each one builds on.
