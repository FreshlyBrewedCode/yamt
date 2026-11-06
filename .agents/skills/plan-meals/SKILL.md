---
name: plan-meals
description: Fill a yamt planning round with meal suggestions the user will actually cook - recipes (published, adapted or composed) whose ingredients are matched to real foods so yamt computes their macros - fitting the request's text and filters, the slot budgets of the days, the goal, recent meals (variety), earlier rounds and the user's verdicts, leftovers and preferences; outline first, then one suggestion at a time, saved with the yamt MCP tools; a nightly round also saves the starters the planning screen offers. Use for yamt's background planning rounds, and whenever the user asks to plan meals or suggest recipes in yamt.
---

# Plan meals

You suggest meals the user will cook and eat. Each suggestion is a recipe whose ingredients are
real foods with grams; yamt computes the nutrition per portion and how it fits the day. **You
choose and judge; yamt calculates.** Never state calorie or macro numbers you worked out yourself,
and never take them from a recipe website: they come from the matched ingredients.

The tools (yamt MCP server, `mcp__yamt__*`):

- `get_planning_context`: the request (filters and every input: texts, links, voice transcripts,
  photos with a path), this round, the earlier rounds with their suggestions and the user's
  verdicts, each requested day with a **budget per slot** computed by yamt, the goal, the meals of
  the last 14 days, leftovers and preferences.
- `save_round_outline`: the round's ideas, saved before anything is worked out.
- `match_ingredients`: a whole recipe's ingredient list in, ranked food candidates per ingredient
  and the portion's fit to the slot out.
- `search_foods` / `get_food` / `create_food`: for the few ingredients the matcher misses.
- `fetch_recipe`: a recipe page's ingredients, yield and steps. Web search finds pages.
- `save_suggestion`: one finished suggestion. `fail_suggestion`: give one idea up, with a reason.
- `save_starters`: a nightly round's starters (§7).

## 1. Read the request (one call)

Call `get_planning_context` with the round id from the prompt. Then decide, without more tools:

- **Text against filters.** The filters (days, slots, time cap, constraints, source mode,
  portions to cook, count) are what the user picked; the inputs are what they said. When they
  disagree, **the text wins** ("lieber Mittag" over a dinner filter, "Donnerstag nicht" over
  Tue–Thu): plan for the slots the text means, put those days and slots on the ideas, and if that
  changes what the request is for, give the outline a `requestTitle` ("Mittagessen Mi–Fr").
- **Hard rules**: the time cap (total time, prep included), constraints (`no_oven`, `one_pot`,
  `vegetarian`, `vegan`, `high_protein`, `low_carb`, or free text like "ohne Pilze"), the
  preferences' `neverEat`, missing equipment, and on a weekday (Monday–Friday)
  `preferences.weekdayCookingMin` as a second time cap (the request's own `timeCapMin` still
  applies on any day). A suggestion that breaks one is wrong.
- **Soft wishes**: leftovers to use up (`useUp`, `leftovers`; use at least one in most
  suggestions, in amounts a leftover really has), dislikes (avoid), favourite sites (look there
  first for a real recipe).
- **Photos and voice**: a photo of the fridge or a package says what is there; a transcript is the
  user speaking. Open photos by their path when they are not attached.

## 2. Realistic portions: the budget is a ceiling

Each day lists `slots` with a `budget` for one portion: its share of what is still open that day,
after room for a snack, and **never more than about 42 % of the day's target**. It is a
**ceiling, not a target**: kcal, fat and carbohydrate should stay at or below it; protein is the
share to aim for. Don't fill a nearly empty day with one huge dinner.

Size portions like a normal plate: 120–200 g raw meat or fish, 150–250 g tofu, 60–90 g dry pasta
or rice, 200–300 g potatoes, vegetables generously. Protein beyond ~50–60 g on one plate needs a
reason; a 1 kg portion is a mistake. On a cut, reach protein with lean sources (chicken breast,
fish, skyr, quark, lentils) rather than with more food. Fat usually overshoots: count it (below).

## 3. Variety, steering and verdicts

- **Variety by dish type**, not just by protein: don't repeat the dish type (curry, pasta, bowl,
  stew, soup, wrap, pan) or the main protein of the last 3–4 days' meals (`recentMeals`, their
  `mainItems`), and make the round's ideas clearly different from each other (dish type, main
  protein, cuisine, method).
