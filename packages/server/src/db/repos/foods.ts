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

  /** The source payload as stored (JSON), for debugging and re-mapping. */
  raw(id: string): unknown {
    const r = this.db.query<{ raw: string | null }, [string]>("SELECT raw FROM foods WHERE id = ?").get(id);
    return r?.raw ? JSON.parse(r.raw) : null;
  }

  /**
   * Personal history: foods used in any revision whose name or brand matches every word of the
   * query (prefix match, umlauts folded), best FTS match first, then the most used. Falls back to
   * any word matching when all of them together find nothing.
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
                 WHERE i.food_id IS NOT NULL GROUP BY i.food_id) h ON h.food_id = f.id
           WHERE foods_fts MATCH ?
           ORDER BY fts.rank, h.meals DESC, h.last_used_at DESC
           LIMIT ?`,
        )
        .all(match, limit);
    let rows = run(words.join(" "));
    if (rows.length === 0 && words.length > 1) rows = run(words.join(" OR "));
    return rows.map((r) => ({ food: toFood(r), meals: r.meals, lastUsedAt: r.last_used_at, rank: r.rank }));
  }
}

/** Query words as FTS5 prefix terms, quoted so no user input is FTS syntax. */
export function ftsWords(query: string): string[] {
  return (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).map((w) => `"${w}"*`);
}
