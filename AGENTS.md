# yamt

Yet another macro tracker: capture meals freestyle on the phone (voice, photos, text, links), an
agent analyses them afterwards and logs macros with their provenance. Single user, tailnet-only.
Read before changing anything: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how it's built),
the ADRs in [docs/adr/](docs/adr/) (why) and, for anything visible,
[docs/design/design.md](docs/design/design.md) (the design, D · Slab). The roadmap is tracker #1;
wave 1 is epic #2.

## Commands

```sh
bun install
bun run check          # biome lint + strict tsc (every package + e2e) + bun test. Must pass before every commit
bun run e2e            # builds the web app, runs Playwright (phone viewport) against a throwaway server
                       # (port 7898, temp data dir, auth bypassed; YAMT_E2E_PORT=… if taken)
bun run start          # yamt start: http://localhost:7890 + https://<host>.<tailnet>.ts.net:7444
bun run dev            # same with Vite HMR (web on port+1, proxying /api)
bun run format         # biome --write
bun run check:stt      # the speech-to-text process: ruff + pytest (services/stt/run.sh check; needs uv or nix)
# local only, no Tailscale, no auth, scratch data (what agents and the design work use):
bun packages/server/src/cli.ts start --local --no-auth --data-dir /tmp/yamt-dev [--dev] [--no-worker]
bun packages/server/src/cli.ts mcp-token [--rotate] [--data-dir …]   # print the interactive MCP token
```

- `start` and `dev` publish the app on the tailnet with `tailscale serve --https=7444` (foreground;
  the entry disappears when yamt stops) and only accept requests from the configured Tailscale
  login: set `YAMT_LOGIN`, or `{"login": "…"}` in `<data>/config.json`. Without one, `start`
  refuses to run. Open the printed `https://…ts.net:7444/` URL on the phone; `/api/me` shows the
  login yamt sees. Requests from tagged tailnet devices carry no identity and get 401.
- `--local` skips `tailscale serve`; `--no-auth` (only with `--local`) skips the identity check.
- `start` rebuilds the web app when its sources are newer than the last build (`--no-build`
  skips the check); `--dev` uses Vite and never needs it.
- Data lives in `~/.yamt/` (`--data-dir` / `YAMT_DATA_DIR`): `yamt.db`, `media/`, `runs/`,
  `models/`, `config.json`, `mcp-token`, `vapid.json`. Tests use temp dirs. Never point a test or a scratch run at the
  real one.
- Meal analysis: `start` runs the job worker, which analyses queued meals with Claude Code
  (claude-agent-acp, model `claude-opus-5-5`, logged in with the `claude` CLI). Pick another
  harness or model with `"analysis": {"harness": "custom", "command": …, "args": […], "model": …}`
  in `<data>/config.json` or `YAMT_ANALYSIS_HARNESS` / `YAMT_ANALYSIS_COMMAND` /
  `YAMT_ANALYSIS_MODEL`; `--no-worker` runs nothing. Each run leaves `<data>/runs/<run id>/
  trace.ndjson`. Real runs cost money and quota: try changes against the fake agent
  (`YAMT_ANALYSIS_COMMAND="bun $PWD/packages/server/test/fake-agent.ts"`, scripted by a
  `fake:<script>` text capture, see its header) and keep live runs few.
- Transcription: the worker transcribes voice memos on the CPU with faster-whisper
  large-v3-turbo (int8, German) by running `services/stt/run.sh transcribe` once per batch (a uv
  project; Python 3.12 comes from uv). Tools, on this NixOS VM neither is on PATH: **uv** from PATH,
  else `run.sh` links `nixpkgs#uv` as `services/stt/.uv`; **ffmpeg** from `transcription.ffmpeg` /
  `YAMT_FFMPEG`, else PATH, else the server links `nixpkgs#ffmpeg-headless` as
  `services/stt/.ffmpeg-bin` on first use (`start` warns if there is none; memos then fail to
  transcribe). The first memo downloads the model (~1.6 GB) into `<data>/models`; point
  `YAMT_STT_MODELS_DIR` at an existing cache for scratch data dirs. Tune it with `"transcription":
  {"model", "computeType", "threads", "beamSize", "vad", "language", "initialPrompt", …}` in
  `<data>/config.json` or `YAMT_STT_*`. Tests and the e2e never load a model: they run
  `packages/server/test/fake-stt.ts` (`YAMT_STT_COMMAND="bun $PWD/packages/server/test/fake-stt.ts"`,
  see its header); `services/stt/run.sh smoke` does one real run with Whisper tiny, outside the gate.
