import {
  addDays,
  CORE_NUTRIENTS,
  type CoreNutrient,
  type Nutrients,
  TARGET_KEYS,
  type TargetKey,
} from "@yamt/shared";
import { z } from "zod";
import type { FoodCandidate, SearchSource } from "../domain/foods.ts";
import { dayRange, isoLocal, localDate } from "../domain/time.ts";
import { type Tool, ToolError, tool } from "../mcp/tools.ts";
import { computeTotals, roundNutrient } from "../nutrition/totals.ts";
import type { Services } from "../services.ts";
import { PlanningStore, type Slot, SlotRef, SourceMode } from "./store.ts";

/**
 * SPIKE #38: the meal-planning prototype tools. Not production code: a file-backed store, no
 * scopes beyond `interactive`, a round id instead of a run token.
 *
 * - get_planning_context: the request, the goal, each requested slot's day (eaten, open, a
 *   budget for the slot computed by code), recent meals, leftovers, preferences, earlier rounds
 * - match_ingredients: a whole ingredient list → ranked candidates per ingredient in one call
 * - save_round_outline / save_suggestion: the round's ideas first, then one complete suggestion
 *   at a time; save_suggestion computes per-portion nutrition and the fit to the slot's budget
 */

/** How a day's open targets are shared between the main slots still to come. */
const SLOT_WEIGHT: Record<Slot, number> = { breakfast: 25, lunch: 35, dinner: 35, snack: 10 };
const MAIN_SLOTS: Slot[] = ["breakfast", "lunch", "dinner"];
const KEYS: readonly TargetKey[] = TARGET_KEYS;

