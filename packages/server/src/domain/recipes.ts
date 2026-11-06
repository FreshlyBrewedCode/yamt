import type { Recipe, RecipeItem, RecipeItemView, RecipeSourceMode, RecipeView, Totals } from "@yamt/shared";
import type { Repos } from "../db/repos/index.ts";
import { computeTotals, itemNutrients } from "../nutrition/totals.ts";
import { HttpError } from "./errors.ts";
import { scaleGrams } from "./meals.ts";
import { type ItemInput, resolveItems } from "./revisions.ts";

export interface SaveRecipeInput {
  title: string;
  summary: string;
  sourceMode: RecipeSourceMode;
  sourceUrl?: string | null;
  sourceName?: string | null;
  changes?: string[];
  servings: number;
  timeActiveMin?: number | null;
  timeTotalMin?: number | null;
  steps?: string[];
  notes?: string | null;
  /** For the whole recipe (`servings`), validated like revision items. */
  items: (ItemInput & { optional?: boolean })[];
}

/**
 * The items of a recipe for `factor` portions: grams ÷ servings × factor, to 0.01 g, as "Ate it"
 * logs them (so the plan and the logged meal compute the same totals). `exclude`: item ids left out.
 */
export function portionItems(
  recipe: Pick<Recipe, "servings">,
  items: readonly RecipeItem[],
  factor: number,
  exclude: ReadonlySet<string> = new Set(),
): RecipeItem[] {
  return items
    .filter((i) => !exclude.has(i.id))
    .map((i) => ({ ...i, grams: scaleGrams(i.grams, factor / recipe.servings) }));
}

/** The totals of recipe items: `computeTotals`, nothing else. */
export const recipeTotals = (items: readonly RecipeItem[]): Totals =>
  computeTotals(items.map((i) => ({ grams: i.grams, per100g: i.per100g, provenance: i.provenance })));

/**
 * Recipes (#36): saved with items matched to foods (validated like revision items, the food's
 * per-100 g numbers copied), never changed afterwards. Totals per portion and for the whole recipe
 * are computed whenever one is read.
 */
export class RecipeService {
  constructor(
    private readonly repos: Repos,
    private readonly now: () => number = Date.now,
  ) {}

  save(input: SaveRecipeInput): RecipeView {
    if (input.items.length === 0) throw new HttpError(400, "items: a recipe needs at least one item");
    const sourceUrl = input.sourceUrl?.trim() || null;
    const sourceName = input.sourceName?.trim() || null;
    const changes = (input.changes ?? []).map((c) => c.trim()).filter(Boolean);
    if (input.sourceMode !== "composed" && !sourceUrl && !sourceName) {
      throw new HttpError(400, `sourceUrl: a ${input.sourceMode} recipe names its source (a URL or a name)`);
    }
    if (input.sourceMode !== "adapted" && changes.length > 0) {
      throw new HttpError(
        400,
        `changes: only an adapted recipe lists changes (this one is ${input.sourceMode})`,
      );
    }
    const active = input.timeActiveMin ?? null;
    const total = input.timeTotalMin ?? null;
    if (active !== null && total !== null && total < active) {
      throw new HttpError(400, "timeTotalMin: the total time includes the active time");
    }
    const resolved = resolveItems(this.repos, input.items);
    const recipe = this.repos.recipes.insert({
      title: input.title.trim(),
      summary: input.summary.trim(),
      sourceMode: input.sourceMode,
      sourceUrl,
      sourceName,
      changes,
      servings: input.servings,
      timeActiveMin: active,
      timeTotalMin: total,
      steps: (input.steps ?? []).map((s) => s.trim()).filter(Boolean),
      notes: input.notes?.trim() || null,
      items: resolved.map((it, n) => ({ ...it, optional: input.items[n]?.optional ?? false })),
      now: this.now(),
    });
    return this.view(recipe.id)!;
  }

  /** The recipe with its items (whole and per portion, with their foods) and both totals. */
  view(id: string): RecipeView | null {
    const recipe = this.repos.recipes.get(id);
    if (!recipe) return null;
    const items = this.repos.recipes.items(id);
    const portion = portionItems(recipe, items, 1);
    const foods = this.repos.foods.getMany(items.flatMap((i) => (i.foodId ? [i.foodId] : [])));
    const views: RecipeItemView[] = items.map((i, n) => {
      const food = i.foodId ? foods.get(i.foodId) : undefined;
      const one = portion[n]!;
      return {
        ...i,
        food: food ? { id: food.id, source: food.source, name: food.name, brand: food.brand } : null,
        nutrients: itemNutrients(i),
        portionGrams: one.grams,
        portionNutrients: itemNutrients(one),
      };
    });
    return { recipe, items: views, perPortion: recipeTotals(portion), whole: recipeTotals(items) };
  }

  get(id: string): RecipeView {
    const view = this.view(id);
    if (!view) throw new HttpError(404, "recipe not found");
    return view;
  }
}
