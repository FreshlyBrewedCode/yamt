import { computeTotals, type Nutrients } from "@yamt/shared";
import { z } from "zod";
import type { FoodCandidate, FoodService, SearchSource } from "../domain/foods.ts";
import { words } from "../nutrition/ranking.ts";

/** Most ingredients one `match_ingredients` call takes (a recipe, spike #38: 6–14 per recipe). */
export const MAX_INGREDIENTS = 30;
/** A history candidate this good is what the user buys: remote sources aren't asked. */
const STRONG_HISTORY = 1.5;
/** A cached candidate this good (every word in its name, complete, the right state) skips remote. */
const STRONG_CACHE = 1.2;

/** Score changes the matcher applies on top of `scoreCandidate`. */
export const MATCH_ADJUST = {
  /** Its name states another state than the ingredient's ("gekocht" for dry rice). */
  stateConflict: -0.4,
  /** Its name states the ingredient's state ("roh" for raw). */
  stateMatch: 0.1,
  /** A processed product for a plain ingredient ("Knoblauch granuliert" for garlic). */
  processed: -0.35,
  /** No fibre value (fibre per portion would come out low). */
  noFiber: -0.05,
} as const;

export const IngredientState = z.enum(["raw", "dry", "cooked", "canned", "as_sold"]);
export type IngredientState = z.infer<typeof IngredientState>;

export const IngredientInput = z
  .object({
    name: z.string().trim().min(1).max(120).describe('As in the recipe, German: "Hokkaido-Kürbis".'),
    grams: z
      .number()
      .positive()
      .max(10_000)
      .describe(
        "For the whole recipe (all servings), in the state given (raw weight unless state says otherwise).",
      ),
    state: IngredientState.default("as_sold").describe(
      "The state the grams are in: raw (fresh produce, raw meat and fish), dry (pasta, rice, lentils, oats as weighed dry), cooked, canned (drained), as_sold (packaged: cheese, milk, oil, spices).",
    ),
    kind: z
      .enum(["generic", "product"])
      .default("generic")
      .describe(
        "generic: a plain ingredient (vegetables, meat, rice, oil) → history, the cache, then USDA (fdcQuery); product: something packaged where the product matters (Skyr, Feta, Kokosmilch light, a brand) → history, the cache, then Open Food Facts.",
      ),
    query: z.string().trim().max(120).optional().describe("German search words, if not the name."),
    fdcQuery: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe('English USDA-style name for generic foods: "pumpkin, raw", "lentils, red, dry".'),
  })
  .strict();
export type IngredientInput = z.infer<typeof IngredientInput>;

/** State words in food names (German and English), to flag raw / cooked / dry / canned mismatches. */
const STATE_WORDS: Record<Exclude<IngredientState, "as_sold">, RegExp> = {
  raw: /\b(raw|roh|frisch|fresh|uncooked)\b/i,
  cooked:
    /\b(cooked|gekocht|boiled|gegart|steamed|gedünstet|roasted|geröstet|baked|gebacken|fried|gebraten|grilled|gegrillt)\b/i,
  dry: /\b(dry|dried|trocken|getrocknet|ungekocht)\b/i,
  canned: /\b(canned|dose|konserve|drained|abgetropft|abgetr)\b/i,
};

/** Words of processed products that a plain (raw or generic) ingredient isn't. */
const PROCESSED = [
  "granuliert",
  "granulat",
  "granulated",
  "pulver",
  "powder",
  "chips",
  "salsa",
  "sauce",
  "sosse",
  "sose",
  "paste",
  "kandiert",
  "candied",
  "eingelegt",
  "pickled",
  "sirup",
  "syrup",
  "aufstrich",
  "spread",
  "mischung",
  "mix",
  "konfiture",
  "marmelade",
  "jam",
  "paniert",
  "breaded",
  "snack",
  "riegel",
  "aroma",
  "extrakt",
  "extract",
  "obazda",
  "dip",
  "chutney",
  "pesto",
];

export function stateWords(name: string): Exclude<IngredientState, "as_sold">[] {
  return (Object.entries(STATE_WORDS) as [Exclude<IngredientState, "as_sold">, RegExp][])
    .filter(([, re]) => re.test(name))
    .map(([k]) => k);
}

