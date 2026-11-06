import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  addDays,
  Confidence,
  dayProgress,
  type Food,
  FoodSource,
  type Goal,
  goalPeriods,
  isVoice,
  MAX_PLAN_DAYS,
  type MealRevisionView,
  MealSlot,
  type PlannedMealView,
  Provenance,
  RecipeSourceMode,
  type RecipeView,
  type Totals,
} from "@yamt/shared";
import { z } from "zod";
import { toCapture } from "../db/repos/captures.ts";
import { HttpError } from "../domain/errors.ts";
import { MAX_QUESTIONS } from "../domain/revisions.ts";
import { assertTimeZone, isoLocal, localDate } from "../domain/time.ts";
import { UpstreamError } from "../nutrition/http.ts";
import { fetchRecipe } from "../nutrition/recipe.ts";
import type { Services } from "../services.ts";
import type { McpPrincipal } from "./tokens.ts";

/** Sent as the MCP `instructions` (Claude Code puts them into the system prompt). */
export const MCP_INSTRUCTIONS = `yamt is the user's meal and macro log: a meal is a set of raw captures (voice transcripts, photos, text, links); an analysis saves a revision of items (a food + grams, with provenance and confidence) whose totals yamt computes.
Read a meal with get_meal, find foods with search_foods / lookup_barcode (personal history first, then Open Food Facts, then USDA) or create_food from a label, then save_meal_revision; never compute or state totals yourself.
A planning round (meal suggestions for the user's plan) is filled with get_planning_context, save_round_outline, match_ingredients (one call per recipe) and save_suggestion; yamt computes every number.`;

/** Who calls a tool. */
export interface ToolContext {
  principal: McpPrincipal;
}

/**
 * Which callers may use a tool: `meal` tools take a `mealId` that an analysis run's token must
 * match, `plan` tools a `roundId` that a planning run's token must match (#45), `food` tools are
 * open to every token, `interactive` tools only to the interactive token, which may use them all.
 */
export type Scope = "meal" | "plan" | "food" | "interactive";

export interface Tool {
  name: string;
  description: string;
  scope: Scope;
  schema: z.ZodObject;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> | unknown;
}

export function tool<S extends z.ZodObject>(def: {
  name: string;
  description: string;
  scope: Scope;
  schema: S;
  run(args: z.output<S>, ctx: ToolContext): Promise<unknown> | unknown;
}): Tool {
  return def as unknown as Tool;
}

/** A refusal the model should read and can act on (wrong id, missing data, …). */
export class ToolError extends Error {}

const id = (what: string) => z.uuid().describe(`The ${what} id.`);

const grams = z.number().min(0).max(100);
const NutrientsInput = z
  .object({
    energyKcal: z.number().min(0).max(900).describe("kcal per 100 g."),
    protein: grams.nullable().optional(),
    fat: grams.nullable().optional(),
    saturatedFat: grams.nullable().optional(),
    carbohydrate: grams
      .nullable()
      .optional()
      .describe("Available carbohydrate, excluding fiber (EU labels' Kohlenhydrate; US total minus fiber)."),
    sugars: grams.nullable().optional(),
    fiber: grams.nullable().optional().describe("Fiber (Ballaststoffe), separate from carbohydrate."),
    salt: grams.nullable().optional(),
  })
  .strict()
  .describe("Per 100 g: energy in kcal, the rest in grams (null or omitted where unknown).");

const PortionInput = z
  .object({ label: z.string().trim().min(1).max(80), grams: z.number().positive().max(10_000) })
  .strict();

const ItemInput = z
  .object({
    foodId: id("food (from search_foods, lookup_barcode, get_food or create_food)").optional(),
    estimatePer100g: NutrientsInput.optional().describe(
      "Only for a pure estimate without a fitting food: your numbers per 100 g. Prefer a food.",
    ),
    description: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .describe("The item as the user described it, in their language."),
    grams: z
      .number()
      .positive()
      .max(5_000)
      .describe("Grams eaten (convert portions using the food's portions)."),
    provenance: Provenance.describe(
      "weighed: the user gave the weight; label: numbers from a package label; database: a food from search/barcode with an estimated or stated amount; estimate: amount and numbers guessed.",
    ),
    confidence: Confidence.describe("How sure you are about this item (food and amount)."),
    note: z.string().trim().max(500).optional().describe("Why this food or amount, if not obvious."),
  })
  .strict();

