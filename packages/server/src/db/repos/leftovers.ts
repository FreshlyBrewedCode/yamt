import type { Leftover, LeftoverSource, LeftoverStatus } from "@yamt/shared";
import { type Db, newId } from "../index.ts";

interface Row {
  id: string;
  description: string;
  food_id: string | null;
  quantity: string | null;
  grams: number | null;
  portions: number | null;
  source: LeftoverSource;
  planned_meal_id: string | null;
  recipe_id: string | null;
  cooked_on: string | null;
  round_id: string | null;
  suggestion_id: string | null;
  note: string | null;
  status: LeftoverStatus;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
}

const toLeftover = (r: Row): Leftover => ({
  id: r.id,
  description: r.description,
  foodId: r.food_id,
  quantity: r.quantity,
  grams: r.grams,
  portions: r.portions,
  source: r.source,
  plannedMealId: r.planned_meal_id,
  recipeId: r.recipe_id,
  cookedOn: r.cooked_on,
  roundId: r.round_id,
  suggestionId: r.suggestion_id,
  note: r.note,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  closedAt: r.closed_at,
});

export interface NewLeftover {
  id?: string;
  description: string;
  foodId?: string | null;
  quantity?: string | null;
  grams?: number | null;
  portions?: number | null;
  source: LeftoverSource;
  plannedMealId?: string | null;
  recipeId?: string | null;
  cookedOn?: string | null;
  roundId?: string | null;
  suggestionId?: string | null;
  note?: string | null;
  now?: number;
}

/** Leftovers (#49): a short list, `open` → `used` | `gone`. A cooked one's portions go down as it is eaten. */
export class LeftoverRepo {
  constructor(private readonly db: Db) {}

  insert(l: NewLeftover): Leftover {
    const id = l.id ?? newId();
    const now = l.now ?? Date.now();
    this.db
      .query(
        `INSERT INTO leftovers (id, description, food_id, quantity, grams, portions, source, planned_meal_id,
           recipe_id, cooked_on, round_id, suggestion_id, note, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      )
      .run(
        id,
        l.description,
        l.foodId ?? null,
        l.quantity ?? null,
        l.grams ?? null,
        l.portions ?? null,
        l.source,
        l.plannedMealId ?? null,
        l.recipeId ?? null,
        l.cookedOn ?? null,
        l.roundId ?? null,
        l.suggestionId ?? null,
        l.note ?? null,
        now,
        now,
      );
    return this.get(id)!;
  }

  get(id: string): Leftover | null {
    const r = this.db.query<Row, [string]>("SELECT * FROM leftovers WHERE id = ?").get(id);
    return r ? toLeftover(r) : null;
  }

  /** The cooked leftover of a planned meal. */
  ofPlannedMeal(plannedMealId: string): Leftover | null {
    const r = this.db
      .query<Row, [string]>("SELECT * FROM leftovers WHERE planned_meal_id = ?")
      .get(plannedMealId);
    return r ? toLeftover(r) : null;
  }

  /**
   * The open ones, oldest first; a pack noted for a suggestion only once a planned meal of that
   * suggestion is logged (before that, nothing is left over yet).
   */
  listOpen(): Leftover[] {
    return this.db
      .query<Row, []>(
        `SELECT * FROM leftovers l WHERE status = 'open' AND (suggestion_id IS NULL OR EXISTS (
           SELECT 1 FROM planned_meals p WHERE p.suggestion_id = l.suggestion_id AND p.status = 'logged'))
         ORDER BY created_at, id`,
      )
      .all()
      .map(toLeftover);
  }

  /** A pack a round noted, by its description (a retried run notes the same one again). */
  ofRound(roundId: string): Leftover[] {
    return this.db
      .query<Row, [string]>("SELECT * FROM leftovers WHERE round_id = ? ORDER BY created_at, id")
      .all(roundId)
      .map(toLeftover);
  }

  setStatus(id: string, status: LeftoverStatus, now = Date.now()): Leftover | null {
    this.db
      .query("UPDATE leftovers SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?")
      .run(status, status === "open" ? null : now, now, id);
    return this.get(id);
  }

  /** A cooked one's portions left (to 0.01), and its status with them. */
  setPortions(id: string, portions: number, status: LeftoverStatus, now = Date.now()): Leftover | null {
    const before = this.get(id);
    if (!before) return null;
    const closedAt = status === "open" ? null : before.status === status ? before.closedAt : now;
    this.db
      .query("UPDATE leftovers SET portions = ?, status = ?, closed_at = ?, updated_at = ? WHERE id = ?")
      .run(Math.round(portions * 100) / 100, status, closedAt, now, id);
    return this.get(id);
  }

  /** A pack noted again: its amounts and note replaced. */
  replaceAmounts(
    id: string,
    l: Pick<NewLeftover, "foodId" | "quantity" | "grams" | "note">,
    now = Date.now(),
  ): Leftover | null {
    this.db
      .query(
        "UPDATE leftovers SET food_id = ?, quantity = ?, grams = ?, note = ?, updated_at = ? WHERE id = ?",
      )
      .run(l.foodId ?? null, l.quantity ?? null, l.grams ?? null, l.note ?? null, now, id);
    return this.get(id);
  }

  delete(id: string): void {
    this.db.query("DELETE FROM leftovers WHERE id = ?").run(id);
  }
}
