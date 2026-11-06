# 0003. Meal planning: planning requests as background jobs, recipes and planned meals as aggregates

## Status

Accepted, 2026-11-05 (epic #36, wave 3, with #39). Spike #38 decides the ingredient matcher's
shape, the default number of suggestions per round and the planning model; the subtasks that
build on it (#36's 5–6) amend this ADR where they settle those details.

Amended 2026-11-06 by #45 (the suggestion job) with spike #38's numbers: decisions 2 and 4 are
made concrete, 11–15 are new.

## Context

Tracker #1's wave 3 was "planning only in agent sessions, the PWA shows the plan": the user would
plan in a Claude Code session over the yamt MCP tools and look at the result on the phone. In use,
the phone is where meals are thought about (on the way home, in the shop, at the stove), a chat
session on the VM is not, and logging works well precisely because it asks for no conversation:
capture freestyle, the agent works in the background, a push says it is done.

Planning has the same shape as logging, with the same pitfalls:

- **LLMs are bad calculators of nutrition** (ADR 0001, 8). A recipe the model suggests with "about
  45 g protein" is as unreliable as a meal it estimates; a website's nutrition table is the
  site's own guess. Numbers have to come from matched foods and code.
- **A plan changes under the user.** Recipes get adapted, portions change, a planned meal is
  eaten minus the feta or skipped. What was planned, what was cooked and what was eaten are
  different facts.
- **Runs are slow and cost money.** A round of researched, matched suggestions takes minutes
  (spike #38 measures how many); the user should see something at once and keep what finished if
  a run dies.

## Decision

1. **Planning happens in the PWA as planning requests, not as a chat.** A request is made like a
   meal: free text, voice memos, photos, links and paste, plus structured filters (when, which
   meals, a time cap, constraints, leftovers to use, the recipe source mode, portions to cook, how
   many suggestions). Filters stay structured fields, never flattened into the text; where the
   text and the filters disagree, the text wins and the round says what it planned for. This
   revises tracker #1's wave 3. Interactive MCP sessions stay a side door: the same tools, in the
   `interactive` scope.
2. **A request runs as background `plan` jobs on the existing worker**, like `analyse`: ACP,
   harness, model and effort from the settings (a planning line under Settings → Agent; *#45:* its
   own defaults, decision 12, rather than the analysis settings), a run token scoped to the round
   (*#45:* a principal of its own that sees the planning tools of its round and the food tools, no
   meal tools), the behaviour in one skill, `.agents/skills/plan-meals/SKILL.md` (the counterpart
   of log-meal). It runs with the app closed; a push arrives when a round is done.
3. **A request has rounds; a round saves an outline first, then each suggestion as it is done.**
   The outline (titles, approach, source, a proposed slot) shows at once as placeholders; every
   suggestion is saved the moment it is complete. A round succeeds with at least one complete
   suggestion, and what finished stays if the run dies. "Suggest more" is another round with the
   same input; "steer" adds input and starts a round from the previous ones.
4. **Every suggestion is matched to real foods, and code computes its numbers.** Ingredients go
   through the log-meal grounding order (history → Open Food Facts → USDA → estimate) with the
   same validation as revision items; nutrition per portion and the fit to the day come from
   `computeTotals`, never from the model or the recipe page. A one-call ingredient matcher keeps
   this fast; its interface is spike #38's to decide (*#45:* decision 14).
5. **Recipes and planned meals are their own aggregates, not meals with a status.** A **recipe**
   is insert-only (a changed recipe is a new row): title, summary, source mode, source, the changes
   an adaptation made, servings, times, steps, and items that carry their per-100 g snapshots
   copied from the food when saved, like meal items. A **planned meal** puts a recipe on a date
   and a slot (breakfast, lunch, dinner, snack) with the portions cooked and the portion eaten,
   and moves `planned` → `logged` | `skipped`. One portion is the recipe's grams ÷ its servings;
   what is eaten is one portion × the portion eaten, what is cooked (the shopping list) one
   portion × the portions cooked. A meal stays what was eaten; the plan never counts as eaten.
6. **Recipe source modes**: *as published* (a real recipe, "From chefkoch.de"), *adapted* (based
   on a real recipe, the changes listed: "Sahne → Kokosmilch light"; the default) and *composed*
   (the agent's own, "Composed for you"). A default in the settings, per request in the filters.
   Macros always come from the matched ingredients.
7. **"Ate it" logs a planned meal like Log again (#30)**: one request makes a new meal whose
   revision 1 has kind `plan`, no run and no model: the recipe's items minus the ones switched
   off, scaled to the portion eaten, with the stored per-100 g snapshots, an assumption naming
   the plan. The planned meal becomes `logged` and points at the meal; the meal names the planned
   meal. Anything more is a correction capture and an ordinary re-analysis.
8. **A plan is read like the calendar** (#33): a day projected as eaten + planned is classified
   with the shared classifier only once it is *mostly known* (a past day, or one with breakfast,
   lunch and dinner eaten or planned); before that it is "rest open". The server sends inputs,
   not verdicts.
9. **A nightly run** prepares full suggestions for today (shown on the planning entry screen) and
   starters (an idea and its kind from the agent, the live number from code when the screen
   opens); without it the entry screen shows starters computed by code.
10. **Preferences live in the database** (Settings → Planning: dislikes, never eat, equipment,
    weekday cooking time, favourite sites), never in the repo or the skill.

### Spike #38's numbers (#45)

Ten real rounds against a scratch server with made-up history (a cut at 2,200 kcal / 160 g
protein, twelve meals over ten days), Claude Code (claude-agent-acp 0.100.0); cost as Claude Code
reports it at API prices. USDA was unreachable in every run (a URL encoding bug), so every remote
lookup was Open Food Facts.

| Configuration | Outline | 1st suggestion | Round | Tool calls | Cost |
|---|---|---|---|---|---|
| 3, adapted, Opus default, no matcher | 20 s | 87 s | 201 s | 40 | $1.03 |
| 3, adapted, Opus default, matcher | 19 s | 82 s | 172 s | 17 | $1.05 |
| 3, adapted, **Opus medium**, matcher | 19 s | 69 s | 146 s | 16 | $0.81 |
| 3, adapted, Opus low | 12 s | 35 s | 88 s | 12 | $0.43 |
| 3, adapted, Sonnet 5 | 34 s | 164 s | 400 s | 24 | $1.02 |
| 3 dinners Tue–Thu, 2 portions | 13 s | 71 s | 126 s | 21 | $0.86 |
| 1 suggestion | 11 s | 62 s | 66 s | 7 | $0.38 |

11. **Three suggestions per round by default** (at most six): ~35–50 s each after a ~15–20 s
    outline, the round in ~2.5 min; six would take 5–6 min. The turn is capped at 2 min per
    suggestion + 1 min, at most 15 min; the idle timeout is the analysis's (3 min; the longest
    silence measured was 26 s with Opus).
12. **The planning agent defaults to Claude Code with Opus 5.5 at effort `medium`**: as good as
    the default effort, ~$0.8 a round. `low` skipped research and ignored the source mode;
    Sonnet 5 took 2.3× as long for the same cost and made more mistakes. Env (`YAMT_PLANNING_*`) >
    the app's planning setting > config.json `planning` > these defaults.
13. **A round is one sequential run, not parallel runs**: within one run the ideas were distinct
    every time; parallel runs without a shared outline repeat each other and fight over Open Food
    Facts' rate limit (5 searches in a burst, then one every 6 s). `save_suggestion` may replace
    its idea's title (said in a why-line); the proposed slot defaults to the idea's; a second save
    of an idea replaces it.
14. **The matcher** (`match_ingredients`): up to 30 ingredients `{name, grams (whole recipe),
    state raw|dry|cooked|canned|as_sold, kind generic|product, query?, fdcQuery?}` plus servings
    and the target slot → per ingredient ranked candidates (food id, name, brand, where found, core
    per 100 g, what the grams come to, state words, score, missing values) and warnings (wrong
    state, processed product, numbers that don't add up), plus one portion with the first
    candidates and its fit to the slot, so no dry-run save is needed. Routing: history first (a
    strong hit ends it), then every cached food, then USDA for generic ingredients, Open Food Facts
    for products; complete candidates rank higher, processed matches for raw ingredients lower
    ("Knoblauch granuliert" for garlic was the most common miss). The agent still picks. Against
    `search_foods` per ingredient: 40 → 17 tool calls, −15 % time, 3 → 0 estimates, the same cost;
    the first candidate was used for 74 % of 204 ingredients, a lower one for 13 %, the rest
    re-searched or estimated.
15. **A slot budget computed in code**: the spike's biggest quality problem was portions sized to
    everything still open (330 g of shrimp, a 1.47 kg risotto for one dinner). A main meal's
    portion is capped at 42 % of the day's target, room is kept for a snack, and what is open is
    shared between the day's open main slots; the skill treats it as a ceiling, not a target.

## Consequences

- The PWA gains a second main flow beside logging (the split bottom slab Log | Plan), and the
  worker a second agent job type; both reuse what logging built (ACP, the MCP server and its
  tokens, the queue, push, the upload queue for a request's captures).
- Planned numbers are as explainable as logged ones: every ingredient has a food and a
  provenance, totals come from one function, and a recipe's numbers never move under a planned
  meal because recipes are insert-only and carry their snapshots.
- "Ate it" is cheap and exact for the common case (eaten as planned, minus an item, half a
  portion); anything else costs a capture and an analysis run, as a correction does today.
- Rounds that save as they go make a slow run usable early and a failed one not wasted, at the
  cost of partial rounds the UI has to show honestly.
- Planning data (requests, recipes, plans, preferences) is personal like meals: it lives in the
  database only; the repo, issues and PRs use made-up recipes.
- Leftovers stay a short list and the shopping list a sum of planned grams minus leftovers: no
  pantry, no batch cooking (weighing the pot) and no offline list in this epic.
- A round costs roughly $0.8 at API prices (a subscription login spends quota instead) and takes
  ~2.5 min; a nightly run (#48) multiplies that by the days it prepares. Cached reads make up most
  of the tokens, so fewer model turns save time more than money.