- **Earlier rounds** (`earlierRounds`): never suggest one of their dishes again. A `picked` one is
  planned already; a `rejected` one is a "no" (avoid its dish type or main ingredient this round
  unless the text asks for it); no verdict means not decided.
- **Steering** (`round.kind: "steer"`, inputs with `newThisRound`): the new input is a reaction to
  the earlier rounds. Keep what it doesn't object to and change what it asks for ("weniger Fleisch,
  schneller" → vegetarian, shorter times). **More** (`kind: "more"`): the same request again, so
  new dishes that still fit it.

## 4. Outline first

Before working anything out, call `save_round_outline` with exactly `round.count` ideas (the app
shows them at once). Each idea: a title, one or two lines of approach, the source mode, a source
URL if you have one already, and the day and slot it is for. Spread the ideas over the requested
days and slots; for one slot, all propose that one.

**Outline discipline**: then work out exactly these ideas, in order. If one turns out not to work
(no recipe within the time cap, a dead link), replace it with something close, give
`save_suggestion` the new `title`, and say in a why-line what changed ("Statt Risotto: Eintopf,
ohne Ofen schneller"). If nothing works for it, `fail_suggestion` with a short German reason and go
on. If the prompt says the round was interrupted, keep its outline and complete only the ideas
still outlined.

## 5. Then one suggestion at a time

For each idea, in order: find or write the recipe → match its ingredients → save it. Save each as
soon as it is done, then go to the next; never batch the saves at the end. Keep research short:
one search and one or two fetches per suggestion.

### Source modes (the request's `sourceMode`)

- `published` (real recipes only): a published recipe, as published. Find it with a web search
  (favourite sites first, German sites for German dishes), read it with `fetch_recipe` (or web
  fetch). Scale the amounts to the portions, but don't change ingredients; no `changes`; give
  `sourceUrl` and `sourceName` ("chefkoch.de"). Its numbers may not fit the budget: that's fine.
- `adapted` (the default): a published recipe changed for the goal and the request: leaner dairy,
  more protein, the leftover in, a step the equipment can't do replaced. List each change
  ("Sahne → Kokosmilch light", "+150 g Hähnchenbrust"); keep the dish recognisable; give the
  source.
- `composed`: your own recipe, no research needed; `sourceName` "Eigenes Rezept".

**Fallbacks**: a page that is dead, a paywall or has no usable recipe → take the next search hit.
After two misses for an idea, adapt from what you know and say so (`adapted` without a source is
not allowed: then `composed`, and a why-line "Kein passendes Rezept gefunden, selbst
zusammengestellt"). Under `published`, if no real recipe fits, `fail_suggestion` rather than
inventing one.

### Ingredients

- Every ingredient that counts (≥ ~10 kcal for the recipe), with **grams for the whole recipe**
  (`servings` = the request's `portionsCooked` unless the recipe can't be split). Household
  amounts become grams: 1 EL Öl ≈ 10–14 g, 1 Zwiebel ≈ 80 g, 1 Knoblauchzehe ≈ 4 g, ½ Hokkaido
  ≈ 500 g (seeds out ≈ 420 g).
- **Fat and oil** for frying and roasting is an ingredient; recipes understate it. Write what the
  recipe says, else 1 EL per pan (log-meal §6, "Fats and oils").
- **The state the grams are in**, as in log-meal §5 ("Cooked vs raw"): dry pasta, rice, lentils,
  oats as bought; raw meat, fish and vegetables; canned goods drained. The matched food must be in
  the same state.

### Matching: one `match_ingredients` call per recipe

Call it **once per recipe** with the whole list, `servings`, and the idea's `slot` (date and
slot). For each ingredient: the German `name`, `grams`, `state` (`raw`, `dry`, `cooked`,
`canned`, `as_sold`), `kind` (`generic` for plain ingredients; `product` where the product
matters: Feta, Skyr, Kokosmilch light, passierte Tomaten), and for generic ones an English
`fdcQuery` ("pumpkin, raw", "chicken breast, raw", "rice, white, long-grain, raw", "olive oil").

The first candidate is yamt's pick. Check each one as log-meal §4 does: the right food (whole vs
skimmed, wholemeal vs white, lean mince for "mager"), the right state, plausible numbers (no 0 g
fat for cheese), not a processed product for a plain ingredient ("Knoblauch granuliert" for
garlic, candied ginger, "Apfel Chips"). Read the warnings. History foods (`foundIn: "history"`) are
what the user buys: take them when they fit. For a miss take another candidate, or `search_foods`
with better words; an estimate (`estimatePer100g`, provenance `estimate`) only when nothing fits.
Don't search ingredient by ingredient when the matcher gave a good pick, and don't call the
matcher again for the same recipe unless you changed it.

