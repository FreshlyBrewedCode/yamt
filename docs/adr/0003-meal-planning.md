# 0003. Meal planning: planning requests as background jobs, recipes and planned meals as aggregates

## Status

Accepted, 2026-11-05 (epic #36, wave 3, with #39). Spike #38 decides the ingredient matcher's
shape, the default number of suggestions per round and the planning model; the subtasks that
build on it (#36's 5–6) amend this ADR where they settle those details.

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
   harness, model and effort from the settings (a planning line under Settings → Agent, defaulting
   to the analysis settings), a run token scoped to the request, the behaviour in one skill,
   `.agents/skills/plan-meals/SKILL.md` (the counterpart of log-meal). It runs with the app
   closed; a push arrives when a round is done.
3. **A request has rounds; a round saves an outline first, then each suggestion as it is done.**
   The outline (titles, approach, source, a proposed slot) shows at once as placeholders; every
   suggestion is saved the moment it is complete. A round succeeds with at least one complete
   suggestion, and what finished stays if the run dies. "Suggest more" is another round with the
   same input; "steer" adds input and starts a round from the previous ones.
4. **Every suggestion is matched to real foods, and code computes its numbers.** Ingredients go
   through the log-meal grounding order (history → Open Food Facts → USDA → estimate) with the
   same validation as revision items; nutrition per portion and the fit to the day come from
   `computeTotals`, never from the model or the recipe page. A one-call ingredient matcher keeps
   this fast; its interface is spike #38's to decide.
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
