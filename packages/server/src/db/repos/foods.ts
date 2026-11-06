import type { Food, FoodSource, Nutrients, NutrientValue, Portion } from "@yamt/shared";
import type { FoodData } from "../../nutrition/nutrients.ts";
import { type Db, newId } from "../index.ts";

/** The core-set columns, shared with meal_items (per 100 g). */
export const NUTRIENT_COLUMNS = {
  energyKcal: "energy_kcal",
  protein: "protein_g",
  fat: "fat_g",
  saturatedFat: "saturated_fat_g",
  carbohydrate: "carbohydrate_g",
  sugars: "sugars_g",
  fiber: "fiber_g",
  salt: "salt_g",
} as const satisfies Record<keyof Nutrients, string>;

export type NutrientRow = { [K in (typeof NUTRIENT_COLUMNS)[keyof Nutrients]]: number | null };

export const nutrientsOf = (r: NutrientRow): Nutrients => ({
  energyKcal: r.energy_kcal,
  protein: r.protein_g,
  fat: r.fat_g,
  saturatedFat: r.saturated_fat_g,
  carbohydrate: r.carbohydrate_g,
  sugars: r.sugars_g,
  fiber: r.fiber_g,
  salt: r.salt_g,
});

export const nutrientValues = (n: Nutrients) =>
  [n.energyKcal, n.protein, n.fat, n.saturatedFat, n.carbohydrate, n.sugars, n.fiber, n.salt] as const;

const NUTRIENT_SQL = Object.values(NUTRIENT_COLUMNS).join(", ");

interface Row extends NutrientRow {
  id: string;
  source: FoodSource;
  source_ref: string | null;
  name: string;
  brand: string | null;
  nutrients: string;
  portions: string;
  raw: string | null;
  fetched_at: number | null;
  created_at: number;
  updated_at: number;
}

