import type { WeightEntry, WeightSource } from "@yamt/shared";
import { type Db, newId } from "../index.ts";

interface Row {
  id: string;
  measured_at: number;
  kg: number;
  note: string;
  source: WeightSource;
  created_at: number;
}

const toEntry = (r: Row): WeightEntry => ({
  id: r.id,
  measuredAt: r.measured_at,
  kg: r.kg,
  note: r.note,
  source: r.source,
  createdAt: r.created_at,
});

/** Weight entries: plain user data, so unlike captures they can be deleted. */
export class WeightRepo {
  constructor(private readonly db: Db) {}

  insert(w: {
    measuredAt: number;
    kg: number;
    note: string;
    source?: WeightSource;
    now?: number;
  }): WeightEntry {
    const id = newId();
    this.db
      .query(
        "INSERT INTO weight_entries (id, measured_at, kg, note, source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, w.measuredAt, w.kg, w.note, w.source ?? "manual", w.now ?? Date.now());
    return this.get(id)!;
  }

  get(id: string): WeightEntry | null {
    const r = this.db.query<Row, [string]>("SELECT * FROM weight_entries WHERE id = ?").get(id);
    return r ? toEntry(r) : null;
  }

  /** Entries measured in [from, to), newest first. */
  list(q: { from?: number; to?: number; limit: number }): WeightEntry[] {
    return this.db
      .query<Row, [number, number, number]>(
        `SELECT * FROM weight_entries WHERE measured_at >= ? AND measured_at < ?
         ORDER BY measured_at DESC, id DESC LIMIT ?`,
      )
      .all(q.from ?? 0, q.to ?? Number.MAX_SAFE_INTEGER, q.limit)
      .map(toEntry);
  }

  delete(id: string): boolean {
    return this.db.query("DELETE FROM weight_entries WHERE id = ?").run(id).changes > 0;
  }
}
