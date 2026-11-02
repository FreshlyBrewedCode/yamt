# yamt

Yet another macro tracker: capture meals freestyle on the phone (voice, photos, text, links), an
agent analyses them afterwards and logs macros with their provenance. Single user, tailnet-only.
Read before changing anything: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how it's built) and
the ADRs in [docs/adr/](docs/adr/) (why). The roadmap is tracker #1; wave 1 is epic #2.

## Commands

```sh
bun install
bun run check          # biome lint + strict tsc (every package + e2e) + bun test. Must pass before every commit
bun run e2e            # builds the web app, runs Playwright (phone viewport) against a throwaway server
                       # (port 7898, temp data dir, auth bypassed; YAMT_E2E_PORT=… if taken)
bun run start          # yamt start: http://localhost:7890 + https://<host>.<tailnet>.ts.net:7444
bun run dev            # same with Vite HMR (web on port+1, proxying /api)
bun run format         # biome --write
# local only, no Tailscale, no auth, scratch data (what agents and the design work use):
bun packages/server/src/cli.ts start --local --no-auth --data-dir /tmp/yamt-dev [--dev]
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
  `config.json`. Tests use temp dirs. Never point a test or a scratch run at the real one.
- On NixOS, Playwright needs a nix chromium: `nix build nixpkgs#chromium -o .chromium` (the
  config picks it up). In CI, `bunx playwright install` provides one.
- Leave nothing running: stop servers with Ctrl+C or SIGTERM (by PID, not `pkill -f`), which
  also removes the `tailscale serve` entry. Check `tailscale serve status` afterwards; other
  projects on this host have their own entries, never touch those.

## Layout

`packages/shared` (zod schemas and types shared by server and web), `packages/server` (CLI, Hono
API, auth, SQLite), `packages/web` (Vite + React + TanStack Router/Query + Tailwind + shadcn/ui),
`e2e/` (Playwright), `docs/` (architecture, ADRs), `reports/` (background research).
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
  (`auth/bearer.ts`), never the identity header.
- Database: `bun:sqlite`, no ORM. SQL lives in repositories (`db/repos/<entity>.ts`, one per
  aggregate, taking a `Db` and returning shared types). Ids are UUIDv7 (`newId()`). Migrations:
  a new `db/migrations/<YYYYMMDDHHmm>_<what>.sql`; never edit an applied one (the runner checks
  checksums and refuses to start).
- Web: server state only via TanStack Query (`lib/queries.ts`), colours only via the theme
  tokens in `index.css` (light and dark, following the OS). Add shadcn components with
  `bunx shadcn@4.23.0 add <name>` in `packages/web`. Mobile first: check every screen at 390×844.
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
