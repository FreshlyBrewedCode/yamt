import type { PlanningStarter, StarterFilters, StarterKind, StarterRef } from "@yamt/shared";
import { type Db, newId } from "../index.ts";

interface Row {
  id: string;
  round_id: string;
  position: number;
  kind: StarterKind;
  text: string;
  detail: string;
  filters: string;
  ref: string;
  created_at: number;
}

const toStarter = (r: Row): PlanningStarter => ({
  id: r.id,
  roundId: r.round_id,
  position: r.position,
  kind: r.kind,
  text: r.text,
  detail: r.detail,
  filters: JSON.parse(r.filters) as StarterFilters,
  ref: JSON.parse(r.ref) as StarterRef,
  createdAt: r.created_at,
});

export interface NewStarter {
  kind: StarterKind;
  text: string;
  detail: string;
  filters: StarterFilters;
  ref: StarterRef;
}

/** The starters a nightly run wrote (#48), a set per round; derived, so a new save replaces the set. */
export class PlanningStarterRepo {
  constructor(private readonly db: Db) {}

  /** The round's starters, replacing any it saved before, in the given order. */
  replace(roundId: string, starters: readonly NewStarter[], now = Date.now()): PlanningStarter[] {
    this.db.transaction(() => {
      this.db.query("DELETE FROM planning_starters WHERE round_id = ?").run(roundId);
      const insert = this.db.query(
        `INSERT INTO planning_starters (id, round_id, position, kind, text, detail, filters, ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const [i, s] of starters.entries()) {
        insert.run(
          newId(),
          roundId,
          i,
          s.kind,
          s.text,
          s.detail,
          JSON.stringify(s.filters),
          JSON.stringify(s.ref),
          now,
        );
      }
    })();
    return this.listForRound(roundId);
  }

  listForRound(roundId: string): PlanningStarter[] {
    return this.db
      .query<Row, [string]>("SELECT * FROM planning_starters WHERE round_id = ? ORDER BY position")
      .all(roundId)
      .map(toStarter);
  }

  /** The newest set saved at or after `since` (by any round), in its order; [] without one. */
  latest(since: number): PlanningStarter[] {
    const r = this.db
      .query<{ round_id: string }, [number]>(
        `SELECT round_id FROM planning_starters WHERE created_at >= ?
         ORDER BY created_at DESC, round_id DESC LIMIT 1`,
      )
      .get(since);
    return r ? this.listForRound(r.round_id) : [];
  }
}