- Notifications: Web Push to the home-screen app (iOS 16.4+), turned on per device in Settings.
  The VAPID key pair is made at the first start in `<data>/vapid.json` (keep it: a new one
  silences every phone until it subscribes again); `"push": {"subject": "mailto:…"}` in
  `<data>/config.json` or `YAMT_PUSH_SUBJECT` names a contact (default: the project URL). Push
  works with `start` and `dev` alike (dev serves a push-only service worker), but only over the
  tailnet HTTPS URL on the phone. Tests and the e2e never reach a push service: the server takes
  an injectable `fetch` (`push.fetch`), the e2e fakes `PushManager`.
- Food data: Open Food Facts needs nothing; USDA FoodData Central needs a key (`FDC_API_KEY`, or
  `{"fdcApiKey": "…"}` in `<data>/config.json`; free at https://fdc.nal.usda.gov/api-key-signup).
  Without one, searches skip FDC and say so. Never commit a key; tests use recorded fixtures
  (`packages/server/test/fixtures/nutrition/`, re-record with its `record.ts`, `DEMO_KEY` works).

### Connecting an interactive session to yamt (MCP)

The repo's `.mcp.json` points Claude Code at the yamt MCP server
(`http://127.0.0.1:${YAMT_PORT:-7890}/mcp`) with the token from the environment. With yamt
running (the real one, or a scratch `start --local --no-auth --data-dir /tmp/yamt-dev`):

```sh
export YAMT_MCP_TOKEN=$(bun packages/server/src/cli.ts mcp-token [--data-dir /tmp/yamt-dev])
export YAMT_PORT=7890          # only if the server runs on another port
claude                         # approve the project server "yamt" once; tools: mcp__yamt__*
```

`claude mcp list` shows "Pending approval" until it is approved. Without the variable the server
answers 401 and the session just has no yamt tools. The token is a secret: never paste it into
the repo, an issue or a PR. `mcp-token --rotate` replaces it (the old one stops working at once).
- On NixOS, Playwright needs a nix chromium: `nix build nixpkgs#chromium -o .chromium` (the
  config picks it up). In CI, `bunx playwright install` provides one.
- Leave nothing running: stop servers with Ctrl+C or SIGTERM (by PID, not `pkill -f`), which
  also removes the `tailscale serve` entry. Check `tailscale serve status` afterwards; other
  projects on this host have their own entries, never touch those.

## Layout

`packages/shared` (zod schemas and types shared by server and web), `packages/server` (CLI, Hono
API, auth, SQLite), `packages/web` (Vite + React + TanStack Router/Query + Tailwind + shadcn/ui),
`services/stt` (the speech-to-text process, Python/uv), `e2e/` (Playwright), `docs/` (architecture, ADRs, design), `reports/` (background research).
`.agents/skills/` holds project skills (`.claude/skills` links to it).

## Conventions

- **Real data never enters the repo, issues or PRs.** No meals, photos, voice memos, weights,
  logins, tokens or hostnames of this machine; tests, fixtures and screenshots use made-up data
  (`alice@example.com`, a scratch data dir). The repo is public.
- TypeScript strict with `noUncheckedIndexedAccess`, Biome formatting (2 spaces, double quotes,
  110 cols). Pin exact dependency versions. Check the installed package's types or docs rather
  than assuming an API.
- Shared contracts first: request schemas and response types in `shared/src/api.ts` (or a new
  `api-<area>.ts`). The server parses every request body with the zod schema.
- Auth: every `/api` route except `/api/health` sits behind `requireTailnetIdentity`, writes also
  behind `sameOrigin` (`http/api.ts`). Machine clients (`/mcp`) use `requireBearer`
  (`auth/bearer.ts`) with `McpTokens`, never the identity header, and only from this machine.
- Nutrition: the model reads, code computes. Totals only ever come from `computeTotals`
  (`nutrition/totals.ts`); never store or accept a total from the model. `carbohydrate` is
  available carbohydrate excluding fiber (EU labels), fiber separate: sources that include fiber
  (USDA, US labels) are mapped by subtracting it (`nutrition/nutrients.ts`). New MCP tools go into
  `mcp/tools.ts` with a zod schema and a scope (`meal`, `food`, `interactive`), and get a test in
  `mcp.test.ts` through the SDK client. Tests never hit the network (`fixtureFetch`).
- Analysis: how the agent analyses a meal lives in one place, `.agents/skills/log-meal/SKILL.md`
  (the job's appended system prompt and the interactive skill); change behaviour there, not in the
  prompt code. `acp/` stays free of DB and HTTP (it reports events; `analysis/` stores them). A run
  succeeds only by saving exactly one revision. Tests never start a real harness: they run
  `test/fake-agent.ts` as a custom harness; `createServer` runs no worker unless `worker` is set.
- Transcription: the STT backend sits behind `SttBackend` (`transcription/backend.ts`); the
  Python side speaks the NDJSON protocol in `services/stt/yamt_stt/protocol.py`, so change both
  sides together. Python follows vibe-center's services: exact pins in `pyproject.toml`,
  `uv.lock` committed, ruff (110 cols) and pytest; `bun run check:stt` before committing there.
  Test audio is synthetic or public (espeak-ng, FLEURS), never a real recording.
- Database: `bun:sqlite`, no ORM. SQL lives in repositories (`db/repos/<entity>.ts`, one per
  aggregate, taking a `Db` and returning shared types). Ids are UUIDv7 (`newId()`). Migrations:
  a new `db/migrations/<YYYYMMDDHHmm>_<what>.sql`; never edit an applied one (the runner checks
  checksums and refuses to start).
- Web: server state only via TanStack Query (`lib/queries.ts`), colours only via the theme
  tokens in `index.css` (light and dark, following the OS). Add shadcn components with
  `bunx shadcn@4.23.0 add <name>` in `packages/web`. Mobile first: check every screen at 390×844.
- Design: every screen follows [docs/design/design.md](docs/design/design.md) (filled bands, the
  ink / lime / tint / plain hierarchy, orange only for failure, the sticky bottom slab) and builds
  on the primitives in `components/slab.tsx`; light and dark both get a look before a PR.
- Captures leave the phone only through the upload queue (`lib/outbox`, IndexedDB): never post a
  capture directly, or it can be lost offline. The service worker caches the app shell only,
  never `/api` or `/mcp`.
- Notifications: personal data (titles, questions, errors) only inside the encrypted push
  payload, never in logs; meal notifications go through `notifyMeal` (`push/messages.ts`), which
  sends only for a meal's final state (never while another analysis of it is queued).
- Tests: light and purposeful. Logic gets `bun test` next to its package (`packages/*/test`),
  each main flow one Playwright spec.
- Generated `packages/web/src/routeTree.gen.ts` is committed. On merge conflicts, take either side
  and rebuild. Same for `bun.lock` (`bun install`).
- Decisions that shape the architecture get an ADR (`docs/adr/NNNN-slug.md`: Status, Context,
  numbered Decision, Consequences).

## Workflow

- Feature work follows the **`playbook` skill** (brainstorm → epic → stacked PRs → testing with
  the user); issue types, sub-issues and iterations follow the **`issue-tracker` skill**; stacks
  use the `gh-stack` skill.
- One branch and PR per subtask, stacked with `gh stack`, against `main`. PRs are squash-merged,
  so the PR title must be a Conventional Commit (`feat(web): …`, `fix(server): …`, `docs: …`;
  checked by `pr-title.yml`). Commit in logical steps; never secrets.
- Every feature lands with evidence: the gate, an e2e for main flows, and for anything visible a
  screenshot at 390×844 in the PR.
- Testing with the user happens on their iPhone over the tailnet: run `bun run dev` (or `start`)
  on the top of the stack and hand over the `https://…ts.net:7444/` link to the changed screen.
  A closing report lists everything only the iPhone can show (microphone, camera, Web Push,
  home-screen install, iOS Safari layout).
