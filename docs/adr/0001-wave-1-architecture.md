# 0001. Wave 1 architecture: raw captures, an ACP agent with yamt's own tools, tailnet-only

## Status

Accepted, 2026-11-02 (epic #2, wave 1: capture → analysis → log).

## Context

yamt is a personal meal and macro log with as little logging effort as possible: capture
freestyle on the phone (voice, photos, text, links), let an agent do the analysis afterwards,
and keep a dataset that later drives meal planning and retros (tracker #1). One person uses it,
from an iPhone, against an always-on VM on their tailnet.

Three facts shape the design:

- **LLMs are bad calculators of nutrition.** Unconstrained multimodal models show 25–50 %
  calorie error; the trackers worth taking seriously use the model to *perceive* (what is on the
  plate, how much) and a nutrition database for the numbers (`reports/`). Portion size and hidden
  ingredients are the real uncertainty, so the user must see where each number came from.
- **Models, prompts and food data will improve.** Whatever the agent produces today is a draft;
  the raw material must outlive it.
- **The repository is public, the data is not.** Meals, photos, voice memos, weight and goals
  are personal.

The sibling project vibe-center already runs agents over ACP, hosts an MCP gateway, and serves a
phone UI over `tailscale serve`. Wave 1 reuses its stack and conventions rather than inventing
new ones.

## Decision

1. **Same stack as vibe-center.** Bun workspaces (`shared`, `server`, `web`), TypeScript strict,
   Biome, Hono on `Bun.serve`, zod on every request body, `bun:sqlite` with repositories and
   append-only `.sql` migrations, UUIDv7 ids, React + Vite + TanStack Router/Query + Tailwind +
   shadcn/ui. One Bun process serves the API and the built web app.
2. **Data lives outside the repo.** Everything personal (SQLite database, media, agent traces,
   keys) is in `~/.yamt/` (or `YAMT_DATA_DIR`), created 0700 with 0600 database files. Tests,
   fixtures, issues and PRs use made-up data only.
3. **Tailnet-only, identity-header auth.** The server binds loopback. `tailscale serve` publishes
   it over HTTPS (needed for the microphone, the service worker and Web Push) and adds the
   caller's identity (`Tailscale-User-Login`); the server accepts a request only if that login
   matches the configured one. No login screen, no passwords, no sessions. Browser-facing
   state-changing requests additionally need a same-origin `Origin`, because the proxy attaches
   the identity to every request from the user's devices, including ones a foreign page triggers.
4. **Meal-centric capture, grouped by the user.** "Log meal" creates a meal; whatever is captured
   on that screen belongs to it. The user, not the agent, decides what belongs together; the agent
   only writes the title. Analysis starts when the user presses **Analyse**.
5. **Raw first: captures are immutable, analyses are revisioned.** Audio, photos, text and links
   are stored as captured and never edited or deleted (a mistaken one is retracted with a soft
   flag). Corrections and answers to the agent's questions are captures too. Adding to an analysed
   meal queues a new analysis revision; earlier revisions are kept. A whole meal is removed the
   same way: a soft `removed_at` on the meal, undone by a restore; nothing of it is deleted.
6. **The agent runs over ACP, not `claude -p`.** The runtime is a port of vibe-center's ACP layer
   (`@agentclientprotocol/sdk`, `claude-agent-acp`), with harness and model configurable. ACP
   gives a typed, streaming event stream (stored in full as the run's trace), image content
   blocks for photos, cancellation and permission control, and lets the harness be swapped
   without touching yamt's domain code. `claude -p` would tie us to one CLI's flags and output.
7. **The agent's tools are an MCP server hosted by yamt.** The yamt server exposes its own
   zod-validated tools over HTTP (`/mcp`): food search, history, saving items, asking a question.
   Background runs authenticate with a per-run bearer token; interactive Claude Code / T3
   sessions in the repo reach the same server through `.mcp.json`. The agent never touches the
   database or files directly; every write goes through code that validates it.
8. **The model reads, code computes, with provenance.** The agent produces items (a food match
   plus grams); totals are per-100 g nutrient data times grams, computed in code. Each item
   records its source (`weighed`, `label`, `database`, `estimate`), a confidence, and the
   assumptions made. Doubtful items are flagged; the agent asks at most one or two questions per
   meal and only when the answer materially changes the result.

## Consequences

- Any meal can be re-analysed later with a better prompt, model or food database, and a retro
  can compare revisions. The cost is storage (raw audio and photos are kept forever) and a data
  model with captures, revisions and items instead of one row per meal.
- Numbers are reproducible and explainable: the same items always give the same totals, and the
  UI can show which ones are guesses. The agent cannot "just answer" with a calorie figure; it
  has to go through the tools.
- One tool surface serves the background analysis and, from wave 3, interactive planning
  sessions. The MCP server becomes a real API that needs the same care as the HTTP one (bearer
  tokens, validation, tests).
- yamt depends on Tailscale for reachability, TLS and identity. Anything else on the VM can reach
  the loopback port and set the header itself, so the VM is part of the trust boundary; that is
  acceptable for a single-user machine. Requests from tagged tailnet devices carry no identity and
  are refused.
- ACP adds a protocol layer and a harness process per run compared to `claude -p`, but the layer
  is proven in vibe-center and keeps the harness and model swappable.
- Grouping by the user costs one tap ("Log meal") per meal, in exchange for never having the
  agent guess which captures form a meal.
- Every contribution has to keep personal data out of the repository, issues and PRs; the
  `.gitignore` blocks database files and data dirs as a second line of defence.
