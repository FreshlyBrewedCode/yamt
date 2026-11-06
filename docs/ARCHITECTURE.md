# yamt: architecture

What exists today (the scaffold, #3, the meal backend, #6, the nutrition layer with the yamt
MCP server, #7, the analysis job over ACP, #8, the transcription worker, #9, the PWA with
meal capture, #10, the meal detail with questions and corrections, #11, the day view with
goals and weight, #12, Web Push notifications, #13, the guided goal setup, #24, paste and
the iOS Shortcut share target, #26, the agent settings, #28, logging a meal again, #30, the
calendar, #33, removing a meal, the data underneath meal planning, #39, planning requests,
#44, the suggestion job that fills their rounds, #45, planning settings, #46, the planning
screens, #47, the nightly run with agent-written starters, #48, and leftovers with the shopping
list, #49), how it
fits together, and what comes after wave 1. Why it is built this way:
[ADR 0001](adr/0001-wave-1-architecture.md), for planning [ADR 0003](adr/0003-meal-planning.md). Commands and conventions: [AGENTS.md](../AGENTS.md).
The design: [design/design.md](design/design.md).

## Components

```
iPhone (Safari / home-screen PWA), on the tailnet
  │  https://<host>.<tailnet>.ts.net:7444   tailscale serve (foreground, TLS by Tailscale)
  │                                          adds Tailscale-User-Login for user-owned devices
  ▼
yamt start   (one Bun process, binds 127.0.0.1:7890 only)
  ├─ Hono JSON API   /api/*   identity-header auth (except /api/health), same-origin writes,
  │                           zod-validated bodies; meals, captures, media, weight, goals, days, months,
  │                           push subscriptions, the share target (/api/share: an iOS Shortcut), the plan,
  │                           recipes and planned meals
  ├─ MCP server      /mcp     bearer tokens (agent runs, interactive Claude Code sessions),
  │                           loopback callers only; the agent's only way to read and write
  ├─ SPA             /*       packages/web/dist   (dev: Vite on 7891 proxies /api); the PWA:
  │                           manifest, icons, /sw.js (app shell, push and notification taps)
  ├─ job worker      drains the `jobs` table: `analyse` and `plan` (one at a time each),
  │    │             `transcribe` (one batch at a time, alongside)
  │    ├─ analysis run: one harness process per run, ACP over stdio, cwd ~/.yamt/runs/<run>/
  │    │    claude-agent-acp (node) → `claude` │ `opencode acp` │ custom ACP command
  │    │    (harness, model and effort: Settings → Agent, see Agent settings)
  │    │    └─ MCP over HTTP back to 127.0.0.1:7890/mcp with a per-run token
  │    ├─ planning run (#45): the same, for one planning round, with the plan-meals skill and
  │    │    a token scoped to the round (planning settings: env > app > config.json `planning`)
  │    ├─ transcription batch: ffmpeg per memo → 16 kHz WAV in a temp dir, then one
  │    │    services/stt process (uv, Python, faster-whisper on the CPU) for the batch
  │    └─ a settled analysis or planning round → Web Push (web-push: aes128gcm + VAPID) to
  │         each subscription
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
  api-meals.ts            meals, captures, transcripts, media: `mealPaths`, enums, bodies, types; logging a
                          meal again (#30): `RepeatMealBody`, `REPEAT_FACTORS`, `RepeatableQuery`
  api-weight.ts           weight entries: `weightPaths`, body, types; `dailyWeights` (the 7-day average's core)
  api-calendar.ts         the calendar (#33): `calendarPaths`, `LocalMonth`, `MonthQuery`, `MonthResponse` (days,
                          weeks, summary, weight), `PlanGoal`; `monthDays`, `addMonths`, `weekdayIndex`
  plan.ts                 the calendar's classifier (#33): `classifyDay`, `classifyWeek`, the thresholds as named
                          constants (`ON_PLAN`, `FAR_OFF`, `DEAD_ZONE`, `TOO_LOW_ON_CUT`, `WEEK_FULL_DAYS`),
                          `goalPlan` (a goal's kind, label and floor), `dayInput`, `planWords`, `rangeWords`
  totals.ts               the only totals: `computeTotals`, `itemNutrients`, `roundNutrient`; `scaleGrams` and
                          `portionItems` (a recipe's items for a portion), shared so the web app previews "Ate it"
                          with the server's code
  api-goals.ts            goals and days: `goalPaths`, bodies, `DayResponse`, `goalInForce`, `goalPeriods`,
                          `dayProgress`, `addDays`, `goalLabel` (shared by server and web)
  goal-calc.ts            guided goals (#24): `calculateGoal` (the algorithm, `ALGORITHM_VERSION`), its
                          presets as data, `defaultChoices`, `goalWeight`, `refusalFor`; pure, no zod
  api-profile.ts          the profile and guided goals: `profilePaths`, `ProfileBody`, `GuidedGoalBody`
  api-nutrition.ts        foods, revisions, items, questions, totals: enums and types
  api-planning.ts         meal planning (#36): `planningPaths`, `RecipeSourceMode`, `MealSlot`, `MAIN_SLOTS`,
                          `PlannedMealStatus`, recipes and their views, planned meals, `PlanQuery` / `PlanResponse`
                          (`PlanDay`), the bodies, "Ate it" (`LogPlannedMealBody`), `slotOf` (an eaten meal's slot)
  api-planning-requests.ts  planning requests (#44): `planningRequestPaths`, `PlanningFilters` /
                          `ResolvedPlanningFilters` / `PLANNING_DEFAULTS`, `requestTitle`, the input, round and
                          suggestion enums and types (`PlanningSuggestionView` with `SuggestionFit`), the bodies
  api-planning-settings.ts  Settings → Planning (#46): `planningSettingsPaths`, `PlanningSettingsBody`
                          (count, source mode, portions, `PlanningPreferences`, `NightlySettings` #48),
                          `DEFAULT_PLANNING_SETTINGS`
  api-planning-nightly.ts the nightly run (#48): `planningNightlyPaths`, `STARTER_KINDS`, `StarterInput`
                          (`StarterFilters`, `StarterRef`), `PlanningStarterView`, `NightlyResponse`,
                          `RegenerateNightlyBody`, `STARTERS_MAX_AGE_MS`
  api-leftovers.ts        leftovers (#49): `leftoverPaths`, `LeftoverView`, `LeftoverOffer`, the bodies
                          (`CreateLeftoverBody`, `UpdateLeftoverBody`, `PlanLeftoverBody`), `leftoverAmount`
  api-shopping.ts         the shopping list (#49): `shoppingPaths`, `AISLES` / `AISLE_NAME`, `ShoppingQuery`,
                          `ShoppingLine`, `ShoppingListResponse`, `ShoppingCheckBody`, `AddShoppingLineBody`
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
  transcription/          job.ts (the `transcribe` handler for voice captures and planning inputs,
                          settleTranscript, nudgeWaiting), backend.ts
                          (the SttBackend interface), local.ts (LocalWhisperBackend: the services/stt
                          process and its NDJSON protocol), ffmpeg.ts (normalisation), tools.ts (finding
                          ffmpeg)
  tailscale.ts            `tailscale serve --https=<port>` in the foreground
  build-stamp.ts          rebuild packages/web/dist when its sources changed
  auth/identity.ts        requireTailnetIdentity: the Tailscale-User-Login check, dev bypass
  auth/bearer.ts          requireBearer: token auth for machine clients (/mcp)
  http/                   api.ts (mounts), meals.ts, runs.ts, weight.ts, goals.ts, push.ts, share.ts, agent.ts,
                          planning.ts, planning-requests.ts, planning-settings.ts and planning-nightly.ts
                          (routes), file-response.ts
                          (media, ranges), middleware.ts (sameOrigin, errors, readJson, readUpload),
                          origin.ts (originAllowed, publicOrigin), static.ts
  domain/                 errors.ts (HttpError), meals.ts (MealService: captures, retract, analyse,
                          eaten-at, revision history, repeat and repeatable: logging a meal again,
                          remove and restore),
                          revisions.ts (RevisionService: save, views, day summary), foods.ts
                          (FoodService: search, barcode, create), goals.ts (GoalService: goals and the
                          day view), calendar.ts (CalendarService: a month, #33; goalsByDate), share.ts (ShareService:
                          the share target), recipes.ts (RecipeService: save and view), planning.ts
                          (PlanningService: planned meals, the plan, "Ate it", #36), planning-requests.ts
                          (PlanningRequestService: requests, inputs, rounds, suggestions, picking, #44),
                          planning-settings.ts (the `planning` setting, #46), nightly.ts (NightlyService:
                          the schedule, the run, Regenerate, superseding, starters, #48), leftovers.ts
                          (LeftoverService, what "Ate it" and removing a meal do to leftovers, the plan's
                          offers, #49), shopping.ts (ShoppingService and the pure `shoppingLines`, #49),
                          time.ts (days and local times)
  nutrition/              nutrients.ts (OFF/FDC → core set), totals.ts (re-exports the shared totals), ranking.ts,
                          off.ts / fdc.ts (clients), http.ts (timeouts, size caps, rate limits,
                          User-Agent), recipe.ts (fetch + schema.org Recipe JSON-LD), aisles.ts (a food's
                          shopping aisle: its categories, else keywords, #49)
  mcp/                    endpoint.ts (/mcp: auth, stateless transport), tools.ts (the tools,
                          scopes, instructions), tokens.ts (interactive and per-run tokens)
  media/                  store.ts (write-once files), detect.ts (type sniffing), exif.ts,
                          heic.ts (HEIC → JPEG), downscale.ts (JPEG → ≤ 1600 px, upright), upload.ts
                          (storeUpload: an upload into the store, for captures and planning inputs; storedFile)
  db/                     index.ts (open, pragmas, migration runner, newId), migrations/*.sql,
                          repos/ (one per aggregate: meals, captures, transcripts, jobs, weight,
                          foods, revisions, runs (analysis and planning runs), goals, profile, push,
                          settings, recipes, planned-meals,
                          planning-requests, planning-inputs, planning-rounds (rounds and their suggestions),
                          planning-starters (#48), leftovers and shopping (#49);
                          transcripts.ts holds both transcript tables)
  push/                   vapid.ts (the key pair in vapid.json), sender.ts (PushSender: encrypt, sign,
                          deliver, 404/410 cleanup), messages.ts (what a meal's and a planning round's
                          notification says, notifyMeal, notifyPlan)
  planning/               the suggestion job (#45): job.ts (PlanJob, settleRound, the turn's cap),
                          prompt.ts (the round's prompt), tools.ts (the planning MCP tools), context.ts
                          (get_planning_context; preferences from #46's setting, the open leftovers,
                          #49), budget.ts (the slot budget), matcher.ts (match_ingredients: routing and
                          ranking), nightly.ts (NightlyJob: the scheduled `nightly` handler, #48)
packages/server/test/     bun tests, temp dirs only; fixtures/ holds made-up images and, in
                          nutrition/, recorded OFF/FDC answers and a trimmed recipe page
                          (record.ts re-records them; the gate never hits the network);
                          fake-agent.ts is a scripted ACP agent for analyses and planning rounds
                          (`fake:<script>` texts; tests never start a real harness),
                          fake-stt.ts a scripted STT process and fake-ffmpeg.ts an ffmpeg stand-in
                          (tests never load a speech model); fixtures/memo-de.m4a is synthetic speech
packages/shared/test/     bun tests: goal-calc (the fixture, equations, caps, floors, rounding, defaults),
                          plan (the calendar's classifier, goal plans, the weight average, month arithmetic),
                          totals (portions of a recipe)
packages/web/
  index.html              iOS/PWA metas, manifest and icon links, the dark-mode switch
  public/                 manifest.webmanifest, icons/ (rendered by scripts/icons.ts)
  sw.js                   the service worker template (vite.config.ts fills in the build's files)
  test/                   bun tests: the upload queue, the recorder's logic, the trace parser, the weight
                          trend, the clipboard mapping, the plan's reading (planning), the planning
                          requests' filters, sentence, pick target and starters (plan-request), the
                          nightly section's state and the agent starters' numbers (nightly)
packages/web/src/
  main.tsx                router + query client, starts the upload queue, registers the worker
  routes/                 TanStack file routes: __root.tsx, index.tsx (the overview),
                          meals.$mealId.tsx (a meal: its detail or its capture view), days.$date.tsx
                          (the day view), calendar.tsx (the calendar, #33), goals.tsx (goals and weight), goals_.guided.tsx (the guided
                          setup, /goals/guided), settings.tsx (notifications, the agent, sharing),
                          plan.days.tsx (the plan view, /plan/days, #40), planned.$id.tsx (a planned
                          meal's recipe, /planned/:id), plan.index.tsx (the planning entry, /plan, #47),
                          plan.filters.tsx (the filter page), plan.requests.$id.index.tsx (a request's
                          thread), plan.requests.$id.suggestions.$suggestionId.tsx (a suggestion's recipe),
                          plan.shopping.tsx (the shopping list, /plan/shopping?from&to, #49);
                          routeTree.gen.ts
                          is generated
  lib/api.ts, queries.ts  the fetch client and every TanStack Query hook
  lib/outbox/             the upload queue: outbox.ts (Outbox), store.ts (IndexedDB), transport.ts
                          (fetch/XHR), index.ts (the app's queue and its hooks); meal captures and
                          planning requests, inputs and rounds (#47)
  lib/recorder.ts         the recorder's state machine and helpers; hooks/use-recorder.ts wires it
  lib/trace.ts            a run's NDJSON trace → run metadata and a readable list (parseTrace)
  lib/weight.ts           the weight trend: raw points and the 7-day moving average (weightTrend), kgTicks
  lib/planning.ts         the plan's reading (#40): a day's squares (readDay), what is open before a dish
                          (openBefore), what "Ate it" logs (ateItTotals, the shared computeTotals), slot clashes
  lib/plan-request.ts     a planning request on the phone (#47): filter overrides over the defaults
                          (resolveDraft), the summary and the sentence the agent reads, where Pick goes
                          (pickTarget), how far a round is (roundMeta); the overview's Planning strip
                          (#54's follow-up): how an open request stands (requestState), whether it is
                          past (isPastRequest), its open rows (stripRows) folded to one per state
                          (groupStripRows)
  lib/starters.ts         the entry screen's starters (computeStarters: the nightly run's first, then
                          code's; agentStarter and liveNumber: an agent starter's number, computed here; SEASON)
  lib/leftovers.ts        leftovers on the phone (#49): a leftover's line (leftoverLine), the plan's offers by
                          leftover (offersOf), Ate it's sentence (keptWords), a starter's number (leftoverNumber)
  lib/shopping.ts         the shopping list's aisles with their counts (byAisle), "½ Hokkaido at home"
                          (atHomeWords), the range sheet's days (rangeDays)
  lib/nightly.ts          the Tonight section's state (nightlyState: which nightly request it shows while
                          one regenerates), its words, Pick's words, the overview's quiet row (#48)
  lib/plan-draft.ts       the composers' drafts (in memory, per composer) and sendDraft (into the queue)
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
                          model picker, the analysis and planning lines, #46), planning-settings (Settings →
                          Planning: count, source mode, portions, the preferences sheets, #46), log-again
                          (the Log again sheet, the "Again?" list), calendar (the
                          month grid, the selected day, the summary, the legend, #33), remove-meal (the
                          Remove meal row, the day's undo strip, a removed meal), planning (the planned-meal
                          row, the Log | Plan slab, the totals note, the fit bar, the Ate-it and Plan-for
                          sheets, #40), recipe-detail (a planned meal's recipe, a suggestion's), composer
                          (the planning dock and composer, #47), plan-request (starter bands, the filter
                          summary and form, the slots slab, You asked, the suggestion, placeholder and
                          failed rows, the overview's Planning strip, #47), nightly (the Tonight section,
                          its compact rows, Regenerate, the strip's quiet row, #48), leftovers (the offered
                          row with Plan it, the Leftovers list and its sheets, the shopping row, #49); ui/ (shadcn:
                          button, input, sheet)
  index.css               Tailwind 4 + the D · Slab theme tokens (light/dark)
e2e/                      Playwright specs (phone viewport); calendar-seed.ts makes four made-up months for the
                          calendar spec, which runs against a server of its own (YAMT_E2E_PORT − 1); mcp.ts
                          calls a yamt MCP tool with the data dir's interactive token (the plan spec seeds
                          recipes and planned meals with it)
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
- Ports: 7890 (HTTP), 7891 (Vite in dev), 7444 (tailnet HTTPS), 7898 (e2e), 7897 (the e2e's
  calendar server). Neighbouring projects on the host use 7880/7443/7899 and 443/8443.

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
  `source_meal_id` (#30): the meal this one was logged again from (null for a meal of its own);
  such a meal starts with no captures, its time pinned (`user`) to the one chosen.
  `source_planned_meal_id` (#39): the planned meal it was logged from ("Ate it"), likewise without
  captures and pinned; no foreign key (removing the meal puts the planned meal back to `planned`,
  which may then be unplanned).
  `removed_at`: when the user removed the meal (soft, see [Removing a meal](#removing-a-meal));
  null for a meal in use. Every query over meals but the lookup by id leaves removed ones out, and
  triggers (`captures_not_on_removed_meal`, `revisions_not_on_removed_meal`) refuse new captures
  and revisions on one. Meals are never deleted.
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
- **planning_runs** (#45): one per attempt of a round's `plan` job, the columns of `runs` with
  `round_id` (NOT NULL) instead of the meal and `ready` (the round's ready suggestions when it
  ended) instead of the revision; never deleted. A sibling rather than a nullable `runs.meal_id`,
  which SQLite could only loosen by rebuilding `runs` (`meal_revisions` references it, and the
  migration runner keeps foreign keys on). `RunRepo` and `PlanningRunRepo` share their SQL.
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
  `events` (JSON toggles `{"analysed": true, "needs_input": true, "failed": true, "planning":
  true}`; a missing key counts as on, and a PATCH that leaves one out keeps it), `last_sent_at`, `last_error`. Deleted when the push service answers 404/410 or
  the device turns notifications off.
- **settings** (#28): app settings as `key` → JSON `value`, `updated_at`. `agent`: `{harness,
  model, effort}` (null model or effort: not set here). `planning-agent` (#45 reads it, #46's
  Settings → Agent writes it): the same shape, for planning rounds. `planning` (#46, Settings →
  Planning): `{count, sourceMode, portionsCooked, preferences}` — a new request's filter defaults
  and the preferences `get_planning_context` returns (`PlanningSettingsBody`,
  `domain/planning-settings.ts`'s `planningSettings`). Never secrets: those stay in config.json
  and the env.
- **foods**: the food cache. `source` (`off`, `fdc`, `label`, `custom`) and `source_ref`
  (barcode or FDC id; unique per source, so a refetch updates the row), `name`, `brand`, the core
  set per 100 g as columns (`energy_kcal`, `protein_g`, `fat_g`, `saturated_fat_g`,
  `carbohydrate_g`, `sugars_g`, `fiber_g`, `salt_g`; null where the source has no value), the
  full profile (`nutrients`, JSON `{name: {value, unit}}`), `portions` (JSON `[{label, grams}]`),
  the source payload (`raw`) and `fetched_at`. `foods_fts` (FTS5, `unicode61 remove_diacritics
  2`, keyed by `food_id`, kept by triggers) indexes name and brand.
- **meal_revisions**: one per analysis, numbered per meal: `run_id` (the #8 run; null when an
  interactive session saved it, or for a copy), `kind` (`analysis`, `copy` for a meal logged
  again, #30, with `source_revision_id`: the source meal's revision it copied, or `plan` for a
  meal logged from the plan, #39, with no source revision), `title`,
  `summary`, `eaten_at`, `assumptions` (JSON list), `status` (`analysed` | `needs_input`). **meal_items**: `food_id` (null for a pure estimate),
  `description` as captured, `grams`, `provenance` (`weighed`, `label`, `database`, `estimate`),
  `confidence` (`high`, `medium`, `low`), `note`, and the core set per 100 g **copied from the food
  when saved** (or the estimate), so refreshing a food never changes an old revision's totals.
  **meal_questions**: `question`, `why_it_matters`, `impact_kcal`, `answered_by_capture_id` (the
  latest live answer; recomputed when one arrives or is retracted). Revisions, items and
  questions are immutable and never deleted (triggers); only the answer link changes.
- **recipes** (#39): `title`, `summary` (one line), `source_mode` (`published` | `adapted` |
  `composed`), `source_url`, `source_name`, `changes` (JSON list: what an adapted recipe changed),
  `servings` (the portions the item grams are for), `time_active_min`, `time_total_min`, `steps`
  (JSON list), `notes`. **recipe_items**: as `meal_items` (food or estimate, `description` as
  written, `grams` for the whole recipe, provenance, confidence, note, the core set per 100 g copied
  when saved) plus `optional`. Both **insert-only** (triggers): a changed recipe is a new row, so a
  planned meal's numbers never move under it.
- **planned_meals** (#39): `date` (local `YYYY-MM-DD`, like goals), `slot` (`breakfast` | `lunch` |
  `dinner` | `snack`), `position` (0, 1, … within the date's slot), `recipe_id`, `title` (the
  recipe's), `portions_cooked` (default 1), `portion_eaten` (a factor of one portion, default 1),
  `status` (`planned` → `logged` | `skipped`), `logged_meal_id` (unique), `leftover_of` (#49: the
  planned meal whose extra cooked portions it eats; then `portions_cooked` is 0), `suggestion_id`
  (the suggestion it was picked from, #44; null for one planned by hand), `note`. Only a `planned`
  one can be deleted (unplanned; a trigger keeps logged and skipped ones).
- **planning_requests** (#44): `title` (`requestTitle` from the filters, or the outline's), `origin`
  (`user` | `nightly`), `filters` (JSON `ResolvedPlanningFilters`: complete, the defaults filled in
  when it was made), `time_zone` (the phone's: the zone of its days and of the fit), `archived_at`
  (soft; null while open), `created_at`, `updated_at` (anything in the thread changed).
- **planning_inputs** (#44): what the user added to a request, a sibling of `captures` (whose
  `meal_id` is NOT NULL and which is immutable, with transcripts and questions hanging off it):
  `kind` (`text`, `link`, `audio`, `image`, `file`), the same media columns and storage
  (`media/<yyyy>/<mm>/<input id>.<ext>`, a JPEG for HEIC), `captured_at`, `taken_at`, `text`/`url`,
  `round_id` (the round it went into: set once, when the next round starts; null meanwhile) and
  `retracted_at`. Immutable by triggers but for those two, each set once; never deleted.
- **planning_transcripts** (#44): a voice input's transcript, `input_id` the key, the columns of
  `transcripts` (`TranscriptRepo` and `PlanningTranscriptRepo` share their SQL).
- **planning_rounds** (#44): `request_id`, `number` (1, 2, … unique per request), `kind` (`first` |
  `more` | `steer`), `status` (`queued` → `running` → `done` | `failed`), `count` (suggestions asked
  for), `run_id` (the current or last `planning_runs` row filling it; triggers refuse an id that
  isn't one of the round's own runs, as a foreign key would without rebuilding the table), `error`,
  `created_at`, `started_at`, `ended_at`. A partial unique index allows one `queued` or `running` round per request.
- **planning_suggestions** (#44): `round_id`, `position` (0, 1, … in the outline's order; unique
  per round), `status` (`outlined` → `ready` | `failed`), `title`, `approach` (one line),
  `source_mode`, `source_url`, `proposed_date`, `proposed_slot`, `recipe_id` (set when ready: the
  suggestion **is** that insert-only recipe), `why` (JSON, up to four lines), `failure` (the agent's
  reason, or "didn't complete"), `verdict` (`picked` | `rejected` | null), `planned_meal_id` (the
  pick's; set null when it is unplanned), timestamps. Not insert-only: a retried attempt replaces
  the outline, a second save of a position its recipe, and verdicts come and go.
- **planning_starters** (#48): the starters a nightly round wrote: `round_id`, `position` (unique
  per round), `kind` (`protein_gap` | `use_up` | `variety` | `like_meal` | `season` |
  `last_request` | `other`), `text`, `detail`, `filters` (JSON `StarterFilters`: what a tap
  applies, days relative), `ref` (JSON `StarterRef`: `mealId`, `requestId`, `recipeId`,
  `leftoverId`), `created_at`. No number: the app computes it. Derived: a second save of the round
  replaces its set.
- **leftovers** (#49): `description`, `food_id` (optional), `quantity` (as said: "½", "1 bunch"),
  `grams`, `portions` (a cooked one's portions still left), `source` (`cooked` | `pack` | `user`),
  for a cooked one `planned_meal_id` (unique: one per planned meal; set null if that is unplanned),
  `recipe_id` and `cooked_on` (its date), for a pack the agent noted `round_id` and, when noted for
  a suggestion, `suggestion_id` (listed only once a planned meal of it is logged), `note`, `status`
  (`open` → `used` | `gone`, and back), `closed_at`, timestamps. A short list, not a pantry; a
  cooked one taken back (its meal removed before anything was eaten from it) is deleted.
- **shopping_items** (#49): what the user did to a shopping list, which is otherwise computed: a
  `check` of a computed line (`line_key`, the `grams` to buy when checked) or a `line` of their own
  (`text`, `checked`), each with the range it was made for (`range_from`, `range_to`); a row applies
  to every range that overlaps its own. User data: own lines are deleted when removed, checks when
  unchecked.

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
transcribe, plan). Types and payloads: `transcribe {captureId}` or `{inputId}` (a voice planning
input, #44), `analyse {mealId}`, `plan {roundId}` (#44 enqueues it, #45's `PlanJob` runs it),
`nightly {}` (#48: the scheduled nightly run, `NightlyJob`).

- `enqueue(type, payload, {dedupeKey, runAfter, maxAttempts})` is idempotent per `dedupe_key`
  while a job is `queued` (a partial unique index backs it): one open `analyse:<meal>` per meal,
  one `transcribe:<capture>` per audio capture, one `transcribe:input:<input>` per voice planning
  input, one `plan:<request>` per planning request (its rounds run one after the other), one
  `nightly` (the next nightly run, #48). A request while the keyed job *runs* queues a new
  one, which is not claimed until the running one ends (it may have missed new captures).
- `claim({types})` takes the oldest due job in an IMMEDIATE transaction → `running`, attempt + 1.
- `complete(id)` → `done`. `fail(id, error, {retryable})` → back to `queued` after 30 s, 2 min,
  8 min … while attempts remain, else `failed` (final: the worker marks the meal/transcript).
  `reschedule(id, runAfter)` → `queued` without spending an attempt (waiting for transcripts, GPU
  host asleep). A requeue that meets a newer queued job with the same key is `cancelled` instead.
- `expedite(key)` makes a queued job that waits for later due now (a finished transcript wakes
  the analysis waiting for it).
- `cancelQueued(key)` (a retracted audio capture cancels its transcription; a removed meal its
  analysis and transcriptions), `cancelRunning(id)` (running → cancelled: a run stopped because
  its meal was removed), `isOpen(key)` (queued or running) and
  `releaseInterrupted()`, which the server runs at startup: jobs a previous process left
  `running` count a failed attempt and are queued again.
- Producers: an audio capture (or voice planning input) enqueues `transcribe` (with its pending
  transcript, in the same transaction); `POST /api/meals/:id/analyse` sets the meal `queued` and
  enqueues `analyse`; a planning round (`…/suggest`, `…/more`) enqueues `plan`; the nightly
  schedule (`NightlyService.schedule`) keeps one `nightly` job queued at its next time. Adding
  captures to an `analysed`/`needs_input` meal does not queue it; the client calls analyse again.
  Both poke the worker (`services.queue.wake`) so it doesn't wait for its next poll.

**The worker loop** (`jobs/worker.ts`, `JobWorker`): one per server process, started by
`createServer({worker: true})` (`yamt start` does, unless `--no-worker`; tests and tools that
only need the API don't, so they never spawn an agent or an STT process). Handlers register by
job type with their own concurrency (`analyse`: 1; `plan`: 1; `nightly`: 1; `transcribe`: 1
batch; each lane runs alongside the others).
Every poll (1 s, or at once after `wake()`) fills each type's lane with `claim({types: [type]})`;
a batch handler (`runBatch`, `batchSize`) claims up to that many due jobs per slot and returns one
outcome each. The queue already keeps two jobs with the same key (one meal) from running together. A handler
returns `done`, `failed` (`retryable: false` fails at once), `reschedule` (no attempt spent) or
`cancelled` (no longer wanted); throwing counts as a retryable failure. `settled(job)` then sees
the job as it ended up (`done`, `queued`, `failed`, `cancelled`). `stop()` (server shutdown) aborts
the running handlers' signal and waits for them; an analysis or planning round requeues itself
without spending an attempt. `cancel(key, reason)` aborts the one running job with that dedupe key (and the batch it is
in) with a `JobCancelled` as the signal's reason; the services reach it as `services.queue.cancel`
(removing a meal, archiving a planning request).

## Nutrition layer (#7)

**The model reads, code computes.** The agent picks foods and grams; `computeTotals`
(`totals.ts` in `@yamt/shared`, re-exported by `nutrition/totals.ts`) is the only place totals come from: per-100 g values × grams, summed per
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
  answers, totals; earlier revisions; each revision's `kind`, `copy` for a meal logged again;
  `removedAt` for a removed meal, which can be read but not saved to), `search_foods` (its history
  counts no removed meal), `get_food`, `lookup_barcode`, `create_food`, `fetch_recipe`,
  `save_meal_revision` (returns the computed totals and the meal's status; 409 for a removed meal),
  `get_day_summary` (the meals of a date in the server's zone or a given one, removed ones left
  out, with their totals and the day's, the goal in force with `progress` per target — eaten, target, left, over
  — and the weight measured that day), `get_goals` (every goal newest first with the last day it
  held, `until`, and whether a same-day goal replaced it; and the one in force on a date), and for
  planning (#39) `get_plan` (the plan of a date range, default a week from today, as `GET /api/plan`
  with the projection's `progress` against the goal), `get_recipe`, `save_recipe` (an agent-made
  recipe with matched items, validated like revision items; returns the computed totals per portion
  and for the whole recipe), `plan_meal` (a recipe onto a date's slot with portions) and
  `unplan_meal`. `get_meal` names a meal's `plannedMealId` and marks a revision `kind: "plan"`. For
  planning rounds (#45, `planning/tools.ts`, [below](#the-suggestion-job-45)): `get_planning_context`,
  `match_ingredients`, `save_round_outline`, `save_suggestion`, `fail_suggestion`. Times go out as
  ISO 8601 with the zone's offset.
- **Scopes** (`allowed`, `callTool`): `meal` tools take a `mealId` an analysis run's token must
  match, `plan` tools a `roundId` a planning run's token must match, `food` tools (`search_foods`,
  `get_food`, `lookup_barcode`, `create_food`, `fetch_recipe`, `match_ingredients`) are open to
  every token, `interactive` tools only to the interactive token, which may use them all.
- **Tokens** (`mcp/tokens.ts`, `services.mcpTokens`): `yamt_` + 256 random bits, compared as
  SHA-256 hashes.
  - *Interactive:* one long-lived token in `<data>/mcp-token` (0600), created at the first start
    or by `yamt mcp-token`; `--rotate` replaces it (a running server notices the new file). The
    repo's `.mcp.json` points Claude Code at `http://127.0.0.1:${YAMT_PORT:-7890}/mcp` with
    `Bearer ${YAMT_MCP_TOKEN:-}`; the token itself is never in the repo. Full access.
  - *Per run:* `mintRun({runId, mealId, ttlMs})` → a token scoped to one meal, in memory only
    (runs don't outlive the server), revoked by `revokeRun(runId)` and expiring after 2 h
    regardless. A run token sees `get_meal`/`save_meal_revision` for its meal only, the food tools,
    and none of the `interactive` ones (`get_day_summary`, `get_goals`, the plan and recipe tools)
    or the `plan` ones; the revision it saves records its `run_id`, and a second
    `save_meal_revision` with the same run token is refused (a run saves exactly one).
  - *Per planning run* (#45): `mintPlanRun({runId, roundId})`, the same lifetime: the `plan` tools
    of its round only, the food tools, no meal tools (`create_food` takes no `captureId` from it).
    Revoked when the run ends and at once when its request is archived.

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
   start fails the interrupted run and requeues or fails its meal (`settleMeal`). Removing the
   meal stops the run (see [Removing a meal](#removing-a-meal)): the run and the job end
   `cancelled`, without a revision and without a retry, and `settleMeal` leaves a removed meal alone.
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

Which harness runs yamt's agent work (the analysis; planning rounds have their own line, below),
which model and which reasoning effort. Settings → Agent sets them; nothing about the options is
hard-coded.

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
- **The planning agent** (#45, `resolvePlanningAgent`, `AgentService.forPlanning`), resolved the
  same way per value: env (`YAMT_PLANNING_HARNESS`, `_MODEL`, `_EFFORT`) > the app's planning
  setting (`settings` key `planning-agent`, `{harness, model, effort}`; #46 adds it to Settings →
  Agent) > config.json `planning` (`harness`, `model`, `effort`) > built-in defaults: Claude Code,
  and for it `claude-opus-5-5` at effort `medium` (spike #38: `low` skipped research and ignored
  the source mode; Sonnet 5 took 2.3× as long for the same cost). Harness command lines are the
  analysis's (`analysis.command` / `YAMT_ANALYSIS_COMMAND` for the harness they name), so a
  `custom` planning harness is the analysis's custom one. `yamt start` prints both lines.
- **Harnesses found here**: Claude Code when its adapter resolves (node or Bun), OpenCode when
  `opencode` is on PATH, custom when configured; the others are listed as not available.
- **API**: `GET /api/agent` (the analysis's three values with `source` `env` | `app` | `config` |
  `default` and the env var, the harnesses, and `planning` (#46): the same shape for the planning
  agent), `GET /api/agent/options?harness&model&refresh=1` (discovered models and efforts,
  flattened with labels; 503 with `hint` `not_installed` | `auth` | `error`), `PUT /api/agent`
  (`{harness, model, effort}`: the harness must be here, the model offered, the effort offered for
  the model that will run; what the env fixes is kept as it was) and `PUT /api/agent/planning`,
  checked and saved the same way under the `planning-agent` key (`AgentService.saveLayer`, shared
  by both).
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
Planning runs (#45) write the same trace in the same place (`run.start` names the round and the
request, `run.end` the ready suggestions and the round's status); the route serves both kinds,
and `GET /api/planning/runs/:id` the planning run's row (`PlanningRun`).

## Transcription (#9)

Every audio capture gets a German transcript in the background; it unblocks the meal's analysis.
Spike #4 (phase 1) picked the setup ([ADR 0002](adr/0002-speech-to-text-on-the-cpu.md)): **faster-whisper large-v3-turbo, int8, `de`, on this VM's
CPU** (3.2 % WER on FLEURS German, real-time factor ~0.2, ~1.7 GB RAM, ~5 s model load); the GPU
host stays a possible second backend.

**The `transcribe` job** (`transcription/job.ts`, `TranscribeJob`), created with the capture and
its `pending` transcript (#6), or with a voice planning input and its `pending` row in
`planning_transcripts` (#44: payload `{inputId}`; same backend, same batches, the input's media
read the same way). Due jobs run as one **batch**, one batch at a time (the analysis
runs alongside):

1. For each job: the capture must exist, be audio and not retracted (else failed at once).
   **ffmpeg** reads the original (never written) and writes a 16 kHz mono 16-bit PCM WAV into a
   fresh temp dir (`normaliseArgs`: first audio stream only, no video, cover art or metadata;
   iOS `audio/mp4` and `.m4a`, WebM, Ogg, MP3, WAV all work). ffmpeg refusing the file fails the
   job at once (a broken file stays broken).
2. The WAVs go to the **STT backend** in one call (`SttBackend`, `transcription/backend.ts`);
   results arrive one by one, and each is written right away: `done` with text, model
   (`faster-whisper large-v3-turbo int8`), language, duration, segments, wall time and the
   settings. Then `nudgeWaiting` makes a waiting `analyse` job of the meal due (for a planning
   input that is in a round: the request's `plan` job) and wakes the worker. A result for a capture whose re-run is already queued is dropped (the re-run wins).
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
- **Log again** (#30, see [Log again](#log-again-30)): `POST /api/meals/:id/repeat` (`{id?, factor,
  eatenAt, tz?}`; factor 0.1–10, the app offers 0.5 / 1 / 1.5 / 2; 201 with `{meal, revision}`,
  200 for a known id, 409 without a finished analysis), `GET /api/meals/repeatable?days&limit`.
  `GET /api/meals/:id` carries `source` (`{mealId, title, eatenAt}` of the meal it was logged
  again from, as that is now) and every meal `sourceMealId`.
- `POST /api/captures/:id/transcribe`: re-run an audio capture's transcript (400 for other kinds,
  409 when retracted); answers the `pending` transcript and the job id.
- **Removing a meal** (see [Removing a meal](#removing-a-meal)): `POST /api/meals/:id/remove`
  (`RemoveMealResponse`: the meal with `removedAt`, `stoppedAnalysis`) and `POST
  /api/meals/:id/restore` (`RestoreMealResponse`), no body, both idempotent. Every meal carries
  `removedAt`. Every other write to a removed meal (captures, analyse, PATCH, repeat from it,
  retract, transcribe) is a 409 "the meal was removed"; a capture retried with an id that is
  already stored is still answered (200). Reads (`GET /api/meals/:id`, its revisions, media) work.
- `GET /api/meals/:id` also lists the meal's analysis runs (`runs`, newest first); a revision's
  `runId` names its run. `GET /api/runs/:id` (the run), `GET /api/runs/:id/trace` (NDJSON, an
  analysis or a planning run's), `GET /api/planning/runs/:id` (a planning run, #45; a round's
  `runId` names its current or last one).
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
- `GET /api/months/:month?tz` (#33, `calendarPaths`; `YYYY-MM`, else 400): see
  [Calendar](#calendar-33).
- **Planning** (#39, `planningPaths`): `GET /api/plan?from&to&tz`, `GET /api/recipes/:id`, `POST
  /api/planned-meals`, `GET` / `PATCH` / `DELETE /api/planned-meals/:id`, `POST
  /api/planned-meals/:id/skip` / `unskip` / `log`: see [Planning](#planning-36).
- **Planning requests** (#44, `planningRequestPaths`): `GET` / `POST /api/planning/requests`,
  `GET /api/planning/requests/:id`, `POST …/:id/archive` / `unarchive` / `inputs` / `suggest` /
  `more`, `POST /api/planning/inputs/:id/retract`, `POST /api/planning/suggestions/:id/pick` /
  `reject` / `unreject`, `GET /api/planning/media/:inputId[/jpeg]`: see
  [Planning requests](#planning-requests-44).
- **The nightly run** (#48, `planningNightlyPaths`): `GET /api/planning/nightly`, `POST
  /api/planning/nightly/regenerate`: see [The nightly run](#the-nightly-run-48).
- **Leftovers and the shopping list** (#49, `leftoverPaths`, `shoppingPaths`): `GET` / `POST
  /api/leftovers`, `PATCH /api/leftovers/:id`, `POST /api/leftovers/:id/plan`, `GET /api/shopping`,
  `POST /api/shopping/check`, `POST /api/shopping/lines`, `DELETE /api/shopping/lines/:id`: see
  [Leftovers and the shopping list](#leftovers-and-the-shopping-list-49).

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

## Log again (#30)

The same cappuccino again, without another analysis: an analysed meal is copied into a new meal
at a new time. "The model reads, code computes" holds trivially: no model is involved at all.

- **The copy** (`MealService.repeat`, `POST /api/meals/:id/repeat`): the source's *current*
  revision must be a finished one (`analysed`, with items; a preliminary `needs_input` one or none
  is a 409). In one transaction: a new meal (`source_meal_id`, `eatenAt` pinned as `user`, since
  it has no captures that could set it) and its revision 1, `kind` `copy`, no run, no questions:
  the same items with their foods, descriptions, provenance, confidence, notes and per-100 g
  snapshots (the numbers the source was saved with, whatever the food holds now), grams × the
  factor (to 0.01 g), title and summary as they were, the assumptions plus "Logged again from
  <title> (<Tue 3 Nov>, the phone's zone), × 1.5". The meal is `analysed` at once; its totals come
  from `computeTotals` over the copied items like any others, and the overview, the day view and
  the day totals count it like any analysed meal. Copying a copy is fine (it names the copy).
- **Idempotent** with a client `id` like other creates: the same id again answers the stored copy
  (200); an id of a meal that isn't a copy of this source is a 409. The web app makes the id when
  the sheet opens.
- **No queue, no notification:** it is one request, not a capture, so it doesn't go through the
  upload queue; offline it fails and the sheet says so. Nothing runs, so `notifyMeal` is never
  called for it.
- **Later changes work as usual:** a copy has no captures, so analyse refuses it (409) until the
  user adds one (a capture or a correction); then re-analysis starts from the copy like from any
  revision. `get_meal` marks the revision `kind: "copy"`, and the log-meal skill says what that
  means (everything captured is new; the copy is the starting point).
- **What to log again** (`MealService.repeatable`, `GET /api/meals/repeatable?days=30&limit=5`):
  meals eaten in the last `days` days (none from the future) whose current revision is analysed,
  grouped by title (case and spacing aside), each title's latest meal with its totals and how often
  the title was logged (copies count), the most often first, then the most recent.

## Removing a meal

A meal logged by mistake (a duplicate, a test, the wrong day) can be removed and the removal
undone. Raw first (ADR 0001, 5) holds: nothing is deleted.

- **Soft:** `meals.removed_at`. Captures, media files, revisions, items, questions, runs and traces
  stay as they are. A removed meal is left out of the meal list and the overview's day totals, the
  day view and its totals, the calendar's month, Log again (as a candidate, and as a source: 409),
  the share target's current draft, `get_day_summary` and the food search's personal history (the
  repositories' queries carry `removed_at IS NULL`; `MealRepo.get` alone sees every meal).
- **Writes** to a removed meal but a restore are refused (409) in `MealService` and in
  `RevisionService.save` (so `save_meal_revision` too); two insert triggers back that up in SQL.
- **A queued analysis** is cancelled (`cancelQueued`), and so are the queued transcriptions of
  its voice captures. **A running one** loses its run token at once (`revokeRun`: a late
  `save_meal_revision` gets a 401) and its job is aborted (`JobWorker.cancel`); the harness gets
  `session/cancel`, the run ends `cancelled` ("cancelled: the meal was removed"), the job
  `cancelled`, without a retry. A job that comes up later for a removed meal (one an earlier
  process left) is cancelled before it starts a run. A running transcription batch finishes.
- **Where the meal stands:** a meal that was `queued` or `analysing` is put back where that
  analysis started: its current revision's status (`analysed`, `needs_input`), or `draft` without
  one. Any other status (including `failed` with its error) is kept.
- **Restore** clears `removed_at`; the meal is back exactly as it stood while removed (status,
  current revision, time). Transcriptions the removal cancelled are queued again (their
  transcripts were left `pending`); a stopped analysis is not: the user presses Analyse (a run costs
  money and quota). Restoring a draft bumps `updated_at`, so it can be the share target again.
- **A meal logged from the plan** (#39): removing it puts its planned meal back to `planned`
  (`logged_meal_id` cleared), so the plan counts it as planned again and "Ate it" works again;
  restoring it marks the planned meal `logged` again if it is still `planned` (else the meal stays
  one of its own).
- **No notification** for a removed meal (`notifyMeal`).
- **The phone:** the meal's screen (detail or capture view) ends with a "Remove meal" row with an
  inline confirm; it posts the removal (one request, not through the upload queue: offline it
  says so) and opens the meal's day with an undo strip (`?removed=<id>`). Captures of the meal still
  in the upload queue hold the removal (they would be refused, 409, and turn orange): the row says
  to wait for them or discard them. A queued analyse request of the meal is dropped from the queue
  with the removal. A removed meal opened directly shows what it was with Restore.

## Calendar (#33)

A month at a glance: which days were tracked and how each day and week sat against the goal in
force. Design: spike #31's direction D · Plan ([design.md](design/design.md#component-patterns)).

- **The classifier** (`plan.ts` in `@yamt/shared`, pure, tested there): a day's kcal against the
  kcal target in force that day. The **on-plan range** depends on the goal's kind, asymmetric so
  the helpful direction has more room: cut −15 % … +5 %, maintain ±10 %, bulk −5 % … +15 %
  (`ON_PLAN`). Outside it a day is **just off** within ±25 % (`FAR_OFF`), else **far off**. The
  **direction** (over / under) is a fact outside a ±5 % dead zone (`DEAD_ZONE`). **Too low**: under
  the goal's calorie floor, or on a cut more than 25 % under (`TOO_LOW_ON_CUT`). A **week** is the
  mean of its counted days' shares of their own targets (so a goal change mid-week averages
  cleanly), judged by the goal in force on its last counted day; it shows its count below four
  days (`WEEK_FULL_DAYS`). Days without a goal, or a goal without a kcal target, aren't classified.
  Every threshold is a named constant, to be tuned later.
- **A goal's kind, label and floor** (`goalPlan`): a guided goal (#24) takes its kind from the
  derivation's choice and its floor from the calculation (`result.kcal.floor`: 1,500 / 1,200 kcal,
  and for a cut at least the resting energy). Targets set by hand have no kind: they are read with
  the maintain range, labelled "Manual targets" (or their note), and take the floor yamt would set
  for the profile's sex; without a profile there is no too-low mark from a floor.
- **`GET /api/months/:month?tz`** (`CalendarService`, `domain/calendar.ts`): the month's days in
  the phone's zone, plus the days of the neighbouring months that complete its first and last
  week (Monday first). One pass per month: the meals (`MealRepo.tallyBetween`: time, current
  revision, live captures), their current revisions' items (`RevisionRepo.currentItemsBetween`),
  the weight entries from a week before the 1st, the goals and the profile, each read once. Per
  day (as the day view counts, #12): `meals` (a draft with nothing captured is no meal; a copy,
  #30, is one), `unanalysed`, `totals` over the analysed meals by `computeTotals` (null when none
  counts), the goal in force as a `PlanGoal` (targets, kind, label, floor) and the day's mean
  weight. Per week its seven classifier inputs (`dayInput`: null for a day with nothing counted
  or after today). The summary over the days so far: days tracked, the mean kcal and protein over
  the days with totals, the mean kcal share of each day's own target, the goal in force on the
  last day. The weight: per day with entries the day's mean and the 7-day average
  (`dailyWeights`, the same as the goals screen's trend).
- **The screen** (`/calendar?month&day`): see [Screens](#screens-10-11-12-13-24-30-33-40-47-49). The web
  app classifies with the same shared functions; the server sends inputs, not verdicts.

## Planning (#36)

Planning meals on the phone (epic #36, [ADR 0003](adr/0003-meal-planning.md)). #39 is the data
underneath: recipes, planned meals, the plan and "Ate it", with interactive MCP tools as the side
door. Planning requests, rounds and suggestions (#44, [below](#planning-requests-44)) build on it,
the suggestion job (#45, [below](#the-suggestion-job-45)) fills the rounds, Settings → Planning
(#46, [below](#planning-settings-46)) holds the defaults and preferences both of them read, and the
nightly run (#48, [below](#the-nightly-run-48)) prepares today's suggestions and the starters
without being asked; leftovers and the shopping list (#49,
[below](#leftovers-and-the-shopping-list-49)) close the loop.

- **Recipes** (`RecipeService`, `domain/recipes.ts`): saved with items matched to foods
  (`resolveItems`, the same validation as `RevisionService.save`: a food with an energy value, or
  `estimatePer100g` for a pure estimate that can't claim `database` / `label`), the food's per-100 g
  numbers copied. A `published` or `adapted` recipe names its source (URL or name); only an
  `adapted` one lists `changes`; the total time includes the active time. Insert-only. **One portion**
  is each item's grams ÷ `servings` (`portionItems`, to 0.01 g); totals per portion and for the
  whole recipe come from `computeTotals` whenever the recipe is read. Macros never come from a
  recipe page.
- **Planned meals** (`PlanningService`, `domain/planning.ts`): a recipe on a date's slot, at the
  slot's end, with `portionsCooked` (1–20; later the shopping list's amount) and `portionEaten`
  (0.1–10, what the plan counts: one portion × it). Idempotent creates with a client `id` (200
  with the stored one; an id of a planned meal of another recipe is a 409). While `planned` it can
  be moved (a new date or slot: to its end unless `position` says where; the slots it touches are
  renumbered 0, 1, …), reordered, re-portioned, skipped and unplanned (deleted); a `skipped` one
  can only be unskipped, a `logged` one is history (409).
- **"Ate it"** (`PlanningService.log`, `POST /api/planned-meals/:id/log` `{id?, eatenAt,
  portionEaten?, excludeItemIds}`), the #30 copy mechanism: in one transaction a new meal
  (`source_planned_meal_id`, `eatenAt` pinned as `user`) with revision 1 of kind `plan`, no run, no
  questions: the recipe's items minus the excluded ones (unknown ids and excluding everything are a
  400), grams = one portion × `portionEaten` (default the planned meal's; to 0.01 g, the same
  rounding the plan uses, so the logged meal's totals are exactly what the plan counted), the
  per-100 g snapshots as stored, title and summary from the recipe, and assumptions in English:
  "Logged from the plan: Kürbis-Curry, 1 of 2 portions, without Feta" and, for a recipe of more
  than one serving, that the descriptions are for the whole recipe. The planned meal becomes
  `logged` with `logged_meal_id` and the portion eaten. Idempotent with the new meal's client `id`
  (200; an id of a meal not from this planned meal is a 409); a second log with a fresh id is a
  409. No queue, no notification (like Log again); offline it fails. Later changes go through
  captures and re-analysis as with a copy; the log-meal skill says what a `plan` revision means.
- **`GET /api/plan?from&to&tz`** (`PlanningService.plan`; `from` ≤ `to`, at most
  `MAX_PLAN_DAYS` = 31 days, else 400): one pass over the planned meals of the dates (with their
  recipes and items), the meals eaten in the days' range in the phone's zone and their current
  revisions' items, and the goals. Per day: `plannedMeals` (every status, by slot then position,
  each with `perPortion` and `eaten` totals), `meals` (removed ones and empty drafts left out; each
  with the slot it fills), `eaten` (over the analysed meals, as the day view counts; null when none
  counts), `projected` (eaten + the planned meals still `planned`; logged ones count through their
  meal, skipped ones not at all; null when there is neither), the goal in force as a `PlanGoal`
  (`goalsByDate`, shared with the calendar), `openSlots` (main slots with nothing eaten or still
  planned) and `mostlyKnown`: a past day, or one with breakfast, lunch and dinner each eaten or
  planned (snacks optional). An eaten meal's slot is its planned meal's when logged from the plan,
  else its local time's (`slotOf`: from 4, 11 and 16 o'clock; before 4 a snack), and an analysed one
  under `SNACK_KCAL` (150) is a snack whatever the time. The web app classifies `projected` with
  the calendar's functions (`dayInput`, `classifyDay`) only when the day is mostly known, else it
  shows "rest open"; the server sends inputs, not verdicts.
- **`GET /api/planned-meals/:id`** (#40): one planned meal in any status, with its numbers.
- **The phone** (#40): the plan view, a planned meal's recipe, the Ate-it and Plan-for sheets, the
  planned rows on the overview and the day view and the split Log | Plan slab; planning requests
  (#47): the entry screen with its starters, the filter page, the composer, the request thread and a
  suggestion's recipe, and the overview's Planning strip: see
  [Screens](#screens-10-11-12-13-24-30-33-40-47-49). It reads the plan with the calendar's functions and
  previews "Ate it" with the shared `computeTotals`; the server's numbers are the ones saved.
- **`GET /api/recipes/:id`**: the recipe with its items (grams and nutrients for the whole recipe
  and per portion, the matched food or the estimate), `perPortion` and `whole` totals, steps,
  times, source and changes.
- **MCP** (`interactive` scope only): `get_plan`, `get_recipe`, `save_recipe`, `plan_meal`,
  `unplan_meal` (see [MCP server](#mcp-server)), so a Claude Code session can fill the plan before
  the phone's planning flow exists. The batch ingredient matcher and the suggestion tools are
  #45's ([below](#the-suggestion-job-45)).

### Planning requests (#44)

What the user asks for and what comes back (`PlanningRequestService`,
`domain/planning-requests.ts`; contracts in `api-planning-requests.ts`). The `plan` job that fills
a round is [below](#the-suggestion-job-45).

- **A request** (`POST /api/planning/requests` `{id?, filters?, text?, tz?}`, idempotent with a
  client id): structured `filters` (`days` as local dates in `tz`, `slots`, `timeCapMin`,
  `constraints` (`PLANNING_CONSTRAINTS` ids or free strings), `useUp` (`{leftoverId}` or `{text}`),
  `sourceMode`, `portionsCooked`, `count`), stored **complete**: what is missing comes from
  `requestDefaults` — `PLANNING_DEFAULTS` (tonight's dinner, time cap, constraints, use-up) with
  Settings → Planning's `count`, `sourceMode` and `portionsCooked` laid over it (`planningSettings`,
  #46; its own defaults — 3, `adapted`, 1 — until something is saved) — and today in `tz` (days
  before today are a 400, a span over `MAX_PLAN_DAYS` too). The title is code's (`requestTitle`:
  "Dinners Tue–Thu", "Lunch and dinner Fri", dates once the days span a week; weekdays rather than
  "tonight" so it stays true), until an outline names one. `text` becomes the first input. `origin`
  is `user`, or `nightly` for one the nightly run made (#48, [below](#the-nightly-run-48)).
- **Inputs** (`POST …/:id/inputs`: multipart `file` + `id`, `kind` (audio, image, file),
  `capturedAt`, or JSON `text` / `link`): stored like captures through the same code (`storeUpload`:
  sniffing, the original byte for byte, EXIF time, a JPEG for HEIC), idempotent with a client id
  (an id of another request's input is a 409), immutable, retracted softly (`POST
  /api/planning/inputs/:id/retract`, idempotent; a voice one's queued transcription is cancelled).
  A voice input gets a `pending` row in `planning_transcripts` and a `transcribe {inputId}` job.
  Media: `GET /api/planning/media/:inputId[/jpeg]`, served like captures' (ranges, ETag, nosniff,
  the sandboxing CSP).
- **Rounds**: `POST …/:id/suggest` starts the first round, or a `steer` round when live inputs
  arrived since the last one (409 "nothing new" otherwise); `POST …/:id/more` another round with
  the same input (`more`; with new inputs it steers with them; 409 before the first round). Either
  takes `{id?}` (the round's client id: a retry answers that round with 200). The new round
  (`queued`, `count` from the filters) takes every live input that is in no round yet
  (`round_id`, set once): an input that arrives while a round is queued or running belongs to the
  next one. It enqueues `plan {roundId}` under `plan:<request>`. One open round per request: a
  second while one is queued or running is a 409 (and a partial unique index refuses it).
- **The agent's side** (what #45's job and tools call): `startRound`
  (`queued` → `running`, with the run), `saveOutline` (exactly `count` ideas, each with title,
  approach, source mode and URL, proposed date and slot, saved as `outlined` suggestions 0, 1, …;
  an earlier outline is replaced while none of it is ready; `requestTitle` renames the request),
  `saveSuggestion` (the recipe saved through `RecipeService.save`, the idea `ready` with the
  recipe's title and source and up to four why-lines; a second save of the position replaces it
  unless the user gave a verdict), `failSuggestion` (an idea not ready, with the reason),
  `finishRound` (≥ 1 ready: `done`, the ideas still outlined `failed` "didn't complete"; none: null,
  nothing changes), `failRound`, `requeueRound` (a retry or a server stop). Only a `running` round
  of an open request takes writes.
- **Picking** (`POST /api/planning/suggestions/:id/pick` `{id?, date?, slot?, portionsCooked?,
  portionEaten?}`): a planned meal of the suggestion's recipe naming the suggestion
  (`suggestion_id`), on the given day and slot, else the proposed ones (a past day doesn't count),
  else the first of the request's days from today on and its slots that is still open (`openSlots`
  of the plan; for snacks: nothing planned), keeping a proposed slot; portions cooked default to the
  request's, the portion eaten to 1. The suggestion becomes `picked` with its planned meal.
  Idempotent with the planned meal's client id; picking a picked one again is a 409 (change the
  planned meal instead), a rejected one too ("unreject it first"), and only `ready` ones can be
  picked. **Unplanning** that planned meal (#39's `DELETE`) clears the pick. `…/reject` ("No")
  and `…/unreject` are idempotent; a picked one can't be rejected.
- **The thread** (`GET /api/planning/requests/:id`, `PlanningRequestDetail`): the request, every
  input (retracted ones flagged) with `roundId`, the transcripts, the rounds oldest first with
  their suggestions by position, and `pendingInputs`. Each ready suggestion carries its recipe
  (without items: `GET /api/recipes/:id`), its per-portion totals and **the fit**, computed live:
  its day (the proposed one, or its planned meal's once picked) from `PlanningService.plan` in the
  request's zone, `before` (the day's projection: eaten + planned), `with` (+ one portion; a pick
  whose planned meal isn't skipped is in the projection already and isn't counted twice), the goal,
  `progress` per target, `kcalLeft` and `proteinOpen` (target − `with`). Code computes all of it.
- **The list** (`GET /api/planning/requests`): the open requests, newest first, each with its
  latest round counted (`outlined`, `ready`, `failed`, `picked`, `rejected`: "2 of 3 ready") and
  its live and pending inputs, for the overview strip and the entry screen.
- **Archiving** (`POST …/:id/archive`, `…/unarchive`, idempotent): out of the list. An open round
  fails ("the planning request was archived", its ideas not yet ready too), its queued `plan` job
  is cancelled and a running one aborted (its run token revoked at once, so a late save can't
  land). An archived request is still readable; every write but an unarchive is a 409.

### The suggestion job (#45)

The agent fills a round in the background: outline first, then each suggestion as soon as it is
done, every ingredient matched to real foods, code computing the numbers; a push when the round
ends. Spike #38's numbers shaped it ([ADR 0003](adr/0003-meal-planning.md), 11–15).

- **The job** (`PlanJob`, `planning/job.ts`; `plan {roundId}`, its own lane next to `analyse` and
  `transcribe`, concurrency 1). Per attempt:
  1. A voice input of the round with a `pending` transcript reschedules it 15 s later without
     spending an attempt; the finished transcript makes it due at once (`nudgeWaiting`). A failed
     transcript doesn't block: the prompt names it.
  2. A `planning_runs` row, `<data>/runs/<run id>/` (cwd and trace), the round `running` with the
     run (`startRound`), a run token scoped to the round (`mintPlanRun`).
  3. The turn (`runPrompt`): the planning agent (`AgentService.forPlanning`, read per run; model
     before effort from the session's `configOptions`, as for analysis), the plan-meals skill as the
     appended system prompt, the yamt MCP server with the run token, web search and fetch, reading
     the request's photos and files, and the prompt (`planning/prompt.ts`: the round, its number,
     kind and request title, "attempt n of 3", how to continue an interrupted outline, the photos
     as image blocks or paths). The turn is capped at `planTurnMs(count)`: 2 min per suggestion +
     1 min, at most 15; the idle timeouts are the analysis's (3 min, 5 with a tool open).
  4. **The verdict**: at least one `ready` suggestion → `finishRound` (`done`, ideas left
     `outlined` fail "didn't complete"), whatever happened after (a crash after the first save
     still counts; the run's `error` says what followed). None → the attempt fails with the reason
     ("the agent ended its turn without saving a suggestion (end_turn); it said: …", a timeout, a
     crash) and the queue retries after 30 s and 2 min (3 attempts; the next outline replaces the
     failed one's); a missing harness or login fails at once. An archived request stops the run
     (`cancelled`; the archive failed the round). A server stop requeues it without spending an
     attempt; ready suggestions stay, and the next run is told to keep the outline and complete the
     ideas still outlined.
- **Settling** (`settleRound`, from `PlanJob.settled` and at startup after `releaseInterrupted`):
  a round is never left `running` without a run. A job back in the queue (retry, reschedule, a
  crash's interrupted attempt) puts a running round back to `queued` with the reason; a job that
  failed for good, or was cancelled while the round was open, fails the round with the error.
- **Tools** (`planning/tools.ts`; scope `plan` unless said otherwise; the interactive token may use
  them too, writes only on a `running` round):
  - `get_planning_context {roundId}` (`planning/context.ts`): the request (title, complete
    filters), every live input (text, link, transcript, photo or file with its local path, the
    round it came with, `newThisRound` for a steer's), this round (number, kind, count, what an
    earlier attempt outlined), the earlier rounds with their suggestions (status, title, approach,
    source, why, failure, **the user's verdict**, per-portion kcal and protein, main ingredients),
    each requested day (meals eaten with their slot, meals planned, eaten, projected, open slots)
    with **a budget per requested slot** (`slotBudget`), the goal in force, the analysed meals of
    the last 14 days with their main items (variety), `leftovers` (the open ones, #49: what, how
    much, a cooked one's portions not planned yet; the request's `useUp` ids named) and
    `preferences` (#46's Settings → Planning setting, `planningPreferences`: dislikes, never eat,
    equipment, weekday cooking time, favourite sites; its defaults — all empty — until saved).
  - `match_ingredients` (scope `food`) `{ingredients (≤ 30: name, grams for the whole recipe, state
    raw|dry|cooked|canned|as_sold, kind generic|product, query?, fdcQuery?), servings, slot?,
    roundId?, candidates?}` (`planning/matcher.ts`), every ingredient in parallel: the user's
    **history** first (a strong hit, score ≥ 1.5, complete, plausible, the right state, ends it),
    then **every cached food** (`FoodRepo.searchCached`, FTS over `foods`, no network; a strong
    hit ≥ 1.2 ends it), then **USDA** for a `generic` ingredient with an `fdcQuery`, **Open Food
    Facts** for a `product` (or without FDC), the other one if the first found nothing. Ranked by
    `scoreCandidate`, then adjusted (`MATCH_ADJUST`): a state word in the name against the
    ingredient's state −0.4, the right one +0.1, a processed-product word ("granuliert", "Salsa",
    "Chips", …) the ingredient doesn't use −0.35 for a plain ingredient, no fibre −0.05. Per
    ingredient: the sources asked, ranked candidates (food id, name, brand, `foundIn`, core per
    100 g, what the grams come to, state and processed words, `missing` values, score) and
    warnings (wrong state, processed, energy that doesn't add up to 4P + 4C + 9F + 2 fibre within
    25 %, no energy); plus one portion with every first candidate (`computeTotals`) and, with a
    slot, its `fitToSlot` and what the day has open after it. The agent still picks.
  - `save_round_outline {roundId, ideas: [{title, approach, sourceMode, sourceUrl?, proposedDate,
    proposedSlot}], requestTitle?}`: exactly the round's count (`saveOutline`), no day in the past.
  - `save_suggestion {roundId, position, title, summary, why[] (≤ 4), sourceMode, sourceUrl?,
    sourceName?, changes[], servings, timeActiveMin?, timeTotalMin, steps[], notes?, items
    (food or estimate, grams for the whole recipe, provenance, confidence, note?, optional?),
    proposedDate?, proposedSlot?}`: the recipe (validated like `save_recipe`) and the idea `ready`
    (`saveSuggestion`; the same position again replaces it). Returns the per-portion totals, the
    day with it (kcal left, protein open), the slot's budget and `fitToSlot`, how many items are
    estimates, a warning over the request's time cap, and what to do next.
  - `fail_suggestion {roundId, position, reason}`: an idea given up, with the reason the user reads.
  - `note_leftover {roundId?, position?, description, quantity?, grams?, foodId?, note?}` (#49): a
    pack remainder ("½ Hokkaido") a suggestion leaves over, with its `position`: listed once a
    planned meal of that suggestion is logged; without one (a fridge photo) at once. The same
    description for the same round and suggestion replaces the earlier note. An interactive session
    may leave out the round.
  - `save_starters {roundId, starters (4–6)}`: a nightly round's starters (#48,
    [below](#the-nightly-run-48)).
- **The slot budget** (`planning/budget.ts`, `slotBudget`): per target, what is open (target −
  projected, never below 0), minus room for a snack while none is eaten or planned that day
  (`SNACK_RESERVE_SHARE`, 10 % of the target), shared by weight (`SLOT_WEIGHTS`, breakfast 25,
  lunch 35, dinner 35) between the main slots still open, this one included, and **capped at
  `MAIN_MEAL_MAX_SHARE` (42 %) of the day's target** (a snack at `SNACK_MAX_SHARE`, 15 %). A
  ceiling for one portion, not a target: spike #38's worst problem was portions sized to all that
  was still open. Without a goal there is none.
- **The plan-meals skill** (`.agents/skills/plan-meals/SKILL.md`): how a round is planned, the
  counterpart of log-meal and the one place to change planning behaviour. Read at the start of
  every run (frontmatter stripped) and appended to the system prompt; interactive sessions find it
  as a skill. It covers reading the text against the filters (the text wins, which slots),
  realistic portions (the budget as a ceiling, what a plate carries), variety by dish type across
  recent meals and earlier rounds, steering from earlier rounds and verdicts, the outline and its
  discipline, the source modes and their fallbacks (a dead link → the next hit; nothing usable →
  say so or fail the idea), one `match_ingredients` call per recipe, grounding by reference to
  log-meal (state, fats and oils), German titles like meal titles, and short factual why-lines
  with numbers only from the tools.
- **Push**: `PlanJob.settled` calls `notifyPlan` once the job is `done` or `failed` for good (and
  the server at startup for one that failed while none ran); see [Notifications](#notifications-13).
  A nightly request's first round sends none (#48).
- **Fakes**: `test/fake-agent.ts` plays planning rounds when the prompt names one, scripted by the
  request's last `fake:plan…` text (`plan`, `plan-match`, `plan-partial`, `plan-none`, `plan-once`,
  `plan-slow:<ms>`, `plan-crash`, `plan-hang`, `plan-auth`; see its header); a nightly round (no
  text) by `FAKE_ACP_NIGHTLY`, and it saves four made-up starters (#48). The e2e server runs
  planning on it too (`YAMT_PLANNING_HARNESS=custom`; nightly rounds `plan-slow:2500`).

### Planning settings (#46)

Settings → Planning: the defaults a new request's filters fall back to, and the preferences the
plan-meals skill reads. One setting (`domain/planning-settings.ts`, key `planning`), a whole
replace like the Agent setting.

- **`PlanningSettingsBody`** (`api-planning-settings.ts`): `count` (suggestions per round, 2–5,
  default 3), `sourceMode` (default `adapted`), `portionsCooked` (1–4, default 1) — narrower than
  a request's own filters, which may still ask for more or fewer — and `preferences`: `dislikes`,
  `neverEat`, `equipment`, `favouriteSites` (string lists, one line each) and
  `weekdayCookingMin` (5–240 minutes, or no limit). Preferences are personal data: the database
  only, never the repo or a log.
- **`GET`/`PUT /api/planning/settings`**: the saved settings, or `DEFAULT_PLANNING_SETTINGS` until
  something is saved; a PUT is a whole replace, zod-validated like every other write.
- **Applying**: `requestDefaults` (`domain/planning-requests.ts`) layers `count`, `sourceMode` and
  `portionsCooked` over `PLANNING_DEFAULTS` for a new request's `resolveFilters`; `preferences`
  reaches the agent through `planningPreferences` → `get_planning_context` (above). `nightly`
  (#48: `enabled`, default off; `time`, `HH:MM` in the server's zone, default 03:00; `count`, 1–5,
  default 3) drives the nightly run ([below](#the-nightly-run-48)); a value saved before it existed
  gets its defaults (`planningSettings`), and a PUT reschedules the run at once.
- **The skill** (`.agents/skills/plan-meals/SKILL.md`): `neverEat` is a hard rule (a suggestion
  with one is wrong), as is missing `equipment` and, on a weekday, `weekdayCookingMin` as a second
  time cap; `dislikes` are avoided and `favouriteSites` are looked at first for a real recipe.
- **Settings → Agent** gets a second line, **planning**: model and effort (and, matching
  `AgentSettingsBody`, the harness), defaulting to "Opus 5.5 · medium" as `resolvePlanningAgent`
  does (not "same as analysis": #45 and spike #38 settled on Opus medium for planning
  specifically). `GET /api/agent` grows a `planning` part (the same shape, its own `harnesses`);
  `PUT /api/agent/planning` saves it under the `planning-agent` key, checked against what the
  harness offers the same way as the analysis line (`AgentService.saveLayer`, shared by both
  `save` and `savePlanning`).
- **The phone** (`components/planning-settings.tsx`, `components/agent-settings.tsx`): a second
  "Agent" strip for the planning line (the same harness/model/effort UI, parameterised by an `id`
  so its test ids don't clash with the analysis line's), and a **Planning** section with a
  stepper for the count, choice rows for the source mode, a stepper for portions, and a
  preferences list whose rows open a small sheet (a text field, one line each; a number field for
  the cooking time).

### The nightly run (#48)

Every morning there are fresh, complete suggestions for today and starters written by the agent,
without asking (`NightlyService`, `domain/nightly.ts`; the job `NightlyJob`, `planning/nightly.ts`;
contracts in `api-planning-nightly.ts`).

- **The schedule**: a `nightly {}` job in the existing queue (dedupe key `nightly`), queued with
  `runAfter` at the next run time while Settings → Planning's `nightly.enabled` is on
  (`NightlyService.schedule`: at startup, after every PUT of the settings, after each run).
  `nextNightlyRun`: `nightly.time` today in the server's zone if that is still ahead, else
  tomorrow, never on a day that already has a nightly request (one run a day; a Regenerate counts);
  `localTimeAt` is DST-safe. Off cancels the queued job; a new time replaces it. A job overdue at
  startup (the server was down at its time) runs then. The job reads the setting when it runs (off:
  `cancelled`, nothing made) and, once it has ended for good, queues the next day's.
- **The run** (`NightlyService.run`): the open nightly requests for past days, or without a ready
  suggestion, are archived (a running round is stopped); then today's open main slots from the plan
  (`openSlots` ∩ breakfast, lunch, dinner; none: nothing is made, the job is `done`), and a request
  with `origin: nightly`: those slots, today, the planning defaults (`requestDefaults`) with
  `count` from `nightly.count`, the server's zone, no input. Its first round is queued as for any
  request (`suggest`): outline → suggestions → done, on the planning agent. From then on it is an
  ordinary thread (steer, more, pick).
- **Superseding**: once a nightly request's first round is `done` (`PlanJob.settled` →
  `NightlyService.supersede`), the earlier open nightly requests are archived (what was picked from
  them stays planned). So after Regenerate today's suggestions stay until the new ones arrive; if
  the new round fails, they stay.
- **Regenerate** (`POST /api/planning/nightly/regenerate {id?}`, 201; a retry with the same client
  `id` answers that request with 200): the run, now, whether or not the schedule is on; 409 "nothing
  is open today" when every main slot is eaten or planned.
- **Starters**: the run also calls `save_starters` (scope `plan`, only a running nightly round, 4–6,
  a second call replaces the round's set) with, per starter, `kind` (`protein_gap`, `use_up`,
  `variety`, `like_meal`, `season`, `last_request`, `other`), `text`, `detail`, the `filters` a tap
  applies (`StarterFilters`: `when` today / tomorrow / week, slots, time cap, constraints, use-up
  texts, source mode, portions, count) and a `ref` (`mealId`, `requestId`, `recipeId`, `leftoverId`),
  each checked to exist. **No number**: the app computes
  it when the screen opens. `get_planning_context` of a nightly round adds `nightly` (the starters'
  bounds and kinds, the user's recent requests with ids) and every recent meal carries its
  `mealId`; the prompt says it is the nightly round; the plan-meals skill's §7 says how.
- **`GET /api/planning/nightly`** (`NightlyResponse`): the setting, the zone, `nextRunAt` (the
  queued job's time; null while off), the open nightly requests for today or later as threads
  (newest first: two while a regenerated one hasn't finished), and, while the run is on, the
  latest starters at most `STARTERS_MAX_AGE_MS` (48 h) old, each with what its reference names now
  (`meal`: title and time, null once removed; `request`: title and time; `leftover`, #49, while it
  is open).
- **No push** for a nightly request's first round (see [Notifications](#notifications-13)); the
  entry screen and the overview's quiet row show it.
- **The phone**: the entry screen's Tonight section, agent starters first among the starters, the
  overview's quiet row, Settings → Planning's nightly options: see
  [Screens](#screens-10-11-12-13-24-30-33-40-47-49).

### Leftovers and the shopping list (#49)

What is left over feeds the next plan, and the plan becomes a shopping list. Code computes both;
the agent only notes what a recipe leaves of a pack.

- **Leftovers** (`LeftoverService`, `domain/leftovers.ts`; contracts in `api-leftovers.ts`): a short
  list, not a pantry. `cooked`: extra portions of a planned meal; `pack`: a remainder the planning
  agent noted (`note_leftover`, [above](#the-suggestion-job-45)); `user`: added on the plan view
  (`POST /api/leftovers` `{id?, description, quantity?, grams?, note?}`, idempotent). `PATCH
  /api/leftovers/:id {status}`: `used`, `gone`, or `open` again. `GET /api/leftovers` and the plan
  (`PlanResponse.leftovers`) list the open ones, oldest first, as `LeftoverView` (a cooked one with
  `available`: its portions not planned yet, `plannedFor` and one portion's totals).
- **Cooked portions** (in `PlanningService.log`'s transaction, `leftoverAfterLog`): "Ate it" with
  portions cooked > eaten makes a `cooked` leftover of the rest (to 0.01; the recipe's title, its
  planned meal, recipe and date). **Plan it** (`POST /api/leftovers/:id/plan {id?, date, slot,
  portionEaten?}`, `PlanningService.planLeftover`, idempotent): a planned meal of the recipe with
  `leftover_of` (the planned meal it was cooked with), `portions_cooked` 0 and one portion, or
  what is left when less; 409 for a leftover that isn't cooked, open, or has nothing left to plan.
  Its portions cooked can't change (400), nor can it eat more than is left. Logging it takes its
  portion off the leftover, `used` once none is left. **Removing** a meal (`MealService.remove`,
  `leftoverAfterUnlog`): one that ate a leftover gives the portion back (open again); one whose
  planned meal made a leftover takes it back (deleted) unless something was eaten from it. A
  restore does it again.
- **Offers** (`leftoverOffers`, in `PlanningService.plan`): each open cooked leftover with
  portions not planned is offered on the first day of the plan from the day after it was cooked
  (today at the earliest) whose lunch is open, else dinner; one per slot, the oldest first
  (`PlanDay.leftoverOffers`). An offer isn't a planned meal: it counts nowhere until Plan it.
- **The agent**: `get_planning_context` lists the open leftovers and names the request's
  `useUp` ids; the use-up filter offers the open ingredient leftovers (not cooked dishes, the plan
  offers those) as `{leftoverId}`; a nightly starter may reference one (`ref.leftoverId`), and the
  code starters offer the oldest ingredient leftover (`use_up`). The plan-meals skill says when to
  note a pack and to use open leftovers first when asked.
- **The shopping list** (`ShoppingService`, `domain/shopping.ts`; contracts in `api-shopping.ts`):
  `GET /api/shopping?from&to&tz` (default today to the last day with a planned meal from `from`,
  at most `MAX_PLAN_DAYS`) adds up, in code (`shoppingLines`, pure), every item of the planned
  meals still `planned` in the range for the portions cooked (item grams ÷ servings × portions
  cooked; leftover planned meals need nothing), by line key (`food:<id>`, else `name:<words>` of
  the description without its amount and unit, `ingredientName`), with which planned meals need
  how much. Each open `pack` or `user` leftover is matched to the first line (by grams) of the same
  food (its food id, else the same words) and subtracted ("½ Hokkaido at home"); one without grams
  covers the line, which then shows muted and isn't counted. **Aisles** (`nutrition/aisles.ts`):
  the food's Open Food Facts `categories_tags` (now fetched) or USDA food category, else keywords
  (German and English) in the food's name, then the description, else "Other"; deterministic and
  tested. Lines by aisle, then grams; own lines; covered ones last. `toBuy` and `inBasket` count
  the lines not covered.
- **Checks and own lines** (`shopping_items`): `POST /api/shopping/check {from, to, key, checked}`
  stores a check of a computed line with its grams; it applies to every range overlapping the one
  it was made for, while the line exists and needs no more than it did (a plan change elsewhere
  keeps it; more of it needed opens it again). `POST /api/shopping/lines {id?, from, to, text}` (a
  line of the user's own, idempotent; aisle by keyword) and `DELETE /api/shopping/lines/:id`.
  Every write answers the list for its range. Online only: no upload queue, an error says so.
- **The phone**: the plan view's offered rows, the Leftovers list and the shopping row; the
  shopping list with its range sheet: see [Screens](#screens-10-11-12-13-24-30-33-40-47-49).

## Notifications (#13)

Web Push to the home-screen app: the phone hears when an analysis is done, needs input or
failed, and a tap opens the meal; and when a planning round is done or failed (#45), and a tap
opens the request.

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
  sessions saving a revision over MCP don't notify, nor does logging a meal again (#30).
  `PlanJob.settled` calls `notifyPlan` the same way when a round's job is `done` or `failed` for
  good: the event `planning` (its own toggle, "Suggestions"; a missing key counts as on), nothing
  for an archived request (the user ended it), nothing for a retry or a wait, and nothing for a
  nightly request's first round (#48: nobody asked, and it would be a 3 a.m. notification; rounds
  the user starts from it notify as any).
- **What it says** (`push/messages.ts`; personal data only inside the encrypted payload):
  analysed "<title> · <kcal> kcal" with "Protein · Fat · Carbs" (from the revision view, i.e.
  `computeTotals`); needs input "<title> · needs input" with the first question ("(+1 more)");
  failed "<title> · failed" (or "Meal at HH:MM" in the server's zone without a revision) with the
  error's first clause and "Tap to retry.". The payload (`PushPayload`) carries `url`
  (`/meals/<id>`, `#questions` for needs input) and `tag` (`meal-<id>`: one notification per meal).
  A removed meal is never notified: `notifyMeal` sends nothing for it, and a run stopped by the
  removal ends `cancelled`, which isn't notified anyway. A planning round (`planningNotification`):
  done "3 suggestions for Dinners Tue–Thu" (or "2 of 3 …") with the ready titles; failed "No
  suggestions for Dinners Tue–Thu" with the error's first clause; `url` `/plan/requests/<id>`
  (#47's screen), `tag` `plan-<request id>`, `Topic` the request id.
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

### Screens (#10, #11, #12, #13, #24, #30, #33, #40, #47, #49)

- **Overview** (`/`): today's totals as the ink slab against the goal in force today (kcal,
  protein, fat, carbs, fibre with what's left; "N meals not counted yet" for those without an
  analysis); a tap opens today's day view. Then the last 14 days by day (a tint strip with the
  day's kcal from `days` against that day's own goal, "2,505 / 2,400 kcal", opening the day), each
  meal a row with time, status, title ("Untitled meal" until analysed), what it holds and its
  kcal ("— not counted" without an analysis); needs input is a lime row, failed an orange one. A
  meal logged again (#30) has no captures and says "Logged again" instead, one logged from the
  plan (#40) "From the plan". Today's planned meals still to log (#40, `usePlan` for today) follow
  its eaten ones as quiet rows (`PlannedRow`: "Planned · Dinner", the muted title, "Cook 2 · eat 1",
  the kcal marked "planned", a tap opens the recipe) with a 64 px tint **Ate it** square that opens
  the Ate-it sheet; the totals slab adds "1 planned · with it 1,971 of 2,200 · 229 left" (the
  day's `projected`), and today's strip "2 meals · 1 planned".
  Meals that exist only on this phone so far (started offline) are listed from the upload queue;
  drafts with nothing captured are left out. "Earlier days" opens the day before the 14, from
  where the day view steps back as far as needed. The header's calendar opens the calendar on the
  current month (#33), the scale goals and weight.
  The bottom slab is split (#40): **Log** (lime, the meal capture; its accessible name stays "Log
  meal") | **Plan** (tint), which opens the planning entry screen (#47). Under the totals the
  **Planning strip** (#47, `PlanningStrip`, `usePlanningRequests`, key under `meals`, polling while
  a round runs) lists at most one row per state the open requests are in (#54's follow-up,
  `stripRows` / `groupStripRows` / `requestState` in `lib/plan-request.ts`): suggestions waiting for
  a verdict (lime, "Suggested · 2 for you", like a meal that needs input), additions waiting for a
  round (lime), still suggesting (quiet, "Suggesting · 2 of 3 ready" with the count on the right), a
  failed round (orange, like a failed meal), and requests still in the upload queue ("On this
  phone · waiting to send"; orange once refused, never folded). Several open requests sharing a
  state fold into one row instead of one each: the count in words ("3 requests with suggestions"),
  their titles in the sub-line, opening the entry screen (`/plan`), where every open request is
  listed. A request whose filter days are all before today (the phone's zone; `isPastRequest`) drops
  off the strip, and a request whose suggestions all have a verdict leaves it. Nightly requests
  (#48) never count as waiting: while today's nightly suggestions wait for a verdict, a quiet row
  of their own closes the strip (`NightlyStripRow`, `nightlyStripRow`, `useNightly`: "Tonight · 3
  suggestions", their titles, "Made at 03:00"; not lime, nobody asked), opening the entry screen;
  the strip's meta adds "tonight".
  Goals come from `GET /api/goals` (`useGoals`), resolved per day with `goalInForce`.
- **Day view** (`/days/:date`, `useDay` → `GET /api/days/:date?tz=<the phone's zone>`): the
  totals slab with the day's goal and per-target "left" / "over", the meals not counted yet, a
  goal row (since when, its note; to the goals screen), the meals (the server's plus the upload
  queue's for that day, then the day's planned meals still to log with Ate it and the "with it"
  note, as on the overview, #40), the weight entries of the day; the bottom slab steps to the previous and
  next day (replacing the history entry; not past today); the header's calendar opens the day's
  month with the day selected. Right after a meal of the day was removed (`?removed=<id>`), a tint
  strip at the top says "Meal removed" with its title and **Undo** (a restore); it goes after 12 s,
  on Undo and with any navigation. Its query key sits under `meals`, so
  everything that refreshes the meals refreshes it, and it polls while a meal is in motion. A
  malformed date redirects to today.
- **Calendar** (#33, `/calendar?month=YYYY-MM&day=YYYY-MM-DD`, `useMonth` → `GET /api/months/:month?tz`,
  key under `meals`): header with back and the month steps (not past the current month); the month
  as the ink slab, 7 day columns (≥ 44 px wide at 390) and the week column; the selected day
  continuing the ink (a row with its name, goal label and meals, to the day view; the totals slab
  with left / over, the meals not counted yet and the plan reading); the month so far on tint
  (days tracked, % of the kcal target, average kcal and protein, the 7-day weight average); the
  legend in words, its ranges from the goals in force that month; **Open <day>** as the tint
  bottom slab. Every state has a URL: the month defaults to the day's (or the current one), the
  day to today in the current month and to the last day of a past one. Picking days and stepping
  months replace the history entry, so Back leaves the calendar.
- **Plan view** (#40, `/plan/days`, `usePlan` → `GET /api/plan` for today and the next six days,
  key under `meals`): back, "Plan" / "Next days"; the days as squares on the ink slab (4 columns, 88
  px tall: the date chip, the weekday, the projected kcal and the reading), read with the calendar's
  fills and caps (`classifyDay` over `projected`) only once the API marks a day mostly known,
  otherwise "rest open" ("nothing planned" with neither eaten nor planned); a tap scrolls to the
  day; the line under them names the goal and its range. Then per day a tint strip ("1 planned · 2
  eaten · rest open", or the date) and its planned meals in every status (planned, "Logged ·
  Dinner" with its meal's kcal, "Skipped · Dinner" struck through), today's with Ate it, or
  "Nothing planned". The bottom slab is lime **Ate it · Dinner** while today has a planned meal to
  log, else none. A "Plan <day>" row is left out (the planning entry screen is the overview's Plan,
  #47). **Leftovers** (#49, `components/leftovers.tsx`, from `PlanResponse.leftovers` and each
  day's `leftoverOffers`): a cooked leftover the plan offers is a quiet row after the day's planned
  meals ("Leftover · 1 portion", the title muted, "Cooked Thu · offered for lunch", one portion's
  kcal) with a 64 px tint **Plan it** square (`POST /api/leftovers/:id/plan` with a client id per
  row), and the day's strip counts it ("1 planned · 1 leftover · rest open"); a leftover planned
  meal reads "Leftover · Lunch", "From the leftovers · eat 1". After the days the **Leftovers** list
  (strip "at home now"): each open one as a plain row (the name, where it comes from: "After Thu ·
  offered for lunch today", the note, "Added by you"; how much on the right, `leftoverAmount`); a
  tap opens its top sheet (lime **Plan it · Today lunch** for an offered one, then **Used it** and
  **Gone**), and **Add a leftover** opens a sheet (what, how much as said, grams). Last the tint
  **Shopping list** row ("Fri–Sun · 13 to buy →", the default range's list).
- **Shopping list** (#49, `/plan/shopping?from&to`, `useShopping` → `GET /api/shopping`, key under
  `meals`; online only): back, "Plan · needs yamt online" / "Shopping list"; the ink slab "2 /15 in
  the basket" with the range ("Fri–Sun") and "3 recipes · change ›" on the right (opens the **range
  sheet**: the days from today to the last planned day, a week at least, as **From** and
  **Through** chips; lime "Show Fri–Sun" replaces the search params) and "Amounts for the portions
  cooked · 2 lines already at home" under a thin line. Then per aisle a tint strip ("Produce", "1
  of 6") and the lines: a 28 px check square (`POST /api/shopping/check`; the square answers at
  once, the list the server answers replaces it), the name (struck through and muted in the
  basket) with "½ Hokkaido at home" or "Added by you" under it, the grams to buy in display 20 px;
  a line the leftovers cover is muted without a square, "200 g Feta at home" on the right. A tap
  on the name opens the line on tint: the recipes that need it with their grams, "At home · ½
  Hokkaido −500 g", Remove for an own line. The bottom slab is a tint **Add a line** (a top sheet,
  one field). Offline it says it needs yamt.
- **Planned meal** (#40, `/planned/:id`, `usePlannedMeal` → `GET /api/planned-meals/:id`, the
  recipe by `useRecipe` (cached for good: recipes never change) and the plan of its date;
  `components/recipe-detail.tsx`, to be reused for suggestions): the header with back and a tint
  "Change day or portions" square while planned, "Planned · Today, dinner · cook 2, eat 1", the
  title, summary and the source label ("From chefkoch.de", "Adapted from chefkoch.de · 3 changes",
  "Composed for you"; a link when there is a URL). A skipped one gets a tint band (not counted,
  Unskip puts it back), a logged one a tint row to its meal. The ink slab: the kcal of the portion
  eaten (`eaten`), on the right what is open of the day's kcal target before this dish in lime,
  the fit bar (the day's other eaten and planned kcal in lime, this dish in the slab's foreground,
  past the target after a 2 px gap), the macros against what is open, the times. Changes against
  the source, the recipe's notes and the planned meal's note on tint when present; **Cook / Eat**
  portion chips (PATCH at once, while planned) with "1 portion (774 kcal) more than you eat: a
  leftover." (a leftover planned meal, #49: "Leftover · …", only the Eat chips, "a leftover, cooked
  already", the ingredients in the portion eaten); the ingredients for the portions cooked
  (optional ones marked); numbered steps; the
  source footer ("nutrition computed from the matched ingredients, not from the page"). The bottom
  slab: lime **Ate it** when due (today or earlier, still planned), tint **Change day · portions**
  ahead of time, tint **Unskip** when skipped, tint **Open the logged meal** when logged. A planned
  meal that is gone (unplanned) says so with a way to the plan.
- **Ate-it sheet** (#40, the top sheet, "Ate it · Today, dinner" over the title): the recipe's items
  as check rows (all on; a tap switches one off, struck through) with their grams for the portion,
  the portion chips relative to the plan (0.5× Half / 1× As planned / 1.5× More / 2× Double, "of 2
  cooked", "from the leftovers" for a leftover planned meal; the leftover line with the fork and
  knife, "1 portion (648 kcal) kept as a leftover: the plan offers it from tomorrow.", #49), the time (now; an earlier day's meal starts at its slot's usual
  hour), the kcal and macros of what will be logged (`ateItTotals`: the shared `portionItems` and
  `computeTotals`, which the server runs again on save), lime **Log it** (`POST …/log` with a client
  id per opening, the excluded item ids and the portion; not with everything off) → the new meal. A
  failure is an orange line; it is one request, never queued.
- **Plan-for sheet** (#40, from the planned meal's header or slab): the day as chips (today and the
  next six days, plus the meal's own day when outside them), the slot, Cook / Eat; a plain line when
  the slot already holds a planned or eaten meal ("Monday's dinner already has …. Both stay
  planned."), "<day> with it 1,784 of 2,200 · 416 left"; lime **Save · Mon dinner** (a PATCH of what
  changed), then **Skip it** (the planned meal shows as skipped, Unskip undoes it) and **Unplan**
  (an inline confirm; a DELETE, then the plan view).
- **Planning entry** (#47, `/plan`, "What to cook?"; `routes/plan.index.tsx`): the header with back
  and the plan view's calendar, then the **Tonight** section (#48, `NightlySection`,
  `components/nightly.tsx`, `useNightly`, key under `meals`, polling while a nightly round runs):
  today's nightly suggestions as compact bands (title, the first why-line, kcal, the day's bar with
  it, time · protein against what is open · source; **Pick · tonight** in ink, or "Pick · lunch",
  and No; picked: tint, "Planned · tonight", Unplan; rejected: folded with Undo; the title opens the
  suggestion's recipe), "Steer or ask for more" (the request's thread) and **Regenerate**
  (`useRegenerateNightly`, one request with a client id, never queued). The strip says "3
  suggestions · made 03:00" and is titled "Tonight" when every suggestion is for today's dinner,
  else "Today". While a regenerated request has nothing ready (`nightlyState`), the earlier
  suggestions stay, quiet and without buttons, under "Started 09:14. These stay until the new ones
  arrive."; a regenerated round that failed says so above the earlier ones. With no request today:
  when the next run comes and **Suggest now**; with the run off and none today: a muted row
  "Nightly suggestions for today are off." to the settings. Then **starter bands** (`StarterBand`,
  `lib/starters.ts`): the nightly run's first, in its order (#48, `agentStarter`: its text, detail
  and filters as written, the number computed here by `liveNumber` from the kind and the reference:
  the protein or kcal open tonight like code's, "4× logged in 30 days" or "12 days since you had it"
  for the referenced meal, the month for the season, the weekday of the referenced request, how
  much of the referenced leftover is left ("500 g Hokkaido at home", #49), none (a sparkles mark)
  for `other` or a reference that is gone; the strip's meta
  "ideas from last night"), then those computed by code of a kind the run didn't write, at most
  `MAX_SHOWN_STARTERS` (6). The code's, from what the app has: what is open tonight (protein, else kcal, against the goal in force,
  from `usePlan` of today and tomorrow; tomorrow once tonight's dinner is eaten or planned), the meal
  logged most in 30 days ("Like Linsen-Dal, but different", `useRepeatable`), what is in season this
  month (a static German list in code, `SEASON`), the last request ("Dinners Tue–Thu, like last
  time": its filters again from today, its text); each only when its data is there, the first one the
  screen's ink slab, the rest tint and plain). A tap fills the composer's text and replaces the
  filters; both stay editable. Then the open requests as plain rows (and those still on this phone).
  The sticky **dock** (`Dock`, `components/composer.tsx`): the **filter summary** row ("For
  Tonight · Dinner · cook 2", `summaryWords`: when and which meals, then only what differs from the
  defaults; it opens the filter page) above the **composer** (plus, field, mic, lime send). Send is
  disabled while nothing is typed or attached, while no day is picked (a tint hint says so) and
  until Settings → Planning has loaded (its defaults complete the filters). Sending queues the
  request (`sendDraft`, see [the upload queue](#the-upload-queue-liboutbox)) and opens its thread.
  The open requests listed are the user's; nightly ones are in the Tonight section. Code's starters
  include the oldest ingredient leftover ("Use up the Hokkaido", #49, its id into the filters).
- **Composer** (#47, `components/composer.tsx`): attachments above the row as 44 px chips (a photo's
  thumbnail, a voice memo's length "voice · transcribed later", a link's host and path, a file's
  name; each removable), then **plus** (a top sheet: Photo, the camera or library; Link, the link
  sheet; File and Audio file, the Files picker; Paste, the clipboard or the paste sheet, pasted text
  joining the field), the field (tint, lime-soft while focused, growing to five lines), the **mic**
  (`useRecorder` in place: the field becomes a lime-soft "Recording 0:04" row, the mic a lime stop
  square; the recording becomes a voice chip, transcribed on the server once sent) and the lime
  **send** square (tint and disabled with nothing to send). What it holds is a draft per composer
  (`lib/plan-draft.ts`, in memory for the session: the entry screen's with its filters, each
  thread's), so the filter page or a recipe in between keep it; sending hands it to the upload
  queue and clears it. While the on-screen keyboard is up (`visualViewport`) the dock sits on top
  of it, the filter summary included.
- **Filter page** (#47, `/plan/filters`, the entry screen's draft): back, "Request" / "Filters",
  the request **as the agent will read it** as the ink slab (`requestSentence`: "Dinner tonight,
  ≤ 30 min total, no oven, using ½ Hokkaido. 3 suggestions, based on a real recipe, 2 portions each
  (eat one, keep the rest).") and what else it reads; then toggle chips for **when** (Today,
  Tomorrow, Rest of the week, Pick days: the next seven as chips), **which meals**, **time** (≤ 20 /
  30 / 45 min, any), **only** (`PLANNING_CONSTRAINTS`), **use up** (the open ingredient leftovers
  as chips with their amount, off until tapped, sent as `{leftoverId}`, #49; then typed ones, one
  chip each), the
  **recipe source** as choice rows ("default · …" from Settings → Planning), **portions to cook**
  and **suggestions per round** as preset chips (the default one labelled). Changes apply at once;
  "Back to the defaults" clears them; lime **Done** goes back. The filters are overrides
  (`FilterDraft`) over `filterDefaults` (`PLANNING_DEFAULTS` with Settings → Planning's count,
  source and portions), sent complete (`resolveDraft`).
- **Request thread** (#47, `/plan/requests/:id`, the push's target; `usePlanningRequest`, key under
  `meals`, polling while a round is queued or running): the header ("Request · Suggesting" /
  "Suggested" / "Failed" / "Archived", the title, the plan view), the **slots slab** (ink: each of
  the request's days × slots: this request's pick in the slab's foreground with the day "with it",
  a slot already eaten or planned with its title, else "Open" and what the day has eaten; "1 of 3
  slots filled"), **You asked** (tint: the filters as chips, `askedWords`, and the first round's
  inputs: quoted texts and transcripts, links, photos, files; still-queued ones say "Sending",
  "Waiting for network" or, refused, an orange line with Retry / Discard), then each round: **You
  added** before a steering round with its inputs, a strip "Round 2" with how far it is
  (`roundMeta`: "Queued", "Outlining…", "1 of 3 ready", "2 of 3 · 1 couldn't", "Same request · …"
  for more), an orange band when the whole round failed (its error), and its rows: an **outlined
  idea** as a quiet placeholder (title, approach, a grey bar, "Checking ingredients…" with a pulse on
  the one being worked on, else "Queued", the source mode, the proposed slot), a **ready
  suggestion** as a band (`SuggestionBand`: title and summary, kcal per portion, the day's fit bar
  on the page colour with "Sat with it 1,865 of 2,200 · 335 left", the macros as chips and "35 of 88
  g P open", two why-lines, times and the source label; **Pick · Sat dinner** in ink (where the pick
  will go, `pickTarget`, mirroring the server) and **No**, which folds the band into "… · no" with
  Undo (unreject); a picked one turns tint, "Planned · Sat dinner", with **Change day · portions**
  (the Plan-for sheet of its planned meal) and **Unplan**), an **idea that couldn't be completed**
  struck through and quiet, with the reason (no orange, no retry: Suggest more is the retry). Under
  a running round a muted line says how it works and that additions go into the next round. At the
  end: additions not in a round yet ("You added · for the next round" / "not asked yet"), then a tint
  **Suggest more** row ("same request · 3 more"; "Try again" after a failed round) or, with
  additions waiting, a lime **Suggest with it**; "Archive request" (out of the lists; stops a
  running round; an archived thread has a tint band with Unarchive and no composer). The dock's
  composer steers: with no round open, sending queues the text and attachments and a `suggest`
  round (a steer); while one is queued or running it queues them only ("Add more for the next
  round…"). Pick, No and Unplan are single requests (like "Ate it"), never queued; a failure is an
  orange line in the band. A request still only in the upload queue shows what this phone holds
  ("Kept on this phone: it goes out … as soon as yamt is reachable", or the refusal with Retry /
  Discard).
- **Suggestion detail** (#47, `/plan/requests/:id/suggestions/:suggestionId`, from a band's title;
  `SuggestionDetail` in `components/recipe-detail.tsx`, the same sections as a planned meal's
  recipe): "Suggestion · round 1 · for Sat, dinner", title, summary, source; the ink slab with one
  portion against what its day has open (the suggestion's fit), **why it fits** and the changes on
  tint, the leftover line for more than one portion cooked, the ingredients for the request's
  portions, the steps and the source footer; the bottom slab **Pick · Sat dinner** (ink), **Undo
  No** for a rejected one, **Open the planned meal** once picked.
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
  when adding). On Log meal, before anything is captured, **Again?** (#30) lists recent meals to
  log again (`useRepeatable`): title, "4× in 30 days", when, kcal; a tap opens the Log again sheet,
  which returns to the overview once the copy is made. Once the server has the meal, the capture
  view ends with the same **Remove meal** row as the detail (not when adding to an analysed meal:
  the detail has it).
- **Removed meal** (`/meals/:id` of a removed meal, `components/remove-meal.tsx`): a "Removed" chip,
  the time and the title muted, a tint band saying when it was removed and that it counts nowhere
  and nothing was deleted, its numbers (the ink slab, "kcal · not counted") and items, and a tint
  bottom slab **Restore meal**, after which the screen is the meal's usual one.
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
  and the trace of its run) and the trace of the current revision's run (or the latest run); last
  **Remove meal** (see [Removing a meal](#removing-a-meal)): a tap asks inline ("Remove meal?",
  what it does, a Remove button; it falls back after 4 s), the removal opens the meal's day. The
  bottom slab is the one action: **Answer & re-analyse** / **Correct & re-analyse** /
  **Re-analyse** / **Retry analysis** (lime) once there is something for the next analysis
  (typed answers and the correction are sent through the upload queue first, then the analyse
  entry), disabled with a hint while questions are open, **Add to this meal** (tint) otherwise; on
  an analysed meal (#30) that calm slab is two tint halves, **Add more** and **Log again**. Log
  again opens a top sheet (`components/log-again.tsx`): portion chips 0.5× / 1× / 1.5× / 2× (1×
  chosen), "Now · change time", the kcal for that portion ("≈" unless 1×: the server computes the
  real one), and lime **Log again**, which posts the copy (`useRepeatMeal`, a UUIDv7 per opening)
  and opens it; a failure is an orange line in the sheet ("No connection: …"). A meal logged
  again shows "Logged again from <title> · <when>" under its title, linking to the source; its
  trace row says "no analysis" and why, and its revision in the history "logged again". A meal
  logged from the plan (#40) shows "Logged from the plan · Today, dinner" there instead, linking to
  its planned meal (a plain line once that is unplanned), "no analysis" likewise, and its revision
  "logged from the plan".
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
  clears model and effort; a model switch keeps the effort only if the new model offers it. A
  second strip repeats the same form for **planning** (#46: `PUT /api/agent/planning`), defaulting
  to "Opus 5.5 · medium", its sources "Fixed by YAMT_PLANNING_…" and independent of the analysis
  line. Then **Planning** (#46, `components/planning-settings.tsx`): a stepper for suggestions per
  round (2–5), choice rows for the recipe source (real recipes only, based on a real recipe,
  free), a stepper for portions to cook (1–4), and a preferences list (never eat, dislikes,
  equipment, favourite sites, weekday cooking time) whose rows open a small sheet — a text field,
  one line each, or a number field for the cooking time. Between portions and preferences,
  **Tonight's suggestions** (#48): a switch "Suggest for today each night" (off by default; what a
  run costs said under it), and while on the time (a row opening a sheet with a time field, "the
  server's time") and how many (a stepper, 1–5).
- **Live status:** the overview polls `GET /api/meals` every 3 s while a meal is
  queued, analysing or has a pending transcript, the meal screen polls its meal likewise; the
  planning list and a thread poll while a round is queued or running (#47). A push arriving while
  the app is open refreshes the meals at once, and with them (keys under `meals`) the planning
  requests and threads.

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
6. **Planning requests** (#47) go the same way, with three more entry types: `plan-request` (the
   request with its client id, complete filters and the phone's zone; a text alone goes along as its
   first input), `plan-input` (a text, link, photo, voice memo or file of a request, checked like a
   capture, uploaded with progress) and `plan-round` (its client id is the round's: `suggest`, the
   first or a steer, or `more`). Inputs and the round wait while their request's entry is queued;
   a round waits for the inputs queued before it (not for later ones, which go into the next round);
   one waiting round per request (asking again answers it, and retries a refused one). A refused
   request holds everything of it; discarding it drops its inputs and round too. `sendDraft`
   (`lib/plan-draft.ts`) queues a composer's draft in that order: the request (with the text) or the
   text as an input, the attachments, then a round unless one is open. After an entry is sent, the
   thread's query is refreshed before the entry is forgotten (then the list), so nothing blinks.

The screens merge the queue's entries (`useMealOutbox`; `usePlanningOutbox` for planning requests,
#47) with the server's captures and inputs by id.
Removing a meal waits until none of its captures is left in the queue (see [Removing a
meal](#removing-a-meal)); an upload that reaches a meal removed meanwhile (from another device) is
refused with 409 and shows as refused, with Retry and Discard.

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
Shortcut share target (#26), the agent settings (#28), logging a meal again (#30), the calendar (#33,
from spike #31), removing a meal, and the data underneath meal planning (#39, epic #36: recipes,
planned meals, the plan and "Ate it"; [ADR 0003](adr/0003-meal-planning.md)), the plan view and
recipe detail (#40), planning requests (#44), the suggestion job (#45), planning settings (#46) and
the planning screens (#47). Spike #4 (speech-to-text) decided ADR 0002; spike #5's chosen design is
[design/design.md](design/design.md). See the epic for the decisions each one builds on.