/** Processed-product words in a candidate's name the ingredient itself doesn't use. */
export function processedWords(candidate: string, ingredient: string): string[] {
  const own = new Set(words(ingredient));
  return [...new Set(words(candidate))].filter(
    (w) => !own.has(w) && PROCESSED.some((p) => w === p || (p.length >= 5 && w.endsWith(p))),
  );
}

/** Energy against 4 P + 4 C + 9 F + 2 fibre: numbers that don't add up get a warning. */
export function implausible(n: Nutrients): string | null {
  if (n.energyKcal === null || n.protein === null || n.fat === null || n.carbohydrate === null) return null;
  const est = 4 * n.protein + 4 * n.carbohydrate + 9 * n.fat + 2 * (n.fiber ?? 0);
  if (n.energyKcal < 20 && est < 20) return null;
  const off = Math.abs(est - n.energyKcal) / Math.max(n.energyKcal, est);
  return off > 0.25 ? `energy ${n.energyKcal} kcal vs ${Math.round(est)} from its macros` : null;
}

const CORE = ["energyKcal", "protein", "fat", "carbohydrate", "fiber"] as const;

export interface MatchCandidate {
  foodId: string;
  name: string;
  brand: string | null;
  foundIn: SearchSource;
  usedInMeals?: number;
  per100g: {
    kcal: number | null;
    protein: number | null;
    fat: number | null;
    carbs: number | null;
    fiber: number | null;
  };
  /** What the ingredient's grams come to with this food. */
  forGrams: { kcal: number | null; protein: number | null };
  stateWords?: string[];
  processed?: string[];
  missing?: string[];
  score: number;
}

export interface MatchedIngredient {
  /** 0, 1, … in the order given. */
  index: number;
  name: string;
  grams: number;
  state: IngredientState;
  kind: "generic" | "product";
  /** The sources asked, in order. */
  asked: SearchSource[];
  /** Best first: the first one is yamt's pick. */
  candidates: MatchCandidate[];
  warnings: string[];
  unavailable?: { source: SearchSource; reason: string }[];
}

interface Scored {
  c: FoodCandidate;
  adj: number;
  hints: string[];
  processed: string[];
  conflicts: boolean;
}

/** Re-ranks a pool for one ingredient: duplicates out, state and processing and completeness weighed in. */
function rank(pool: readonly FoodCandidate[], ing: IngredientInput): Scored[] {
  const seen = new Set<string>();
  const label = `${ing.name} ${ing.query ?? ""}`;
  const plain = ing.state === "raw" || (ing.kind === "generic" && ing.state !== "as_sold");
  return pool
    .filter((c) => {
      if (seen.has(c.foodId)) return false;
      seen.add(c.foodId);
      return true;
    })
    .map((c) => {
      const hints = stateWords(c.name);
      const want = ing.state;
      const conflicts =
        want !== "as_sold" &&
        hints.length > 0 &&
        !hints.includes(want) &&
        !(want === "dry" && hints.includes("raw"));
      const processed = plain ? processedWords(`${c.name} ${c.brand ?? ""}`, label) : [];
      let adj = c.score;
      if (conflicts) adj += MATCH_ADJUST.stateConflict;
      else if (want !== "as_sold" && hints.includes(want)) adj += MATCH_ADJUST.stateMatch;
      if (processed.length > 0) adj += MATCH_ADJUST.processed;
      if (c.per100g.fiber === null) adj += MATCH_ADJUST.noFiber;
      return { c, adj: Math.round(adj * 1000) / 1000, hints, processed, conflicts };
    })
    .sort((a, b) => b.adj - a.adj);
}

const good = (x: Scored | undefined, min: number) =>
  x !== undefined &&
  x.adj >= min &&
  !x.conflicts &&
  x.processed.length === 0 &&
  x.c.per100g.energyKcal !== null &&
  implausible(x.c.per100g) === null;

/**
 * One ingredient matched (spike #38's routing): the user's history first, and a strong hit there
 * ends it; then every cached food (no network), and a strong one ends it; then USDA for a
 * generic ingredient (its `fdcQuery`), Open Food Facts for a product, the other one if the first
 * found nothing. Ranked with `scoreCandidate`, then complete candidates and the right state up,
 * processed products for plain ingredients down.
 */