const QuestionInput = z
  .object({
    question: z.string().trim().min(1).max(300).describe("One short question, in the user's language."),
    whyItMatters: z.string().trim().min(1).max(300),
    impactKcal: z.number().min(0).max(5_000).describe("Roughly how many kcal the answer could change."),
  })
  .strict();

export const RecipeItemInput = ItemInput.extend({
  grams: z
    .number()
    .positive()
    .max(10_000)
    .describe("Grams for the whole recipe (all its servings), as the food is weighed (raw, dry …)."),
  description: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe('The ingredient as written, e.g. "½ Hokkaido (ca. 500 g)", in the recipe\'s language.'),
  provenance: Provenance.describe(
    "database: a food from search/barcode (the usual case); label: numbers from a package label; estimate: no fitting food, numbers guessed; weighed: the user gave the weight.",
  ),
  optional: z.boolean().optional().describe('An ingredient the recipe marks optional ("Feta, optional").'),
});

/** The tools, in the order clients list them. */
export function yamtTools(s: Services): Tool[] {
  const tz = s.timeZone;
  const iso = (ms: number | null) => (ms === null ? null : isoLocal(ms, tz));

  return [
    tool({
      name: "get_meal",
      scope: "meal",
      description: `A meal with everything captured for it: transcripts of voice memos, text notes, links, photos (with a local file path you can view), corrections and answers to earlier questions, plus the current analysis revision (items, questions and their answers, computed totals) and the list of earlier revisions. Retracted captures are left out. Captures marked afterCurrentRevision arrived after the current revision was saved: take them into account. A revision of kind "copy" was logged again from an earlier meal (no analysis; its assumptions say from where and at what portion); one of kind "plan" was logged from a planned meal ("Ate it": the recipe's items for the portion eaten, no analysis; plannedMealId names it). A meal with removedAt set was removed by the user: it can be read, but nothing can be saved to it.`,
      schema: z.object({ mealId: id("meal") }),
      run({ mealId }) {
        const detail = s.meals.detail(mealId);
        const transcripts = new Map(detail.transcripts.map((t) => [t.captureId, t]));
        const current = detail.revision;
        const records = s.repos.captures.listForMeal(mealId);
        const live = records.filter((c) => c.retractedAt === null);
        return {
          meal: {
            id: detail.meal.id,
            status: detail.meal.status,
            eatenAt: iso(detail.meal.eatenAt),
            eatenAtSource: detail.meal.eatenAtSource,
            createdAt: iso(detail.meal.createdAt),
            ...(detail.meal.sourcePlannedMealId === null
              ? {}
              : { plannedMealId: detail.meal.sourcePlannedMealId }),
            ...(detail.meal.removedAt === null ? {} : { removedAt: iso(detail.meal.removedAt) }),
          },
          captures: live.map((rec) => {
            const c = toCapture(rec);
            const out: Record<string, unknown> = {
              id: c.id,
              kind: c.kind,
              at: iso(c.takenAt ?? c.capturedAt ?? c.createdAt),
            };
            if (c.text) out.text = c.text;
            if (c.url) out.url = c.url;
            if (c.questionId) out.answersQuestionId = c.questionId;
            if (isVoice(c)) {
              const t = transcripts.get(c.id);
              out.transcript = t ? { status: t.status, text: t.text } : null;
            }
            const path = rec.jpegPath ?? rec.mediaPath;
            if (path && !isVoice(c)) {
              out.media = {
                mimeType: rec.jpegPath ? "image/jpeg" : c.mimeType,
                fileName: c.fileName,
                path: s.media.absolute(path),
              };
            }
            if (current) out.afterCurrentRevision = c.createdAt > current.revision.createdAt;
            return out;
          }),
          retractedCaptures: records.length - live.length,
          currentRevision: current ? revisionOut(current, iso) : null,
          revisions: s.repos.revisions.listForMeal(mealId).map((r) => ({
            id: r.id,
            number: r.number,
            kind: r.kind,
            title: r.title,
            status: r.status,
            createdAt: iso(r.createdAt),
          })),
        };
      },
    }),

    tool({
      name: "search_foods",
      scope: "food",
      description: `Find foods by name, ranked: the user's own history first (foods used in earlier meals), then Open Food Facts (branded products, German market), then USDA FoodData Central (generic foods, English names: search "oats, rolled" rather than "Haferflocken"). Every candidate has a foodId to use in save_meal_revision, its source, core nutrients per 100 g and known portions. "unavailable" lists sources that could not be asked.`,
      schema: z.object({
        query: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe('Product or food name, e.g. "skyr natur", "Haferflocken".'),
        sources: z
          .array(z.enum(["history", "off", "fdc"]))
          .min(1)
          .optional()
          .describe("Limit the search, e.g. ['fdc'] for a generic food. Default: all three."),
        limit: z.number().int().min(1).max(25).optional().describe("Candidates to return (default 10)."),
      }),
      async run({ query, sources, limit }) {
        const res = await s.foods.search(query, { sources, limit });
        return {
          candidates: res.candidates.map((c) => ({
            foodId: c.foodId,
            foundIn: c.origin,
            source: c.source,
            sourceRef: c.sourceRef,
            name: c.name,
            brand: c.brand,
            per100g: c.per100g,
            portions: c.portions,
            ...(c.usedInMeals === null ? {} : { usedInMeals: c.usedInMeals }),
            score: c.score,
          })),
          unavailable: res.unavailable,
        };
      },
    }),

    tool({
      name: "get_food",
      scope: "food",
      description:
        "One food with its full nutrient profile per 100 g and its portions (e.g. 1 tbsp = 13.5 g). refresh: fetch it again from its source.",
      schema: z.object({ foodId: id("food"), refresh: z.boolean().optional() }),
      async run({ foodId, refresh }) {
        return foodOut(await s.foods.get(foodId, { refresh }), iso);
      },
    }),

    tool({
      name: "lookup_barcode",
      scope: "food",
      description:
        "A packaged product by its EAN/UPC barcode (from a photo): a food created from this package's label first, else Open Food Facts. If it is unknown, read the nutrition label off the photo and use create_food.",
      schema: z.object({
        barcode: z.string().trim().min(6).max(20).describe("The digits under the barcode."),
        refresh: z.boolean().optional().describe("Ask Open Food Facts again even if cached."),
      }),
      async run({ barcode, refresh }) {
        const food = await s.foods.barcode(barcode, { refresh });
        if (!food) {
          return {
            found: false,
            message:
              "Open Food Facts doesn't know this barcode. Read the label and use create_food (source label).",
          };
        }
        return { found: true, food: foodOut(food, iso) };
      },
    }),

    tool({
      name: "create_food",
      scope: "food",
      description: `Save a food yamt doesn't have: source "label" for numbers read off a package's nutrition label (give the barcode if visible, and the photo's captureId), "custom" for a home-made or otherwise unlisted food whose numbers you derived. Values per 100 g; convert per-serving labels. Returns the food to use in save_meal_revision.`,
      schema: z.object({
        source: FoodSource.extract(["label", "custom"]),
        name: z.string().trim().min(1).max(200).describe("The product name as printed, in its language."),
        brand: z.string().trim().max(120).optional(),
        barcode: z.string().trim().max(20).optional(),
        per100g: NutrientsInput,
        nutrients: z
          .record(
            z.string().min(1).max(80),
            z.object({ value: z.number().min(0), unit: z.string().min(1).max(10) }),
          )
          .optional()
          .describe(
            'Anything else on the label per 100 g, e.g. {"monounsaturated fat": {"value": 3, "unit": "g"}}.',
          ),
        portions: z
          .array(PortionInput)
          .max(10)
          .optional()
          .describe('E.g. [{"label": "1 slice", "grams": 25}].'),
        captureId: id("capture (the photo of the label)").optional(),
        note: z.string().trim().max(500).optional(),
      }),
      run(args, ctx) {
        if (args.captureId && ctx.principal.kind === "run") {
          const c = s.repos.captures.get(args.captureId);
          if (c && c.mealId !== ctx.principal.mealId)
            throw new ToolError("that capture belongs to another meal");
        }
        if (args.captureId && ctx.principal.kind === "plan") {
          throw new ToolError("captureId: a planning run has no captures; leave it out");
        }
        return foodOut(s.foods.create(args), iso);
      },
    }),

    tool({
      name: "fetch_recipe",
      scope: "food",
      description:
        "Fetch a recipe link (e.g. a chefkoch.de page from a link capture): its schema.org recipe (ingredients as written, yield/servings, the page's own nutrition per serving if stated, steps), or the page as plain text when it has none. Quantities are for the recipe's yield; scale to what was eaten.",
      schema: z.object({ url: z.url({ protocol: /^https?$/ }).max(4_000) }),
      async run({ url }) {
        try {
          return await fetchRecipe(s.fetch, url);
        } catch (e) {
          if (e instanceof UpstreamError) throw new ToolError(`could not fetch ${url}: ${e.message}`);
          throw e;
        }
      },
    }),

    tool({
      name: "save_meal_revision",
      scope: "meal",
      description: `Save your analysis of a meal as its new revision (earlier ones are kept). Each item is a food (foodId) with grams, or, only when nothing fits, an estimate with estimatePer100g. yamt computes the totals and returns them. Write down every assumption ("assumed 1 tbsp olive oil for frying"). Ask at most ${MAX_QUESTIONS} questions, and only when the answer could change the result by roughly 100 kcal or more; then the meal shows as needing input. Title and texts in the language of the captures.`,
      schema: z.object({
        mealId: id("meal"),
        title: z.string().trim().min(1).max(120).describe('Short, e.g. "Porridge mit Beeren".'),
        summary: z.string().trim().max(2_000).optional().describe("One or two sentences on what was eaten."),
        eatenAt: z.iso
          .datetime({ offset: true })
          .optional()
          .describe(
            "When it was eaten, if the captures say so more precisely than the meal's time (ISO 8601 with offset).",
          ),
        assumptions: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
        items: z.array(ItemInput).max(60),
        questions: z.array(QuestionInput).max(MAX_QUESTIONS).default([]),
      }),
      run(args, ctx) {
        if (ctx.principal.kind === "run") {
          const saved = s.repos.revisions.forRun(ctx.principal.runId)[0];
          if (saved) {
            throw new ToolError(
              `this run already saved revision ${saved.number}; a run saves exactly one revision, so it stays as saved`,
            );
          }
        }
        const view = s.revisions.save({
          mealId: args.mealId,
          runId: ctx.principal.kind === "run" ? ctx.principal.runId : null,
          title: args.title,
          summary: args.summary ?? "",
          eatenAt: args.eatenAt ? Date.parse(args.eatenAt) : null,
          assumptions: args.assumptions,
          items: args.items,
          questions: args.questions,
        });
        const meal = s.repos.meals.get(args.mealId)!;
        return { mealStatus: meal.status, revision: revisionOut(view, iso) };
      },
    }),

    tool({
      name: "get_day_summary",
      scope: "interactive",
      description:
        "The meals eaten on a day with their current analysis (title, status, totals), the day's computed totals, the goal in force that day with the progress against each target, and the weight measured that day. Meals without an analysis are listed but count nothing.",
      schema: z.object({
        date: z.iso.date().optional().describe("YYYY-MM-DD; default today."),
        timeZone: z
          .string()
          .max(60)
          .optional()
          .describe("IANA zone for the day's bounds; default the server's."),
      }),
      run({ date, timeZone }) {
        const zone = timeZone ?? tz;
        try {
          assertTimeZone(zone);
        } catch {
          throw new ToolError(`unknown time zone ${zone}`);
        }
        const day = s.revisions.day(date ?? localDate(Date.now(), zone), zone);
        const goal = s.repos.goals.inForce(day.date);
        const at = (ms: number) => isoLocal(ms, zone);
        return {
          date: day.date,
          timeZone: day.timeZone,
          meals: day.meals.map(({ meal, revision }) => ({
            mealId: meal.id,
            eatenAt: at(meal.eatenAt),
            status: meal.status,
            title: revision?.revision.title ?? null,
            revision: revision?.revision.number ?? null,
            totals: revision ? revision.totals.nutrients : null,
            openQuestions: revision?.questions.filter((q) => q.answeredByCaptureId === null).length ?? 0,
          })),
          totals: day.totals.nutrients,
          totalsByProvenance: Object.fromEntries(
            Object.entries(day.totals.byProvenance)
              .filter(([, t]) => t.items > 0)
              .map(([p, t]) => [p, t.nutrients.energyKcal]),
          ),
          missing: day.totals.missing,
          unanalysedMeals: day.unanalysed,
          goal: goal ? goalOut(goal) : null,
          progress: goal ? dayProgress(day.totals.nutrients, goal.targets) : null,
          weight: s.repos.weight
            .list({ from: day.from, to: day.to, limit: 100 })
            .map((w) => ({ kg: w.kg, measuredAt: at(w.measuredAt), note: w.note || null })),
        };
      },
    }),

    tool({
      name: "get_goals",
      scope: "interactive",
      description:
        "The user's daily goals: targets for kcal, protein, fat, carbohydrate and fibre (grams), each from a local date until the next goal starts, newest first, and the one in force on a date. Use it to compare days with the targets that applied then.",
      schema: z.object({
        date: z.iso.date().optional().describe("YYYY-MM-DD for `inForce`; default today."),
        timeZone: z.string().max(60).optional().describe("IANA zone for today; default the server's."),
      }),
      run({ date, timeZone }) {
        const zone = timeZone ?? tz;
        try {
          assertTimeZone(zone);
        } catch {
          throw new ToolError(`unknown time zone ${zone}`);
        }
        const on = date ?? localDate(Date.now(), zone);
        // each goal holds until the day before the next later one starts
        const goals = goalPeriods(s.repos.goals.list()).map((g) => ({
          ...goalOut(g),
          until: g.until,
          replacedSameDay: g.replaced,
        }));
        const inForce = s.repos.goals.inForce(on);
        return { date: on, inForce: inForce ? goalOut(inForce) : null, goals };
      },
    }),

    tool({
      name: "get_plan",
      scope: "interactive",
      description: `The meal plan for a range of local dates (at most ${MAX_PLAN_DAYS} days): per day the planned meals (slot, status planned / logged / skipped, recipe, portions cooked and eaten, the computed numbers of one portion and of the portion eaten), the meals eaten (with the slot each fills), the eaten totals over analysed meals, the projection (eaten + meals still planned), the goal in force with the projection's progress against each target, the main slots still open, and whether the day is mostly known (a past day, or breakfast, lunch and dinner eaten or planned). Every number is computed by yamt.`,
      schema: z.object({
        from: z.iso.date().optional().describe("YYYY-MM-DD; default today."),
        to: z.iso.date().optional().describe("YYYY-MM-DD (inclusive); default six days after from."),
        timeZone: z.string().max(60).optional().describe("IANA zone for the days; default the server's."),
      }),
      run({ from, to, timeZone }) {
        const zone = timeZone ?? tz;
        try {
          assertTimeZone(zone);
        } catch {
          throw new ToolError(`unknown time zone ${zone}`);
        }
        const start = from ?? localDate(Date.now(), zone);
        const plan = s.planning.plan({ from: start, to: to ?? addDays(start, 6), tz: zone });
        return {
          from: plan.from,
          to: plan.to,
          timeZone: plan.timeZone,
          today: plan.today,
          days: plan.days.map((d) => ({
            date: d.date,
            mostlyKnown: d.mostlyKnown,
            openSlots: d.openSlots,
            plannedMeals: d.plannedMeals.map(plannedOut),
            meals: d.meals.map((m) => ({
              mealId: m.mealId,
              title: m.title,
              eatenAt: isoLocal(m.eatenAt, zone),
              slot: m.slot,
              totals: m.totals?.nutrients ?? null,
              ...(m.plannedMealId ? { plannedMealId: m.plannedMealId } : {}),
            })),
            unanalysedMeals: d.unanalysed,
            eaten: d.eaten?.nutrients ?? null,
            projected: d.projected?.nutrients ?? null,
            goal: d.goal
              ? {
                  goalId: d.goal.id,
                  targets: d.goal.targets,
                  kind: d.goal.kind,
                  label: d.goal.label,
                  floorKcal: d.goal.floorKcal,
                }
              : null,
            projectedProgress:
              d.goal && d.projected ? dayProgress(d.projected.nutrients, d.goal.targets) : null,
          })),
        };
      },
    }),

    tool({
      name: "get_recipe",
      scope: "interactive",
      description:
        "A recipe with its items (grams for the whole recipe and for one portion, the matched food or the estimate, the computed nutrients), the totals per portion and for the whole recipe, steps, times, its source and what an adapted recipe changed.",
      schema: z.object({ recipeId: id("recipe") }),
      run({ recipeId }) {
        return recipeOut(s.recipes.get(recipeId), iso);
      },
    }),

    tool({
      name: "save_recipe",
      scope: "interactive",
      description: `Save a recipe with its ingredients matched to foods, for the meal plan. Each item is a food (foodId from search_foods, lookup_barcode or create_food) with grams for the whole recipe, or, only when nothing fits, an estimate with estimatePer100g; mark optional ones. sourceMode: "published" (as published; give the source), "adapted" (based on a real recipe; give the source and list the changes, e.g. "Sahne → Kokosmilch light"), "composed" (your own). Never take the macros from the recipe's page: yamt computes them from the items and returns the totals per portion. Recipes are never changed: save a new one instead.`,
      schema: z.object({
        title: z.string().trim().min(1).max(120).describe('Short, e.g. "Kürbis-Curry mit Kichererbsen".'),
        summary: z.string().trim().max(300).default("").describe("One line on what it is."),
        sourceMode: RecipeSourceMode,
        sourceUrl: z
          .url({ protocol: /^https?$/ })
          .max(4_000)
          .optional(),
        sourceName: z.string().trim().max(120).optional().describe('E.g. "chefkoch.de".'),
        changes: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
        servings: z.number().int().min(1).max(50).describe("The portions the item grams are for."),
        timeActiveMin: z.number().int().min(0).max(1_440).optional(),
        timeTotalMin: z.number().int().min(0).max(10_080).optional(),
        steps: z.array(z.string().trim().min(1).max(2_000)).max(50).optional(),
        notes: z.string().trim().max(2_000).optional(),
        items: z.array(RecipeItemInput).min(1).max(60),
      }),
      run(args) {
        return recipeOut(s.recipes.save(args), iso);
      },
    }),

    tool({
      name: "plan_meal",
      scope: "interactive",
      description:
        "Put a saved recipe onto a local date's slot in the meal plan, at the end of that slot. portionsCooked: how many portions get cooked (default 1); portionEaten: the share of one portion the user eats (default 1). Returns the planned meal with its computed numbers.",
      schema: z.object({
        recipeId: id("recipe"),
        date: z.iso.date().describe("YYYY-MM-DD, the user's local date."),
        slot: MealSlot,
        portionsCooked: z.number().int().min(1).max(20).optional(),
        portionEaten: z.number().min(0.1).max(10).optional(),
        note: z.string().trim().max(1_000).optional(),
      }),
      run(args) {
        return plannedOut(s.planning.create(args).plannedMeal);
      },
    }),

    tool({
      name: "unplan_meal",
      scope: "interactive",
      description:
        "Take a planned meal off the plan. Only one still planned: logged and skipped ones are history.",
      schema: z.object({ plannedMealId: id("planned meal") }),
      run({ plannedMealId }) {
        s.planning.unplan(plannedMealId);
        return { unplanned: plannedMealId };
      },
    }),
  ];
}

