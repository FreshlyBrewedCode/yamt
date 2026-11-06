import type { Confidence, Nutrients, Provenance, Recipe, RecipeItem, RecipeSourceMode } from "@yamt/shared";
import { type Db, newId } from "../index.ts";
import { type NutrientRow, nutrientsOf, nutrientValues } from "./foods.ts";

interface RecipeRow {
  id: string;
  title: string;
  summary: string;
  source_mode: RecipeSourceMode;
  source_url: string | null;
  source_name: string | null;
  changes: string;
  servings: number;
  time_active_min: number | null;
  time_total_min: number | null;
  steps: string;
  notes: string | null;
  created_at: number;
}

interface ItemRow extends NutrientRow {
  id: string;
  recipe_id: string;
  position: number;
  food_id: string | null;
  description: string;
  grams: number;
  provenance: Provenance;
  confidence: Confidence;
  note: string | null;
  optional: number;
}

const toRecipe = (r: RecipeRow): Recipe => ({
  id: r.id,
  title: r.title,
  summary: r.summary,
  sourceMode: r.source_mode,
  sourceUrl: r.source_url,
  sourceName: r.source_name,
  changes: JSON.parse(r.changes) as string[],
  servings: r.servings,
  timeActiveMin: r.time_active_min,
  timeTotalMin: r.time_total_min,
  steps: JSON.parse(r.steps) as string[],
  notes: r.notes,
  createdAt: r.created_at,
});

const toItem = (r: ItemRow): RecipeItem => ({
  id: r.id,
  recipeId: r.recipe_id,
  position: r.position,
  foodId: r.food_id,
  description: r.description,
  grams: r.grams,
  provenance: r.provenance,
  confidence: r.confidence,
  note: r.note,
  optional: r.optional === 1,
  per100g: nutrientsOf(r),
});

export interface NewRecipe {
  title: string;
  summary: string;
  sourceMode: RecipeSourceMode;
  sourceUrl: string | null;
  sourceName: string | null;
  changes: string[];
  servings: number;
  timeActiveMin: number | null;
  timeTotalMin: number | null;
  steps: string[];
  notes: string | null;
  items: {
    foodId: string | null;
    description: string;
    /** For the whole recipe. */
    grams: number;
    provenance: Provenance;
    confidence: Confidence;
    note: string | null;
    optional: boolean;
    /** The food's numbers (copied) or the estimate. */
    per100g: Nutrients;
  }[];
  now?: number;
}

/**
 * Recipes with their items: one aggregate, insert-only (the migration's triggers refuse updates
 * and deletes). A changed recipe is a new one, so a planned meal's numbers never move under it.
 */
export class RecipeRepo {
  constructor(private readonly db: Db) {}

  insert(r: NewRecipe): Recipe {
    const id = newId();
    return this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO recipes (id, title, summary, source_mode, source_url, source_name, changes, servings,
             time_active_min, time_total_min, steps, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          r.title,
          r.summary,
          r.sourceMode,
          r.sourceUrl,
          r.sourceName,
          JSON.stringify(r.changes),
          r.servings,
          r.timeActiveMin,
          r.timeTotalMin,
          JSON.stringify(r.steps),
          r.notes,
          r.now ?? Date.now(),
        );
      const item = this.db.query(
        `INSERT INTO recipe_items (id, recipe_id, position, food_id, description, grams, provenance, confidence,
           note, optional, energy_kcal, protein_g, fat_g, saturated_fat_g, carbohydrate_g, sugars_g, fiber_g, salt_g)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      r.items.forEach((it, i) => {
        item.run(
          newId(),
          id,
          i,
          it.foodId,
          it.description,
          it.grams,
          it.provenance,
          it.confidence,
          it.note,
          it.optional ? 1 : 0,
          ...nutrientValues(it.per100g),
        );
      });
      return this.get(id)!;
    })();
  }

  get(id: string): Recipe | null {
    const r = this.db.query<RecipeRow, [string]>("SELECT * FROM recipes WHERE id = ?").get(id);
    return r ? toRecipe(r) : null;
  }

  getMany(ids: readonly string[]): Map<string, Recipe> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = this.db
      .query<RecipeRow, string[]>(`SELECT * FROM recipes WHERE id IN (${unique.map(() => "?").join(", ")})`)
      .all(...unique);
    return new Map(rows.map((r) => [r.id, toRecipe(r)]));
  }

  items(recipeId: string): RecipeItem[] {
    return this.itemsOf([recipeId]).get(recipeId) ?? [];
  }

  /** The items of several recipes in one query, by recipe, in order. */
  itemsOf(recipeIds: readonly string[]): Map<string, RecipeItem[]> {
    const unique = [...new Set(recipeIds)];
    const out = new Map<string, RecipeItem[]>();
    if (unique.length === 0) return out;
    for (const r of this.db
      .query<ItemRow, string[]>(
        `SELECT * FROM recipe_items WHERE recipe_id IN (${unique.map(() => "?").join(", ")})
         ORDER BY recipe_id, position`,
      )
      .all(...unique)) {
      const list = out.get(r.recipe_id) ?? [];
      list.push(toItem(r));
      out.set(r.recipe_id, list);
    }
    return out;
  }
}
