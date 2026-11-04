import type { Goal, GoalDerivation, Targets } from "@yamt/shared";
import { type Db, newId } from "../index.ts";

interface Row {
  id: string;
  effective_from: string;
  energy_kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbohydrate_g: number | null;
  fiber_g: number | null;
  note: string;
  derivation: string | null;
  created_at: number;
  updated_at: number;
}

const toGoal = (r: Row): Goal => ({
  id: r.id,
  effectiveFrom: r.effective_from,
  targets: {
    energyKcal: r.energy_kcal,
    protein: r.protein_g,
    fat: r.fat_g,
    carbohydrate: r.carbohydrate_g,
    fiber: r.fiber_g,
  },
  note: r.note,
  derivation: r.derivation ? (JSON.parse(r.derivation) as GoalDerivation) : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const targetValues = (t: Targets) => [t.energyKcal, t.protein, t.fat, t.carbohydrate, t.fiber] as const;

/** Newest first: the order that decides which goal is in force (`goalInForce` in @yamt/shared). */
const NEWEST_FIRST = "ORDER BY effective_from DESC, id DESC";

/** Daily goals: rows are added for new targets; only the latest may be fixed in place. */
export class GoalRepo {
  constructor(private readonly db: Db) {}

  insert(g: {
    effectiveFrom: string;
    targets: Targets;
    note: string;
    /** How a guided goal was calculated (#24); none for targets set by hand. */
    derivation?: GoalDerivation | null;
    now?: number;
  }): Goal {
    const id = newId();
    const now = g.now ?? Date.now();
    this.db
      .query(
        `INSERT INTO goals (id, effective_from, energy_kcal, protein_g, fat_g, carbohydrate_g, fiber_g, note,
           derivation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        g.effectiveFrom,
        ...targetValues(g.targets),
        g.note,
        g.derivation ? JSON.stringify(g.derivation) : null,
        now,
        now,
      );
    return this.get(id)!;
  }

  get(id: string): Goal | null {
    const r = this.db.query<Row, [string]>("SELECT * FROM goals WHERE id = ?").get(id);
    return r ? toGoal(r) : null;
  }

  /** Every goal, newest first. */
  list(): Goal[] {
    return this.db.query<Row, []>(`SELECT * FROM goals ${NEWEST_FIRST}`).all().map(toGoal);
  }

  /** The goal in force on a local date: the latest with `effective_from` ≤ date. */
  inForce(date: string): Goal | null {
    const r = this.db
      .query<Row, [string]>(`SELECT * FROM goals WHERE effective_from <= ? ${NEWEST_FIRST} LIMIT 1`)
      .get(date);
    return r ? toGoal(r) : null;
  }

  /** The newest goal (the current one, unless a later start date was set). */
  latest(): Goal | null {
    const r = this.db.query<Row, []>(`SELECT * FROM goals ${NEWEST_FIRST} LIMIT 1`).get();
    return r ? toGoal(r) : null;
  }

  /**
   * Replaces a goal's targets and note in place (a typo fix); its start date stays. Changed
   * targets drop a guided goal's derivation: the numbers are no longer what it explains.
   */
  fix(id: string, g: { targets: Targets; note: string; now?: number }): Goal | null {
    const before = this.get(id);
    const same =
      before !== null && targetValues(before.targets).every((v, i) => v === targetValues(g.targets)[i]);
    this.db
      .query(
        `UPDATE goals SET energy_kcal = ?, protein_g = ?, fat_g = ?, carbohydrate_g = ?, fiber_g = ?, note = ?,
           derivation = CASE WHEN ? THEN derivation ELSE NULL END, updated_at = ? WHERE id = ?`,
      )
      .run(...targetValues(g.targets), g.note, same ? 1 : 0, g.now ?? Date.now(), id);
    return this.get(id);
  }
}