function goalOut(g: Goal) {
  return { goalId: g.id, effectiveFrom: g.effectiveFrom, targets: g.targets, note: g.note || null };
}

function foodOut(f: Food, iso: (ms: number | null) => string | null) {
  return {
    foodId: f.id,
    source: f.source,
    sourceRef: f.sourceRef,
    name: f.name,
    brand: f.brand,
    per100g: f.per100g,
    portions: f.portions,
    nutrients: f.nutrients,
    fetchedAt: iso(f.fetchedAt),
  };
}

export const totalsOut = (t: Totals) => ({
  grams: t.grams,
  ...t.nutrients,
  ...(Object.values(t.missing).some((n) => n > 0)
    ? { missing: Object.fromEntries(Object.entries(t.missing).filter(([, n]) => n > 0)) }
    : {}),
});

function plannedOut(p: PlannedMealView) {
  return {
    plannedMealId: p.id,
    date: p.date,
    slot: p.slot,
    position: p.position,
    status: p.status,
    title: p.title,
    recipeId: p.recipeId,
    portionsCooked: p.portionsCooked,
    portionEaten: p.portionEaten,
    perPortion: { grams: p.perPortion.grams, ...p.perPortion.nutrients },
    eaten: { grams: p.eaten.grams, ...p.eaten.nutrients },
    ...(p.loggedMealId ? { loggedMealId: p.loggedMealId } : {}),
    ...(p.note ? { note: p.note } : {}),
  };
}

