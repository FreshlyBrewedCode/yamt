import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Confidence, type Food, FoodSource, type MealRevisionView, Provenance } from "@yamt/shared";
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
Read a meal with get_meal, find foods with search_foods / lookup_barcode (personal history first, then Open Food Facts, then USDA) or create_food from a label, then save_meal_revision; never compute or state totals yourself.`;

/** Who calls a tool. */
export interface ToolContext {
  principal: McpPrincipal;
}

/**
 * Which callers may use a tool: `meal` tools take a `mealId` that a run token must match,
 * `food` tools are open to every token, `interactive` tools only to the interactive token.
 */
type Scope = "meal" | "food" | "interactive";

export interface Tool {
  name: string;
  description: string;
  scope: Scope;
  schema: z.ZodObject;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> | unknown;
}

function tool<S extends z.ZodObject>(def: {
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
    carbohydrate: grams.nullable().optional(),
    sugars: grams.nullable().optional(),
    fiber: grams.nullable().optional(),
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

/** The tools, in the order clients list them. */
export function yamtTools(s: Services): Tool[] {
  const tz = s.timeZone;
  const iso = (ms: number | null) => (ms === null ? null : isoLocal(ms, tz));

  return [
    tool({
      name: "get_meal",
      scope: "meal",
      description: `A meal with everything captured for it: transcripts of voice memos, text notes, links, photos (with a local file path you can view), corrections and answers to earlier questions, plus the current analysis revision (items, questions and their answers, computed totals) and the list of earlier revisions. Retracted captures are left out. Captures marked afterCurrentRevision arrived after the current revision was saved: take them into account.`,
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
            if (c.kind === "audio") {
              const t = transcripts.get(c.id);
              out.transcript = t ? { status: t.status, text: t.text } : null;
            }
            const path = rec.jpegPath ?? rec.mediaPath;
            if (path && c.kind !== "audio") {
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
        "The meals eaten on a day with their current analysis (title, status, totals) and the day's computed totals. Meals without an analysis are listed but count nothing.",
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
        };
      },
    }),
  ];
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

function revisionOut(v: MealRevisionView, iso: (ms: number | null) => string | null) {
  return {
    id: v.revision.id,
    number: v.revision.number,
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
  t.scope !== "interactive" || p.kind === "interactive";

const errorResult = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});