The answer has the portion with the first candidates and its `fitToSlot`: if kcal or fat
overshoot the budget, adjust once (less oil, cheese or starch, more vegetables or lean protein)
before saving; don't loop.

### Save

`save_suggestion` with the idea's `position` and:

- `title`: German, the way a person names the dish, like a meal title ("Kürbis-Linsen-Dal",
  "Lachs mit Ofengemüse"), 2–6 words.
- `summary`: one line that sells it. `why`: 1–4 short German lines, factual: the leftover it uses,
  the variety ("kein Curry seit Montag"), the time, the steer it follows. **No numbers you
  computed**: protein or kcal only as `save_suggestion` or `match_ingredients` returned them, else
  leave numbers out.
- `timeActiveMin`, `timeTotalMin` honestly (the recipe's; never more than the cap), `steps`
  short and in German with the scaled amounts, the source fields of its mode.
- the items: `foodId` (or `estimatePer100g`), `description` as in the recipe ("½ Hokkaido (ca. 500
  g)"), `grams` for the whole recipe, provenance `database` (matched) or `estimate`, confidence,
  `optional: true` for what the recipe marks optional.

It returns yamt's numbers per portion and the fit; you don't need to repeat them.

## 6. End

After the last idea, end with one short sentence. A round with at least one saved suggestion
counts; if you run out of time or ideas, save what you have rather than nothing.

## 7. The nightly round

A request with `origin: "nightly"` (the context also has a `nightly` part) was made by yamt at
night, not by the user: its first round prepares **today** for the main slots still open. Nobody
asked, so there is no text: plan from the day, the goal, the recent meals and the preferences.

- **Suggestions**: as for any round, over the request's slots. With fewer ideas than slots, dinner
  first (the meal cooked at home), then lunch, then breakfast; a breakfast or lunch idea must be
  quick (≤ 15 min active). Never propose what is planned or eaten today already.
- **Starters**: also call `save_starters` once (before the outline or after the last suggestion)
  with 4–6 ideas the planning screen offers until the next night. Each is a starting point the user
  taps to make a request of their own: `kind`, `text` (the idea as a short headline, **English
  like the app**, dishes and produce in German: "Lachs mal wieder", "High protein tonight"),
  `detail` (one line why, from the context: "Last fish 12 days ago" is wrong, "Your last fish was
  Lachs mit Kartoffeln" is right), the `filters` a tap applies (only what the idea needs: `when`
  today / tomorrow / week, `slots`, `timeCapMin`, `constraints`, `useUp` texts, `count`) and
  `ref`, the id it is about. **No numbers in text or detail**: the app computes each starter's
  number when the screen opens (the protein open now, how long since that meal, the leftover's
  amount), so the run never states one.
- **Kinds**, varied (at most two of one kind), each only when the context backs it:
  - `protein_gap`: a high-protein idea for tonight when the goal has a protein target (filters:
    today, dinner, `high_protein`).
  - `use_up`: something to use up: a leftover (`ref.leftoverId` from `leftovers`) or produce a
    recent input or request names (`filters.useUp`).
  - `variety`: a dish type or protein missing from `recentMeals` for a while; `ref.mealId` is the
    last meal that had it, if there is one.
  - `like_meal`: a twist on a meal logged often (`ref.mealId`: the newest of them).
  - `season`: what is in season this month in Germany.
  - `last_request`: a `recentRequests` request worth asking again (`ref.requestId`; its filters).
  - `other`: anything else that fits the user (preferences, the weekday).

## Background runs and interactive sessions

- **Background round** (yamt starts you with a round id): nobody answers during the run, so
  decide, don't ask. Use only the yamt tools, web search and fetch, and reading the request's
  photos; don't run commands or write files. A run that saves no suggestion counts as failed.
- **Interactive session** (the user asks you to plan in a Claude Code session): the same tools
  and the same steps for a round that is running; otherwise talk the ideas through and save
  recipes with `save_recipe` and `plan_meal`.
