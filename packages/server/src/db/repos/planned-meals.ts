import {
  type MealSlot,
  MealSlot as MealSlotEnum,
  type PlannedMeal,
  type PlannedMealStatus,
} from "@yamt/shared";
import { type Db, newId } from "../index.ts";

interface Row {
  id: string;
  date: string;
  slot: MealSlot;
  position: number;
  recipe_id: string;
  title: string;
  portions_cooked: number;
  portion_eaten: number;
  status: PlannedMealStatus;
  logged_meal_id: string | null;
  leftover_of: string | null;
  suggestion_id: string | null;
  note: string | null;
  created_at: number;
  updated_at: number;
}

const toPlannedMeal = (r: Row): PlannedMeal => ({
  id: r.id,
  date: r.date,
  slot: r.slot,
  position: r.position,
  recipeId: r.recipe_id,
  title: r.title,
  portionsCooked: r.portions_cooked,
  portionEaten: r.portion_eaten,
  status: r.status,
  loggedMealId: r.logged_meal_id,
  leftoverOf: r.leftover_of,
  suggestionId: r.suggestion_id,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Breakfast, lunch, dinner, snack; then the position within the slot. */
const SLOT_ORDER = `CASE slot ${MealSlotEnum.options.map((s, i) => `WHEN '${s}' THEN ${i}`).join(" ")} END`;

/**
 * Planned meals: a recipe on a date's slot with portions, `planned` → `logged` | `skipped`.
 * Positions are 0, 1, … within a date's slot; every move renumbers the slots it touches.
 */
export class PlannedMealRepo {
  constructor(private readonly db: Db) {}

  /** At the end of its slot. */
  insert(p: {
    id?: string;
    date: string;
    slot: MealSlot;
    recipeId: string;
    title: string;
    portionsCooked: number;
    portionEaten: number;
    note: string | null;
    now?: number;
  }): PlannedMeal {
    const id = p.id ?? newId();
    const now = p.now ?? Date.now();
    this.db
      .query(
        `INSERT INTO planned_meals (id, date, slot, position, recipe_id, title, portions_cooked, portion_eaten,
           note, created_at, updated_at)
         VALUES (?, ?, ?, (SELECT count(*) FROM planned_meals WHERE date = ? AND slot = ?), ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        p.date,
        p.slot,
        p.date,
        p.slot,
        p.recipeId,
        p.title,
        p.portionsCooked,
        p.portionEaten,
        p.note,
        now,
        now,
      );
    return this.get(id)!;
  }

  get(id: string): PlannedMeal | null {
    const r = this.db.query<Row, [string]>("SELECT * FROM planned_meals WHERE id = ?").get(id);
    return r ? toPlannedMeal(r) : null;
  }

  /** Planned meals on the dates [from, to] (inclusive), by date, slot and position. */
  between(from: string, to: string): PlannedMeal[] {
    return this.db
      .query<Row, [string, string]>(
        `SELECT * FROM planned_meals WHERE date >= ? AND date <= ? ORDER BY date, ${SLOT_ORDER}, position, id`,
      )
      .all(from, to)
      .map(toPlannedMeal);
  }

  /** Portions and the note. */
  update(
    id: string,
    p: { portionsCooked: number; portionEaten: number; note: string | null },
    now = Date.now(),
  ): PlannedMeal | null {
    this.db
      .query(
        "UPDATE planned_meals SET portions_cooked = ?, portion_eaten = ?, note = ?, updated_at = ? WHERE id = ?",
      )
      .run(p.portionsCooked, p.portionEaten, p.note, now, id);
    return this.get(id);
  }

  /**
   * Puts it at `position` (clamped; default the end) of the date's slot, renumbering that slot and
   * the one it left. Call inside the caller's transaction or alone.
   */
  move(
    id: string,
    to: { date: string; slot: MealSlot; position?: number },
    now = Date.now(),
  ): PlannedMeal | null {
    return this.db.transaction(() => {
      const before = this.get(id);
      if (!before) return null;
      const others = this.slot(to.date, to.slot).filter((p) => p.id !== id);
      const at = Math.min(to.position ?? others.length, others.length);
      const order = [...others.slice(0, at).map((p) => p.id), id, ...others.slice(at).map((p) => p.id)];
      this.db
        .query("UPDATE planned_meals SET date = ?, slot = ?, updated_at = ? WHERE id = ?")
        .run(to.date, to.slot, now, id);
      this.renumber(order);
      if (before.date !== to.date || before.slot !== to.slot) {
        this.renumber(this.slot(before.date, before.slot).map((p) => p.id));
      }
      return this.get(id);
    })();
  }

  /** `skipped` or back to `planned` (the caller checks the status it comes from). */
  setStatus(id: string, status: "planned" | "skipped", now = Date.now()): PlannedMeal | null {
    this.db.query("UPDATE planned_meals SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
    return this.get(id);
  }

  /** "Ate it": `logged` with its meal and the portion eaten. */
  markLogged(id: string, mealId: string, portionEaten: number, now = Date.now()): PlannedMeal | null {
    this.db
      .query(
        "UPDATE planned_meals SET status = 'logged', logged_meal_id = ?, portion_eaten = ?, updated_at = ? WHERE id = ?",
      )
      .run(mealId, portionEaten, now, id);
    return this.get(id);
  }

  /** The meal logged from it was removed: the planned meal is `planned` again (and can be eaten again). */
  unlogMeal(mealId: string, now = Date.now()): PlannedMeal | null {
    const r = this.db
      .query<Row, [string]>("SELECT * FROM planned_meals WHERE logged_meal_id = ?")
      .get(mealId);
    if (!r) return null;
    this.db
      .query(
        "UPDATE planned_meals SET status = 'planned', logged_meal_id = NULL, updated_at = ? WHERE id = ?",
      )
      .run(now, r.id);
    return this.get(r.id);
  }

  /** Unplans it: only a `planned` one (a trigger refuses the others). Its slot is renumbered. */
  delete(id: string): boolean {
    return this.db.transaction(() => {
      const before = this.get(id);
      if (!before) return false;
      this.db.query("DELETE FROM planned_meals WHERE id = ?").run(id);
      this.renumber(this.slot(before.date, before.slot).map((p) => p.id));
      return true;
    })();
  }

  private slot(date: string, slot: MealSlot): PlannedMeal[] {
    return this.db
      .query<Row, [string, string]>(
        "SELECT * FROM planned_meals WHERE date = ? AND slot = ? ORDER BY position, id",
      )
      .all(date, slot)
      .map(toPlannedMeal);
  }

  private renumber(ids: readonly string[]): void {
    const set = this.db.query("UPDATE planned_meals SET position = ? WHERE id = ? AND position != ?");
    ids.forEach((id, i) => {
      set.run(i, id, i);
    });
  }
}