/** The slot a logged meal sits in, by its local hour. */
function slotOfHour(h: number): Slot {
  return h < 11 ? "breakfast" : h < 15 ? "lunch" : h < 17 ? "snack" : "dinner";
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** State words in food names (German and English), to flag raw/cooked/dry mismatches. */
const STATE_WORDS: Record<string, RegExp> = {
  raw: /\b(raw|roh|frisch|fresh|uncooked)\b/i,
  cooked:
    /\b(cooked|gekocht|boiled|gegart|steamed|gedünstet|roasted|geröstet|baked|gebacken|fried|gebraten|grilled)\b/i,
  dry: /\b(dry|dried|trocken|getrocknet|uncooked|ungekocht)\b/i,
  canned: /\b(canned|dose|konserve|drained|abgetropft|abgetr)\b/i,
};

function stateHints(name: string): string[] {
  return Object.entries(STATE_WORDS)
    .filter(([, re]) => re.test(name))
    .map(([k]) => k);
}

/** Energy vs 4P + 4C + 9F + 2 fibre: a candidate whose numbers don't add up gets a warning. */
function implausible(n: Nutrients): string | null {
  if (n.energyKcal === null || n.protein === null || n.fat === null || n.carbohydrate === null) return null;
  const est = 4 * n.protein + 4 * n.carbohydrate + 9 * n.fat + 2 * (n.fiber ?? 0);
  if (n.energyKcal < 20 && est < 20) return null;
  const off = Math.abs(est - n.energyKcal) / Math.max(n.energyKcal, est);
  return off > 0.25 ? `energy ${n.energyKcal} kcal vs ${Math.round(est)} from macros` : null;
}

const core = (n: Nutrients) => ({
  kcal: n.energyKcal,
  protein: n.protein,
  fat: n.fat,
  carbs: n.carbohydrate,
  fiber: n.fiber,
});

const IngredientInput = z
  .object({
    key: z.string().trim().max(40).optional().describe("Your handle for it (default: its position)."),
    name: z.string().trim().min(1).max(120).describe('As in the recipe, German: "Hokkaido-Kürbis".'),
    grams: z
      .number()
      .positive()
      .max(5_000)
      .describe("Amount for the whole recipe, in the state given (raw weight unless state says otherwise)."),
    state: z
      .enum(["raw", "cooked", "dry", "canned", "as_sold"])
      .default("as_sold")
      .describe(
        "The state the grams are in: raw (fresh produce, raw meat), dry (pasta, rice, lentils as weighed dry), cooked, canned (drained weight), as_sold (packaged: cheese, milk, oil, spices).",
      ),
    kind: z
      .enum(["generic", "product"])
      .default("generic")
      .describe(
        "generic: a plain ingredient (vegetables, meat, rice, oil) → history, then USDA (fdcQuery), then Open Food Facts; product: something packaged where the product matters (Skyr, Feta, Kokosmilch light, a brand) → history, then Open Food Facts.",
      ),
    query: z.string().trim().max(120).optional().describe("German search words if not the name."),
    fdcQuery: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe('English USDA-style name for generic foods: "pumpkin, raw", "lentils, red, dry".'),
  })
  .strict();

const SuggestionIngredient = z
  .object({
    foodId: z.uuid().optional().describe("The matched food (from match_ingredients or search_foods)."),
    estimatePer100g: z
      .object({
        energyKcal: z.number().min(0).max(900),
        protein: z.number().min(0).max(100),
        fat: z.number().min(0).max(100),
        carbohydrate: z.number().min(0).max(100),
        fiber: z.number().min(0).max(100).optional(),
      })
      .strict()
      .optional()
      .describe("Only when nothing fits: your numbers per 100 g (carbohydrate without fibre)."),
    description: z.string().trim().min(1).max(200).describe('As in the recipe: "300 g Hokkaido, gewürfelt".'),
    grams: z.number().positive().max(5_000).describe("For the whole recipe (all portions cooked)."),
    fromLeftover: z.boolean().optional().describe("Uses up a leftover."),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export function planningTools(s: Services): Tool[] {
  const store = new PlanningStore(s.dataDir);
  const tz = s.timeZone;

  const mustRequest = (roundId: string) => {
    const req = store.request(roundId);
    if (!req) throw new ToolError(`no planning round ${roundId}`);
    return req;
  };

  /** A requested slot's day: eaten so far, what's open, and the slot's share of it. */
  const slotDay = (ref: SlotRef) => {
    const day = s.revisions.day(ref.date, tz);
    const goal = s.repos.goals.inForce(ref.date);
    const eaten = day.totals.nutrients;
    const logged = new Set(
      day.meals
        .filter((m) => m.revision)
        .map((m) => slotOfHour(Number(isoLocal(m.meal.eatenAt, tz).slice(11, 13)))),
    );
    // main slots still to come that day (not logged yet), plus the requested one
    const remaining = new Set<Slot>(MAIN_SLOTS.filter((x) => !logged.has(x)));
    remaining.add(ref.slot);
    const weight = SLOT_WEIGHT[ref.slot] / [...remaining].reduce((a, x) => a + SLOT_WEIGHT[x], 0);
    const open: Partial<Record<CoreNutrient, number | null>> = {};
    const budget: Partial<Record<CoreNutrient, number | null>> = {};
    for (const k of KEYS) {
      const target = goal?.targets[k] ?? null;
      open[k] = target === null ? null : r1(Math.max(0, target - eaten[k]));
      budget[k] = target === null ? null : roundNutrient(k, Math.max(0, target - eaten[k]) * weight);
    }
    return {
      ...ref,
      mealsLogged: day.meals.map((m) => ({
        at: isoLocal(m.meal.eatenAt, tz).slice(11, 16),
        title: m.revision?.revision.title ?? "(not analysed)",
        kcal: m.revision?.totals.nutrients.energyKcal ?? null,
        protein: m.revision?.totals.nutrients.protein ?? null,
      })),
      eaten: Object.fromEntries(KEYS.map((k) => [k, eaten[k]])),
      open,
      slotsStillOpen: [...remaining],
      budgetForThisSlot: budget,
      budgetShare: r1(weight * 100),
    };
  };

  return [
    tool({
      name: "get_planning_context",
      scope: "interactive",
      description:
        "Everything a planning round needs, in one call: the request (free text, filters, steer), the goal in force, for each requested slot the day so far (meals logged, eaten, open) and the slot's budget (its share of what is open, computed by yamt), the recent meals (for variety), leftovers, preferences, and the suggestions of earlier rounds of this request.",
      schema: z.object({ roundId: z.string().min(1).max(80) }),
      run({ roundId }) {
        const req = mustRequest(roundId);
        const today = localDate(Date.now(), tz);
        const goal = s.repos.goals.inForce(today);
        const ctx = store.context();
        const from = dayRange(addDays(today, -14), tz).from;
        const recent = s.repos.meals
          .eatenBetween(from, Date.now())
          .flatMap((meal) => {
            const v = s.revisions.current(meal);
            if (!v) return [];
            return [
              {
                date: isoLocal(meal.eatenAt, tz).slice(0, 10),
                slot: slotOfHour(Number(isoLocal(meal.eatenAt, tz).slice(11, 13))),
                title: v.revision.title,
                kcal: v.totals.nutrients.energyKcal,
                protein: v.totals.nutrients.protein,
                mainItems: [...v.items]
                  .sort((a, b) => (b.nutrients.energyKcal ?? 0) - (a.nutrients.energyKcal ?? 0))
                  .slice(0, 4)
                  .map((i) => i.food?.name ?? i.description),
              },
            ];
          })
          .reverse();
        const earlier = req.previousRounds.map((id) => ({
          roundId: id,
          request: store.request(id)?.text ?? null,
          suggestions: store
            .suggestions<{
              title: string;
              pitch: string;
              timeMinutes: number;
              ingredients: { description: string }[];
              perPortion: Record<string, number>;
            }>(id)
            .map((x) => ({
              title: x.title,
              pitch: x.pitch,
              timeMinutes: x.timeMinutes,
              ingredients: x.ingredients.map((i) => i.description),
              perPortion: x.perPortion,
            })),
        }));
        return {
          today,
          request: req,
          goal: goal
            ? { effectiveFrom: goal.effectiveFrom, targets: goal.targets, note: goal.note || null }
            : null,
          slots: req.filters.slots.map(slotDay),
          recentMeals: recent,
          leftovers: ctx.leftovers,
          preferences: ctx.preferences,
          earlierRounds: earlier,
        };
      },
    }),

    tool({
      name: "match_ingredients",
      scope: "food",
      description:
        "Ground a whole ingredient list in one call: for each ingredient the best food candidates (the user's history first, then USDA for generic foods, Open Food Facts for products), ranked, each with a foodId, core nutrients per 100 g, what the given grams come to, state words found in its name, and warnings (state mismatch, numbers that don't add up). The first candidate is yamt's pick; check it (right food, right state) and take another candidate, re-match with better queries, or use search_foods for the few that miss.",
      schema: z.object({
        ingredients: z.array(IngredientInput).min(1).max(30),
        candidates: z.number().int().min(1).max(5).default(3).describe("Candidates per ingredient."),
      }),
      async run({ ingredients, candidates }) {
        const started = Date.now();
        const results = await Promise.all(
          ingredients.map(async (ing, idx) => {
            const t0 = Date.now();
            const q = ing.query ?? ing.name;
            const hist = await s.foods.search(q, { sources: ["history"], limit: candidates });
            // a history food whose name has every query word is the user's own product: done
            const strong = hist.candidates.filter((c) => c.score >= 1.5);
            const pool: FoodCandidate[] = [...hist.candidates];
            const unavailable: { source: SearchSource; reason: string }[] = [];
            const asked: string[] = ["history"];
            if (strong.length === 0) {
              const remote = async (query: string, sources: SearchSource[]) => {
                const r = await s.foods.search(query, { sources, limit: candidates + 2 });
                asked.push(...sources);
                unavailable.push(...r.unavailable);
                pool.push(...r.candidates);
                return r;
              };
              if (ing.kind === "generic" && ing.fdcQuery && s.foods.fdcAvailable) {
                const r = await remote(ing.fdcQuery, ["fdc"]);
                if (r.candidates.length === 0) await remote(q, ["off"]);
              } else {
                const r = await remote(q, ["off"]);
                if (r.candidates.length === 0 && ing.fdcQuery && s.foods.fdcAvailable) {
                  await remote(ing.fdcQuery, ["fdc"]);
                }
              }
            }
            // re-rank: same score order, a candidate whose name states another state drops
            const want = ing.state;
            const scored = pool
              .filter((c, i, a) => a.findIndex((x) => x.foodId === c.foodId) === i)
              .map((c) => {
                const hints = stateHints(`${c.name}`);
                let adj = c.score;
                const conflicts =
                  want !== "as_sold" &&
                  hints.length > 0 &&
                  !hints.includes(want) &&
                  !(want === "raw" && hints.every((h) => h === "raw"));
                if (conflicts) adj -= 0.4;
                if (want !== "as_sold" && hints.includes(want)) adj += 0.1;
                return { c, hints, adj, conflicts };
              })
              .sort((a, b) => b.adj - a.adj)
              .slice(0, candidates);
            const warnings: string[] = [];
            const top = scored[0];
            if (!top) warnings.push("no candidate: try other words, search_foods, or an estimate");
            else {
              if (top.conflicts) warnings.push(`top candidate looks ${top.hints.join("/")}, not ${want}`);
              const bad = implausible(top.c.per100g);
              if (bad) warnings.push(`top candidate: ${bad}`);
              if (top.c.per100g.energyKcal === null) warnings.push("top candidate has no energy value");
            }
            return {
              key: ing.key ?? String(idx + 1),
              name: ing.name,
              grams: ing.grams,
              state: ing.state,
              asked,
              candidates: scored.map(({ c, hints }) => ({
                foodId: c.foodId,
                name: c.name,
                brand: c.brand,
                foundIn: c.origin,
                ...(c.usedInMeals ? { usedInMeals: c.usedInMeals } : {}),
                per100g: core(c.per100g),
                forGrams: {
                  kcal:
                    c.per100g.energyKcal === null
                      ? null
                      : Math.round((c.per100g.energyKcal * ing.grams) / 100),
                  protein: c.per100g.protein === null ? null : r1((c.per100g.protein * ing.grams) / 100),
                },
                ...(hints.length ? { stateWords: hints } : {}),
                score: c.score,
              })),
              warnings,
              ...(unavailable.length ? { unavailable } : {}),
              ms: Date.now() - t0,
            };
          }),
        );
        return {
          ingredients: results,
          ms: Date.now() - started,
          note: "Pick per ingredient: the first candidate unless it is the wrong food or state. Pass the chosen foodIds with grams to save_suggestion.",
        };
      },
    }),

    tool({
      name: "save_round_outline",
      scope: "interactive",
      description:
        "Save the round's ideas before working any of them out: the app shows them at once as placeholders. One idea per suggestion to come, clearly different from each other (main protein, cuisine, method). Call once, before the first save_suggestion.",
      schema: z.object({
        roundId: z.string().min(1).max(80),
        plannedSlots: z
          .array(SlotRef)
          .min(1)
          .describe("The slots this round plans for (after resolving text vs filters)."),
        note: z.string().trim().max(400).optional().describe("If the text overrode a filter, say so here."),
        ideas: z
          .array(
            z
              .object({
                key: z.string().trim().min(1).max(40),
                title: z.string().trim().min(1).max(120),
                approach: z.string().trim().min(1).max(400).describe("One or two lines: what it is and why."),
                sourceMode: SourceMode,
                sourceUrl: z.url().max(2_000).optional(),
                sourceName: z.string().trim().max(120).optional().describe('E.g. "chefkoch.de".'),
                proposedSlot: SlotRef,
              })
              .strict(),
          )
          .min(1)
          .max(6),
      }),
      run(args) {
        mustRequest(args.roundId);
        const at = Date.now();
        store.setOutline(args.roundId, { ...args, savedAt: at });
        return {
          saved: args.ideas.length,
          next: "Now complete the ideas one at a time with save_suggestion.",
        };
      },
    }),

    tool({
      name: "save_suggestion",
      scope: "interactive",
      description:
        "Save one complete suggestion of the round (call it as soon as one is done, then go on with the next). Ingredients are matched foods with grams for the whole recipe; yamt computes the nutrition per portion and the fit to the slot's budget and returns them. Texts in German.",
      schema: z.object({
        roundId: z.string().min(1).max(80),
        ideaKey: z.string().trim().min(1).max(40).describe("The outline idea this completes."),
        title: z.string().trim().min(1).max(120),
        pitch: z.string().trim().min(1).max(300).describe("One line that sells it."),
        why: z
          .array(z.string().trim().min(1).max(160))
          .min(1)
          .max(3)
          .describe("Why it fits: goal, leftovers, variety, time."),
        timeMinutes: z.number().int().min(1).max(600).describe("Total time, prep included."),
        sourceMode: SourceMode,
        sourceUrl: z.url().max(2_000).optional(),
        sourceName: z.string().trim().max(120).optional(),
        changes: z
          .array(z.string().trim().min(1).max(160))
          .max(12)
          .default([])
          .describe('Changes vs the source recipe ("Sahne → Kokosmilch light"); empty for real/free.'),
        servings: z.number().int().min(1).max(12).describe("Portions the recipe as given cooks."),
        portionsEaten: z.number().min(0.25).max(4).default(1).describe("Portions the user eats at the slot."),
        proposedSlot: SlotRef,
        steps: z.array(z.string().trim().min(1).max(600)).min(1).max(20),
        ingredients: z.array(SuggestionIngredient).min(1).max(30),
        dryRun: z
          .boolean()
          .default(false)
          .describe("Only compute and return the numbers (to tune grams); nothing is saved."),
      }),
      run(args) {
        const req = mustRequest(args.roundId);
        const foods = s.repos.foods.getMany(args.ingredients.flatMap((i) => (i.foodId ? [i.foodId] : [])));
        const items = args.ingredients.map((i, idx) => {
          if (i.foodId) {
            const f = foods.get(i.foodId);
            if (!f) throw new ToolError(`ingredient ${idx + 1} (${i.description}): no food ${i.foodId}`);
            if (f.per100g.energyKcal === null) {
              throw new ToolError(`ingredient ${idx + 1} (${i.description}): ${f.name} has no energy value`);
            }
            return { ...i, food: f, per100g: f.per100g, provenance: "database" as const };
          }
          if (!i.estimatePer100g) throw new ToolError(`ingredient ${idx + 1}: a foodId or estimatePer100g`);
          const per100g = Object.fromEntries(CORE_NUTRIENTS.map((k) => [k, null])) as Nutrients;
          Object.assign(per100g, i.estimatePer100g);
          return { ...i, food: null, per100g, provenance: "estimate" as const };
        });
        const factor = args.portionsEaten / args.servings;
        const portion = computeTotals(
          items.map((i) => ({ grams: i.grams * factor, per100g: i.per100g, provenance: i.provenance })),
        );
        const whole = computeTotals(
          items.map((i) => ({ grams: i.grams, per100g: i.per100g, provenance: i.provenance })),
        );
        const day = slotDay(args.proposedSlot);
        const fit = Object.fromEntries(
          KEYS.map((k) => {
            const b = day.budgetForThisSlot[k] ?? null;
            const p = portion.nutrients[k];
            return [k, { portion: p, budget: b, diff: b === null ? null : roundNutrient(k, p - b) }];
          }),
        );
        const dayAfter = Object.fromEntries(
          KEYS.map((k) => [
            k,
            day.open[k] == null ? null : roundNutrient(k, (day.open[k] ?? 0) - portion.nutrients[k]),
          ]),
        );
        const perPortion = { grams: portion.grams, ...portion.nutrients };
        if (args.dryRun) {
          return { dryRun: true, perPortion, fitToSlot: fit, openForTheDayAfterThis: dayAfter };
        }
        const number = store.addSuggestion(args.roundId, {
          ...args,
          ingredients: items.map(({ food, per100g: _p, ...i }) => ({
            ...i,
            food: food ? { id: food.id, name: food.name, brand: food.brand, source: food.source } : null,
          })),
          perPortion,
          whole: { grams: whole.grams, ...whole.nutrients },
          missing: Object.fromEntries(Object.entries(portion.missing).filter(([, n]) => n > 0)),
          fit,
          savedAt: Date.now(),
        });
        const wanted = req.filters.count;
        return {
          saved: number,
          of: wanted,
          perPortion,
          fitToSlot: fit,
          openForTheDayAfterThis: dayAfter,
          estimates: items.filter((i) => i.provenance === "estimate").length,
          next:
            number < wanted
              ? "Go on with the next idea."
              : "That was the last one: end the turn with one short sentence.",
        };
      },
    }),
  ];
}
