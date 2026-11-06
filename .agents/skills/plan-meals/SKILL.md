---
name: plan-meals
description: SPIKE #38 prototype. Turn a yamt planning request (free text plus filters) into a round of meal suggestions, each a recipe whose ingredients are matched to real foods so yamt computes its macros, fitting the goal, what is open on the day, recent meals, leftovers and preferences. Use for yamt's background planning rounds.
---

# Plan meals

You suggest meals the user will actually cook. Each suggestion is a recipe whose ingredients are
real foods with grams; yamt computes the nutrition per portion and how it fits the day. **You
choose and judge; yamt calculates.** Never state calorie or macro numbers yourself and never take
them from a recipe website: they come from the matched ingredients.

The tools (yamt MCP server, `mcp__yamt__*`):

- `get_planning_context`: the request, the goal, each requested slot's day (logged, eaten, open,
  and the slot's **budget**, its share of what is open), recent meals, leftovers, preferences,
  and earlier rounds of this request.
- `match_ingredients`: a whole ingredient list in, ranked food candidates per ingredient out.
- `search_foods` / `get_food`: for the few ingredients the matcher misses.
- `fetch_recipe`: a recipe page's ingredients, yield and steps. Web search finds pages.
- `save_round_outline`: the round's ideas, saved first. `save_suggestion`: one finished
  suggestion (`dryRun: true` only computes, to tune grams).

## 1. Read the request (one call)

Call `get_planning_context` with the round id. Then decide, without more tools:

- **Slots.** The filters name slots; the free text may say otherwise ("eher Mittag") and then the
  text wins. Say so in the outline's `note`.
- **Hard filters**: the time cap (total time, prep included), constraints ("kein Ofen",
  "vegetarisch"), `neverEat`, missing equipment. A suggestion that breaks one is wrong.
- **Soft wishes**: leftovers to use up (use at least one in most suggestions when asked, in
  realistic amounts), dislikes (avoid), favourite sites (prefer for real recipes), the weekday
  cooking time.
- **Budget**: `budgetForThisSlot` is what a portion should roughly hit. Protein matters most on a
  cut: aim for at least the protein budget, kcal within about ±15 %. Fat is usually the one that
  overshoots.
- **Variety**: don't repeat the main dish or main protein of the last 3–4 days' meals.
- **Steering**: with earlier rounds and a `steer` text, start from them: keep what the steer
  doesn't object to, change what it says ("weniger Fleisch, schneller"), and don't repeat their
  suggestions.

## 2. Outline first

Before working anything out, call `save_round_outline` with exactly `filters.count` ideas (the
app shows them at once). Make them **clearly different**: different main protein, cuisine or
method, not three variations of one dish. Each idea: a title, one or two lines of approach, the
source mode, a source URL if you already have one, and a proposed slot. Spread the ideas over the
planned slots when there are several days; for one slot, all propose that slot.

## 3. Then complete one suggestion at a time

For each idea, in order: find or write the recipe → match its ingredients → save it. Save each as
soon as it is done, then go to the next; never batch the saves at the end.

### Recipe source mode

- `real` (real recipes only): a published recipe, as published. Find it with one web search
  (favourite sites first, German sites for German dishes), read it with `fetch_recipe`. Scale the
  amounts to the portions, but don't change ingredients. `changes` stays empty.
- `based_on` (default): a published recipe adapted to the goal and the request: leaner dairy,
  more protein, the leftover in, a step that the equipment can't do replaced. List each change in
  `changes` ("Sahne → Kokosmilch light", "+150 g Hähnchenbrust"). Keep the dish recognisable.
- `free`: compose your own recipe; no web search needed. `sourceName` "Eigenes Rezept".

Keep research short: one search and one or two fetches per suggestion. If a page has no usable
recipe, take the next hit or adapt from what you know, and say so (`based_on` without URL is not
allowed: then use `free`).

### Ingredients

- List every ingredient that counts (≥ ~10 kcal for the recipe), with **grams for the whole
  recipe as cooked** (`servings` portions). Household amounts become grams: 1 EL Öl ≈ 10–14 g,
  1 Zwiebel ≈ 80 g, 1 Knoblauchzehe ≈ 4 g, ½ Hokkaido ≈ 500 g (with skin, seeds out ≈ 420 g).
- **Fat and oil** for frying and roasting is an ingredient. Recipes understate it; write what the
  recipe says, else 1 EL per pan.
- The state the grams are in: dry pasta, rice, lentils, oats (as bought); raw meat, fish and
  vegetables; canned goods drained. The matched food must be in the same state.

### Matching (same grounding as log-meal)

Call `match_ingredients` **once per recipe** with the whole list. For each ingredient give the
German name, grams, `state`, `kind` (`generic` for plain ingredients, `product` where the product
matters: Feta, Skyr, Kokosmilch light, passierte Tomaten), and for generic ones an English
`fdcQuery` ("pumpkin, raw", "chicken breast, raw", "rice, white, long-grain, raw", "olive oil").

The first candidate is yamt's pick. Check each one like log-meal does: the right food (whole vs
skimmed, wholemeal vs white), the right state (raw/cooked/dry), plausible numbers (no 0 g fat for
cheese). History foods (`foundIn: "history"`) are what the user buys: take them when they fit.
Read the warnings. For a miss, take another candidate, or `search_foods` with better words; an
estimate (`estimatePer100g`) only when nothing fits. Don't search ingredient by ingredient when
the matcher has given you a good pick.

### Fit, then save

Optionally call `save_suggestion` with `dryRun: true` to see the portion against the budget, and
adjust grams once (more lean protein, less oil or cheese, more or less of the starch) so the
portion fits; don't loop. Then `save_suggestion` for real with:

- `title` (German, how a person would name the dish), `pitch` (one line that sells it),
  `why` (1–3 short lines: the goal ("48 g Protein, passt zu deinem Abend"), the leftover, the
  variety, the time); no numbers you computed yourself: the protein you quote must be what the
  dry run or the save returned, or leave numbers out.
- `timeMinutes` honestly (the recipe's total time; never more than the cap).
- `servings` (= `portionsToCook` unless the recipe can't be split), `portionsEaten` 1.
- `steps`: short, in German, with the scaled amounts.
- the ingredients with their `foodId`s and grams.

## 4. End

After the last `save_suggestion`, end with one short sentence. A round that saved at least one
suggestion counts; if you run out of ideas or time, save what you have rather than nothing.

## Background runs

Nobody answers during the run: decide, don't ask. Use only the yamt tools, web search and web
fetch; don't run commands or write files. Texts in German.