async function matchOne(
  foods: FoodService,
  ing: IngredientInput,
  index: number,
  limit: number,
): Promise<MatchedIngredient & { top: Nutrients | null }> {
  const q = ing.query || ing.name;
  const pool: FoodCandidate[] = [];
  const asked: SearchSource[] = [];
  const unavailable: { source: SearchSource; reason: string }[] = [];
  const ask = async (query: string, source: SearchSource) => {
    const r = await foods.search(query, { sources: [source], limit: limit + 3 });
    if (!asked.includes(source)) asked.push(source);
    unavailable.push(...r.unavailable);
    pool.push(...r.candidates);
    return r.candidates.length;
  };

  await ask(q, "history");
  if (!good(rank(pool, ing)[0], STRONG_HISTORY)) {
    await ask(q, "cache");
    if (ing.fdcQuery) await ask(ing.fdcQuery, "cache");
    if (!good(rank(pool, ing)[0], STRONG_CACHE)) {
      const fdc = foods.fdcAvailable && ing.fdcQuery ? ing.fdcQuery : null;
      if (ing.kind === "generic" && fdc) {
        if ((await ask(fdc, "fdc")) === 0) await ask(q, "off");
      } else {
        if ((await ask(q, "off")) === 0 && fdc) await ask(fdc, "fdc");
      }
    }
  }

  const ranked = rank(pool, ing).slice(0, limit);
  const warnings: string[] = [];
  const top = ranked[0];
  if (!top) warnings.push("no candidate: try other words (query, fdcQuery), search_foods, or an estimate");
  else {
    if (top.conflicts) warnings.push(`the first candidate looks ${top.hints.join("/")}, not ${ing.state}`);
    if (top.processed.length)
      warnings.push(`the first candidate looks processed (${top.processed.join(", ")})`);
    const bad = implausible(top.c.per100g);
    if (bad) warnings.push(`the first candidate's numbers don't add up: ${bad}`);
    if (top.c.per100g.energyKcal === null) warnings.push("the first candidate has no energy value");
  }
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    index,
    name: ing.name,
    grams: ing.grams,
    state: ing.state,
    kind: ing.kind,
    asked,
    candidates: ranked.map(({ c, hints, processed, adj }) => {
      const missing = CORE.filter((k) => c.per100g[k] === null);
      return {
        foodId: c.foodId,
        name: c.name,
        brand: c.brand,
        foundIn: c.origin,
        ...(c.usedInMeals ? { usedInMeals: c.usedInMeals } : {}),
        per100g: {
          kcal: c.per100g.energyKcal,
          protein: c.per100g.protein,
          fat: c.per100g.fat,
          carbs: c.per100g.carbohydrate,
          fiber: c.per100g.fiber,
        },
        forGrams: {
          kcal: c.per100g.energyKcal === null ? null : Math.round((c.per100g.energyKcal * ing.grams) / 100),
          protein: c.per100g.protein === null ? null : r1((c.per100g.protein * ing.grams) / 100),
        },
        ...(hints.length ? { stateWords: hints } : {}),
        ...(processed.length ? { processed } : {}),
        ...(missing.length ? { missing } : {}),
        score: adj,
      };
    }),
    warnings,
    ...(unavailable.length ? { unavailable: dedupe(unavailable) } : {}),
    top: top?.c.per100g ?? null,
  };
}

const dedupe = <T extends { source: string }>(list: T[]): T[] =>
  list.filter((u, i) => list.findIndex((x) => x.source === u.source) === i);

/**
 * Every ingredient of a recipe matched at once (in parallel; OFF's client paces itself), and one
 * portion (`servings` of the whole) with every first candidate, computed by `computeTotals`, so
 * the agent sees the fit before it saves. Ingredients without a candidate count nothing.
 */
export async function matchIngredients(
  foods: FoodService,
  ingredients: readonly IngredientInput[],
  opts: { servings: number; limit?: number },
): Promise<{ ingredients: MatchedIngredient[]; topPicks: ReturnType<typeof computeTotals> }> {
  const all = await Promise.all(ingredients.map((ing, i) => matchOne(foods, ing, i, opts.limit ?? 3)));
  const topPicks = computeTotals(
    all.flatMap((m) =>
      m.top ? [{ grams: m.grams / opts.servings, per100g: m.top, provenance: "database" as const }] : [],
    ),
  );
  return { ingredients: all.map(({ top: _t, ...m }) => m), topPicks };
}