export function recipeOut(v: RecipeView, iso: (ms: number | null) => string | null) {
  const r = v.recipe;
  return {
    recipeId: r.id,
    title: r.title,
    summary: r.summary,
    sourceMode: r.sourceMode,
    sourceUrl: r.sourceUrl,
    sourceName: r.sourceName,
    changes: r.changes,
    servings: r.servings,
    timeActiveMin: r.timeActiveMin,
    timeTotalMin: r.timeTotalMin,
    steps: r.steps,
    notes: r.notes,
    createdAt: iso(r.createdAt),
    items: v.items.map((i) => ({
      itemId: i.id,
      description: i.description,
      grams: i.grams,
      portionGrams: i.portionGrams,
      ...(i.optional ? { optional: true } : {}),
      provenance: i.provenance,
      confidence: i.confidence,
      ...(i.note ? { note: i.note } : {}),
      food: i.food
        ? { foodId: i.food.id, name: i.food.name, brand: i.food.brand, source: i.food.source }
        : null,
      ...(i.food ? {} : { estimatePer100g: i.per100g }),
      portionNutrients: i.portionNutrients,
    })),
    perPortion: totalsOut(v.perPortion),
    whole: totalsOut(v.whole),
  };
}

function revisionOut(v: MealRevisionView, iso: (ms: number | null) => string | null) {
  return {
    id: v.revision.id,
    number: v.revision.number,
    // `copy`: logged again from another meal (#30); `plan`: logged from a planned meal (#36); neither
    // was analysed from this meal's captures
    kind: v.revision.kind,
    title: v.revision.title,
    summary: v.revision.summary,
    status: v.revision.status,
    eatenAt: iso(v.revision.eatenAt),
    assumptions: v.revision.assumptions,
    createdAt: iso(v.revision.createdAt),
    items: v.items.map((i) => ({
      description: i.description,
      grams: i.grams,
      provenance: i.provenance,
      confidence: i.confidence,
      ...(i.note ? { note: i.note } : {}),
      food: i.food
        ? { foodId: i.food.id, name: i.food.name, brand: i.food.brand, source: i.food.source }
        : null,
      ...(i.food ? {} : { estimatePer100g: i.per100g }),
      nutrients: i.nutrients,
    })),
    questions: v.questions.map((q) => ({
      id: q.id,
      question: q.question,
      whyItMatters: q.whyItMatters,
      impactKcal: q.impactKcal,
      answer: q.answer,
    })),
    totals: { grams: v.totals.grams, ...v.totals.nutrients },
    totalsByProvenance: Object.fromEntries(
      Object.entries(v.totals.byProvenance)
        .filter(([, t]) => t.items > 0)
        .map(([p, t]) => [p, { items: t.items, energyKcal: t.nutrients.energyKcal }]),
    ),
    missing: Object.fromEntries(Object.entries(v.totals.missing).filter(([, n]) => n > 0)),
  };
}

