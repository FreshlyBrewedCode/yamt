import type { PlanningOrigin, PlanningRequest, ResolvedPlanningFilters } from "@yamt/shared";
import { type Db, newId } from "../index.ts";

interface Row {
  id: string;
  title: string;
  origin: PlanningOrigin;
  filters: string;
  time_zone: string;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
}

const toRequest = (r: Row): PlanningRequest => ({
  id: r.id,
  title: r.title,
  origin: r.origin,
  filters: JSON.parse(r.filters) as ResolvedPlanningFilters,
  timeZone: r.time_zone,
  archivedAt: r.archived_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Planning requests (#44): a title, the complete filters, the zone of their days; archived softly. */
export class PlanningRequestRepo {
  constructor(private readonly db: Db) {}

  insert(r: {
    id?: string;
    title: string;
    origin: PlanningOrigin;
    filters: ResolvedPlanningFilters;
    timeZone: string;
    now?: number;
  }): PlanningRequest {
    const id = r.id ?? newId();
    const now = r.now ?? Date.now();
    this.db
      .query(
        `INSERT INTO planning_requests (id, title, origin, filters, time_zone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, r.title, r.origin, JSON.stringify(r.filters), r.timeZone, now, now);
    return this.get(id)!;
  }

  get(id: string): PlanningRequest | null {
    const r = this.db.query<Row, [string]>("SELECT * FROM planning_requests WHERE id = ?").get(id);
    return r ? toRequest(r) : null;
  }

  /** The open (not archived) requests, newest first. */
  listOpen(limit: number): PlanningRequest[] {
    return this.db
      .query<Row, [number]>(
        "SELECT * FROM planning_requests WHERE archived_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ?",
      )
      .all(limit)
      .map(toRequest);
  }

  setTitle(id: string, title: string, now = Date.now()): PlanningRequest | null {
    this.db.query("UPDATE planning_requests SET title = ?, updated_at = ? WHERE id = ?").run(title, now, id);
    return this.get(id);
  }

  /** Something in the thread changed (an input, a round): the request was touched. */
  touch(id: string, now = Date.now()): void {
    this.db.query("UPDATE planning_requests SET updated_at = ? WHERE id = ?").run(now, id);
  }

  /** Archives (a time) or unarchives (null). */
  setArchived(id: string, at: number | null, now = Date.now()): PlanningRequest | null {
    this.db
      .query("UPDATE planning_requests SET archived_at = ?, updated_at = ? WHERE id = ?")
      .run(at, now, id);
    return this.get(id);
  }
}
