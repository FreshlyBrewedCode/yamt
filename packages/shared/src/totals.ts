import {
  CORE_NUTRIENTS,
  type CoreNutrient,
  type Nutrients,
  type NutrientTotals,
  type Provenance,
  Provenance as ProvenanceEnum,
  type Totals,
} from "./api-nutrition.ts";

// Nutrition: the model reads, code computes. These are the only functions totals come from, on the
// server and, for a live preview before saving ("Ate it", #40), in the web app; the server computes
// again on save.

/** What the totals are computed from: an amount and the numbers per 100 g. */
export interface TotalsItem {
  grams: number;
  per100g: Nutrients;
  provenance: Provenance;
}

/** Totals are shown rounded: kcal to whole numbers, grams to one decimal. */
export function roundNutrient(k: CoreNutrient, v: number): number {
  return k === "energyKcal"
    ? Math.round(v)
    : k === "salt"
      ? Math.round(v * 100) / 100
      : Math.round(v * 10) / 10;
}

/** One item's share of each nutrient (null where its source has no value), rounded. */
export function itemNutrients(
  item: Pick<TotalsItem, "grams" | "per100g">,
): Record<CoreNutrient, number | null> {
  return Object.fromEntries(
    CORE_NUTRIENTS.map((k) => {
      const v = item.per100g[k];
      return [k, v === null ? null : roundNutrient(k, (v * item.grams) / 100)];
    }),
  ) as Record<CoreNutrient, number | null>;
}

const zero = (): Record<CoreNutrient, number> =>
  Object.fromEntries(CORE_NUTRIENTS.map((k) => [k, 0])) as Record<CoreNutrient, number>;

/**
 * The only place totals come from: per-100 g values × grams, summed per nutrient, for all items
 * and per provenance. Pure and deterministic; sums are taken unrounded and rounded once at the
 * end. A missing value counts as 0 and is reported in `missing`, so the UI can say "fiber unknown
 * for 1 item" instead of pretending.
 */
export function computeTotals(items: readonly TotalsItem[]): Totals {
  const sum = () => ({ grams: 0, items: 0, nutrients: zero() });
  const all = sum();
  const byProvenance = Object.fromEntries(ProvenanceEnum.options.map((p) => [p, sum()])) as Record<
    Provenance,
    NutrientTotals
  >;
  const missing = zero();

  for (const item of items) {
    const groups = [all, byProvenance[item.provenance]];
    for (const g of groups) {
      g.grams += item.grams;
      g.items += 1;
    }
    for (const k of CORE_NUTRIENTS) {
      const v = item.per100g[k];
      if (v === null) {
        missing[k] += 1;
        continue;
      }
      for (const g of groups) g.nutrients[k] += (v * item.grams) / 100;
    }
  }

  const finish = (g: NutrientTotals): NutrientTotals => ({
    grams: Math.round(g.grams * 10) / 10,
    items: g.items,
    nutrients: Object.fromEntries(CORE_NUTRIENTS.map((k) => [k, roundNutrient(k, g.nutrients[k])])) as Record<
      CoreNutrient,
      number
    >,
  });
  return {
    ...finish(all),
    byProvenance: Object.fromEntries(
      ProvenanceEnum.options.map((p) => [p, finish(byProvenance[p])]),
    ) as Totals["byProvenance"],
    missing,
  };
}

/** Grams × a portion factor, to the hundredth of a gram (never 0: items need grams). */
export const scaleGrams = (grams: number, factor: number) =>
  Math.max(0.01, Math.round(grams * factor * 100) / 100);

/**
 * A recipe's items for `factor` portions (#36): grams ÷ `servings` × the factor (`scaleGrams`), the
 * excluded ones left out. What the plan counts, what "Ate it" logs and what its sheet previews.
 */
export function portionItems<T extends { id: string; grams: number }>(
  recipe: { servings: number },
  items: readonly T[],
  factor: number,
  exclude: ReadonlySet<string> = new Set(),
): T[] {
  return items
    .filter((i) => !exclude.has(i.id))
    .map((i) => ({ ...i, grams: scaleGrams(i.grams, factor / recipe.servings) }));
}