/** Runs a tool for a caller: scope check, argument validation, errors as tool errors. */
export async function callTool(
  tools: readonly Tool[],
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<CallToolResult> {
  const t = tools.find((x) => x.name === name);
  if (!t || !allowed(t, ctx.principal)) return errorResult(`no tool ${name} for this token`);
  const parsed = t.schema.safeParse(args);
  if (!parsed.success) return errorResult(`invalid arguments: ${z.prettifyError(parsed.error)}`);
  const input = parsed.data as Record<string, unknown>;
  if (t.scope === "meal" && ctx.principal.kind === "run" && input.mealId !== ctx.principal.mealId) {
    return errorResult(`this run may only use meal ${ctx.principal.mealId}`);
  }
  if (t.scope === "plan" && ctx.principal.kind === "plan" && input.roundId !== ctx.principal.roundId) {
    return errorResult(`this run may only use planning round ${ctx.principal.roundId}`);
  }
  try {
    const out = await t.run(input, ctx);
    return { content: [{ type: "text", text: JSON.stringify(out, null, 1) }] };
  } catch (e) {
    if (e instanceof ToolError) return errorResult(e.message);
    if (e instanceof HttpError) return errorResult(e.hint ? `${e.message} (${e.hint})` : e.message);
    console.error(`mcp tool ${name} failed`, e);
    return errorResult(`${name} failed: internal error`);
  }
}

export const allowed = (t: Tool, p: McpPrincipal): boolean =>
  p.kind === "interactive" ||
  t.scope === "food" ||
  (t.scope === "meal" && p.kind === "run") ||
  (t.scope === "plan" && p.kind === "plan");

const errorResult = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});
