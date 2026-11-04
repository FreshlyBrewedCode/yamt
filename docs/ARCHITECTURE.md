# yamt: architecture

What exists today (the scaffold, #3, and the meal backend, #6), how it fits together, and where
wave 1 goes next. Why it is built this way: [ADR 0001](adr/0001-wave-1-architecture.md).
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
  ├─ SPA             /*       packages/web/dist   (dev: Vite on 7891 proxies /api)
  └─ SQLite          ~/.yamt/yamt.db   (WAL, foreign keys, 0600)
     data dir        ~/.yamt/  (0700): yamt.db, media/, runs/, config.json
     job queue       the `jobs` table; the worker loop that drains it arrives with #8/#9
```

## Layout

```
packages/shared/src/      contracts shared by server and web (no runtime deps but zod)
  api.ts                  API paths, request schemas, response types (health, me)
  api-meals.ts            meals, captures, transcripts, media: `mealPaths`, enums, bodies, types
  api-weight.ts           weight entries: `weightPaths`, body, types
packages/server/src/
  cli.ts                  `yamt start` (flags: --data-dir --port --https-port --local --no-auth --dev --no-build)
  server.ts               composition root: data dir, DB, services, API, static; the mount points
  services.ts             createServices: repositories + domain services, what HTTP talks to
  config.ts               data dir resolution and setup, config.json, ports, version
  tailscale.ts            `tailscale serve --https=<port>` in the foreground
  build-stamp.ts          rebuild packages/web/dist when its sources changed
  auth/identity.ts        requireTailnetIdentity: the Tailscale-User-Login check, dev bypass
  auth/bearer.ts          requireBearer: token auth for machine clients (/mcp, from #7)
  http/                   api.ts (mounts), meals.ts and weight.ts (routes), file-response.ts
                          (media, ranges), middleware.ts (sameOrigin, errors, readJson),
                          origin.ts, static.ts
  domain/                 errors.ts (HttpError), meals.ts (MealService: captures, retract, analyse)
  media/                  store.ts (write-once files), detect.ts (type sniffing), exif.ts,
                          heic.ts (HEIC → JPEG)
  db/                     index.ts (open, pragmas, migration runner, newId), migrations/*.sql,
                          repos/ (one per aggregate: meals, captures, transcripts, jobs, weight)
packages/server/test/     bun tests, temp dirs only; fixtures/ holds made-up images
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
- **Machine clients:** `requireBearer(verify)` for `/mcp` (#7): `Authorization: Bearer <token>`,
  the verifier owns token storage (hashes) and returns the principal; the identity header is not
  accepted there.
- Trust boundary: any process on the VM can reach the loopback port and set the header itself.
  The VM is single-user, so that is accepted (ADR 0001).

## Data

- `~/.yamt/` (`--data-dir`, `YAMT_DATA_DIR`), created and kept at 0700 together with `media/`
  (raw captures) and `runs/` (agent traces). Nothing personal is ever inside the repo; the
  `.gitignore` blocks `*.db` and data dirs as a second line of defence.
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
  `current_revision_id` stays null until revisions exist (#7).
- **captures**: the raw material (`audio`, `image`, `text`, `link`, `file`, `correction`,
  `answer`). Media kinds carry `mime_type`, `media_path` (relative to the data dir), `byte_size`,
  `sha256`, `file_name`, and for HEIC/HEIF photos `jpeg_path`/`jpeg_status` (`ok` | `missing`);
  text-like kinds `text`/`url`; `captured_at` is client-reported, `taken_at` the photo's EXIF
  time; `question_id` is for answers (its FK arrives with the questions table, #7/#11).
  **Immutable**: triggers refuse updates of the raw columns, a second retraction and any delete;
  `retracted_at` is the only change (soft retraction). Meals with captures can't be deleted either.
- **transcripts**: one per audio capture (`capture_id` is the key), created `pending` with it;
  `done` with text, model, language, duration and `segments` (JSON `[{startMs, endMs, text}]`), or
  `failed` with an error. Derived, so replaceable: `upsertPending` resets it for a new run.
- **jobs**: see the queue below.
- **weight_entries**: `measured_at`, `kg`, `note`, `source` (`manual`). User data, not raw
  captures, so they can be deleted.

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

## API (#6)

All behind the identity check, writes also same-origin; paths in `mealPaths` / `weightPaths`.

- `POST /api/meals` (`{eatenAt?}`), `GET /api/meals?from&to&limit` (by `eatenAt`, newest first,
  with live capture counts per kind and a cover photo), `GET /api/meals/:id` (meal, every capture
  including retracted ones, transcripts).
- `POST /api/meals/:id/captures`: `multipart/form-data` with `file` (+ `kind`, `capturedAt`) for
  audio, image and file; JSON for `text`, `link` (http/https `url`), `correction`, `answer`.
  A `capturedAt` more than an hour ahead of the server is refused.
- `POST /api/captures/:id/retract` (idempotent), `POST /api/meals/:id/analyse` (409 without a live
  capture), `GET /api/media/:captureId[/jpeg]`.
- `POST /api/weight` (`{kg, measuredAt?, note?}`), `GET /api/weight?from&to&limit`,
  `DELETE /api/weight/:id`.

## Request flow

1. The iPhone opens `https://<host>.<tailnet>.ts.net:7444/`; `tailscale serve` terminates TLS
   and proxies to `127.0.0.1:7890` with the identity headers.
2. `server.ts` routes `/api/*` to the Hono app and everything else to the static handler (files
   from `packages/web/dist`, falling back to `index.html` for client routes).
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

Meals, captures, media storage, the job queue and weight entries (#6) are in. Still to come,
in stack order: the nutrition data layer and the yamt MCP server at `/mcp` (#7); the ACP runtime
and the meal analysis job, with the worker loop draining `jobs` (#8); the transcription worker
(#9); the PWA shell and meal capture (#10); meal detail, questions and corrections (#11); the day
view, goals and weight (#12); Web Push (#13). Spikes #4 (speech-to-text, CPU vs GPU) and #5
(design directions; the result becomes `docs/design/design.md` and replaces the neutral theme
tokens) run alongside. See the epic for the decisions each one builds on.