const toFood = (r: Row): Food => ({
  id: r.id,
  source: r.source,
  sourceRef: r.source_ref,
  name: r.name,
  brand: r.brand,
  per100g: nutrientsOf(r),
  nutrients: JSON.parse(r.nutrients) as Record<string, NutrientValue>,
  portions: JSON.parse(r.portions) as Portion[],
  fetchedAt: r.fetched_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface SaveFood {
  source: FoodSource;
  sourceRef: string | null;
  data: FoodData;
  /** The source payload, or what a label/custom food was made from. */
  raw: unknown;
  /** When it was fetched from a source; null for label and custom foods. */
  fetchedAt: number | null;
  now?: number;
}

/** A food someone ate before, as personal history search finds it. */
export interface HistoryHit {
  food: Food;
  /** Distinct meals whose revisions used it. */
  meals: number;
  lastUsedAt: number;
  /** FTS5 bm25: lower is better. */
  rank: number;
}

/**
 * The food cache: every food yamt knows (looked up, searched, read off a label, made up), keyed
 * by (source, sourceRef) when it has one, so a refetch updates the row in place. Revisions copy a
 * food's core numbers when they use it, so updating a food never changes old totals.
 */
export class FoodRepo {
  constructor(private readonly db: Db) {}

  /** Insert, or update the row with the same (source, sourceRef). */
  save(f: SaveFood): Food {
    const now = f.now ?? Date.now();
    const existing = f.sourceRef === null ? null : this.bySource(f.source, f.sourceRef);
    const d = f.data;
    const values = [
      d.name,
      d.brand,
      ...nutrientValues(d.per100g),
      JSON.stringify(d.nutrients),
      JSON.stringify(d.portions),
      f.raw === undefined ? null : JSON.stringify(f.raw),
      f.fetchedAt,
    ] as const;
    if (existing) {
      this.db
        .query(
          `UPDATE foods SET name = ?, brand = ?, energy_kcal = ?, protein_g = ?, fat_g = ?, saturated_fat_g = ?,
             carbohydrate_g = ?, sugars_g = ?, fiber_g = ?, salt_g = ?, nutrients = ?, portions = ?, raw = ?,
             fetched_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(...values, now, existing.id);
      return this.get(existing.id)!;
    }
    const id = newId();
    this.db
      .query(
        `INSERT INTO foods (id, source, source_ref, name, brand, ${NUTRIENT_SQL}, nutrients, portions, raw,
           fetched_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, f.source, f.sourceRef, ...values, now, now);
    return this.get(id)!;
  }

  get(id: string): Food | null {
    const r = this.db.query<Row, [string]>("SELECT * FROM foods WHERE id = ?").get(id);
    return r ? toFood(r) : null;
  }

  bySource(source: FoodSource, sourceRef: string): Food | null {
    const r = this.db
      .query<Row, [string, string]>("SELECT * FROM foods WHERE source = ? AND source_ref = ?")
      .get(source, sourceRef);
    return r ? toFood(r) : null;
  }

  getMany(ids: readonly string[]): Map<string, Food> {
    if (ids.length === 0) return new Map();
    const unique = [...new Set(ids)];
    const rows = this.db
      .query<Row, string[]>(`SELECT * FROM foods WHERE id IN (${unique.map(() => "?").join(", ")})`)
      .all(...unique);
    return new Map(rows.map((r) => [r.id, toFood(r)]));
  }

  /**
   * What the shopping list's aisles read off foods (#49): the name, and from the source payload the
   * Open Food Facts categories (`categories_tags`) or the USDA food category (`foodCategory`, a
   * branded food's `brandedFoodCategory`), without parsing the whole payload.
   */
  aisleData(ids: readonly string[]): Map<string, { name: string; source: FoodSource; categories: string[] }> {
    if (ids.length === 0) return new Map();
    const unique = [...new Set(ids)];
    const rows = this.db
      .query<
        {
          id: string;
          name: string;
          source: FoodSource;
          off: string | null;
          fdc: string | null;
          fdc_name: string | null;
          branded: string | null;
        },
        string[]
      >(
        `SELECT id, name, source,
           CASE WHEN json_valid(raw) THEN json_extract(raw, '$.categories_tags') END AS off,
           CASE WHEN json_valid(raw) THEN json_extract(raw, '$.foodCategory') END AS fdc,
           CASE WHEN json_valid(raw) THEN json_extract(raw, '$.foodCategory.description') END AS fdc_name,
           CASE WHEN json_valid(raw) THEN json_extract(raw, '$.brandedFoodCategory') END AS branded
         FROM foods WHERE id IN (${unique.map(() => "?").join(", ")})`,
      )
      .all(...unique);
    return new Map(
      rows.map((r) => {
        const categories: string[] = [];
        if (r.off) {
          try {
            const tags = JSON.parse(r.off) as unknown;
            if (Array.isArray(tags))
              categories.push(...tags.filter((t): t is string => typeof t === "string"));
          } catch {
            // not a list: no categories
          }
        }
        // a search hit's foodCategory is a string, a food detail's an object with a description
        const fdc = r.fdc_name ?? (r.fdc && !r.fdc.startsWith("{") ? r.fdc : null);
        if (fdc) categories.push(fdc);
        if (r.branded) categories.push(r.branded);
        return [r.id, { name: r.name, source: r.source, categories }];
      }),
    );
  }

  /** The source payload as stored (JSON), for debugging and re-mapping. */
  raw(id: string): unknown {
    const r = this.db.query<{ raw: string | null }, [string]>("SELECT raw FROM foods WHERE id = ?").get(id);
    return r?.raw ? JSON.parse(r.raw) : null;
  }

  /**
   * Personal history: foods used in any revision of a meal that wasn't removed, whose name or
   * brand matches every word of the query (prefix match, umlauts folded), best FTS match first,
   * then the most used. Falls back to any word matching when all of them together find nothing.
   */
  searchHistory(query: string, limit: number): HistoryHit[] {
    const words = ftsWords(query);
    if (words.length === 0) return [];
    const run = (match: string) =>
      this.db
        .query<Row & { meals: number; last_used_at: number; rank: number }, [string, number]>(
          `SELECT f.*, h.meals, h.last_used_at, fts.rank
           FROM foods_fts fts
           JOIN foods f ON f.id = fts.food_id
           JOIN (SELECT i.food_id, count(DISTINCT r.meal_id) AS meals, max(r.created_at) AS last_used_at
                 FROM meal_items i JOIN meal_revisions r ON r.id = i.revision_id
                 JOIN meals m ON m.id = r.meal_id
                 WHERE i.food_id IS NOT NULL AND m.removed_at IS NULL GROUP BY i.food_id) h ON h.food_id = f.id
           WHERE foods_fts MATCH ?
           ORDER BY fts.rank, h.meals DESC, h.last_used_at DESC
           LIMIT ?`,
        )
        .all(match, limit);
    let rows = run(words.join(" "));
    if (rows.length === 0 && words.length > 1) rows = run(words.join(" OR "));
    return rows.map((r) => ({ food: toFood(r), meals: r.meals, lastUsedAt: r.last_used_at, rank: r.rank }));
  }

  /**
   * Every food yamt has cached (looked up, searched, read off a label, made up) whose name or
   * brand matches every word of the query, best FTS match first; no network (#45's matcher asks
   * it before Open Food Facts and USDA). Falls back to any word matching, like `searchHistory`.
   */
  searchCached(query: string, limit: number): Food[] {
    const words = ftsWords(query);
    if (words.length === 0) return [];
    const run = (match: string) =>
      this.db
        .query<Row, [string, number]>(
          `SELECT f.* FROM foods_fts fts JOIN foods f ON f.id = fts.food_id
           WHERE foods_fts MATCH ? ORDER BY fts.rank, f.updated_at DESC LIMIT ?`,
        )
        .all(match, limit);
    let rows = run(words.join(" "));
    if (rows.length === 0 && words.length > 1) rows = run(words.join(" OR "));
    return rows.map(toFood);
  }
}

/** Query words as FTS5 prefix terms, quoted so no user input is FTS syntax. */
export function ftsWords(query: string): string[] {
  return (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).map((w) => `"${w}"*`);
}
