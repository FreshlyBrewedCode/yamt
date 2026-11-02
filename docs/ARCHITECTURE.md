# yamt: architecture

What exists today (the scaffold, #3), how it fits together, and where wave 1 goes next. Why it
is built this way: [ADR 0001](adr/0001-wave-1-architecture.md). Commands and conventions:
[AGENTS.md](../AGENTS.md).

## Components

```
iPhone (Safari / home-screen PWA), on the tailnet
  │  https://<host>.<tailnet>.ts.net:7444   tailscale serve (foreground, TLS by Tailscale)
  │                                          adds Tailscale-User-Login for user-owned devices
  ▼
yamt start   (one Bun process, binds 127.0.0.1:7890 only)
  ├─ Hono JSON API   /api/*   identity-header auth (except /api/health), same-origin writes,
  │                           zod-validated bodies
  ├─ SPA             /*       packages/web/dist   (dev: Vite on 7891 proxies /api)
  └─ SQLite          ~/.yamt/yamt.db   (WAL, foreign keys, 0600)
     data dir        ~/.yamt/  (0700): yamt.db, media/, runs/, config.json
```

## Layout

```
packages/shared/src/      contracts shared by server and web (no runtime deps but zod)
  api.ts                  API paths, request schemas, response types
packages/server/src/
  cli.ts                  `yamt start` (flags: --data-dir --port --https-port --local --no-auth --dev --no-build)
  server.ts               composition root: data dir, DB, API, static; the mount points
  config.ts               data dir resolution and setup, config.json, ports, version
  tailscale.ts            `tailscale serve --https=<port>` in the foreground
  build-stamp.ts          rebuild packages/web/dist when its sources changed
  auth/identity.ts        requireTailnetIdentity: the Tailscale-User-Login check, dev bypass
  auth/bearer.ts          requireBearer: token auth for machine clients (/mcp, from #7)
  http/                   api.ts (routes), middleware.ts (sameOrigin, errors), origin.ts, static.ts
  domain/errors.ts        HttpError
  db/                     index.ts (open, pragmas, migration runner, newId), migrations/*.sql
packages/server/test/     bun tests, temp dirs only
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
  stops it too ("add a new migration instead"). There are none yet; #6 adds the first tables.
- **Repositories:** no ORM. Each aggregate gets `db/repos/<entity>.ts` with the SQL for it,
  taking a `Db` and returning the shared domain types; services and routes never write SQL.
  Ids are UUIDv7 (`newId()`), so they sort by creation time.

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

Wave 1 adds, in stack order: meals, captures, media storage, the job queue and weight entries
(#6); the nutrition data layer and the yamt MCP server at `/mcp` (#7); the ACP runtime and the
meal analysis job (#8); the transcription worker (#9); the PWA shell and meal capture (#10);
meal detail, questions and corrections (#11); the day view, goals and weight (#12); Web Push
(#13). Spikes #4 (speech-to-text, CPU vs GPU) and #5 (design directions; the result becomes
`docs/design/design.md` and replaces the neutral theme tokens) run alongside. See the epic for
the decisions each one builds on.
