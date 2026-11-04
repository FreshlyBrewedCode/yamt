import type { CaptureKind, EatenAtSource, Meal, MealStatus, MealSummary } from "@yamt/shared";
import { type Db, newId } from "../index.ts";

interface Row {
  id: string;
  status: MealStatus;
  eaten_at: number;
  eaten_at_source: EatenAtSource;
  current_revision_id: string | null;
  analysis_error: string | null;
  created_at: number;
  updated_at: number;
}

const toMeal = (r: Row): Meal => ({
  id: r.id,
  status: r.status,
  eatenAt: r.eaten_at,
  eatenAtSource: r.eaten_at_source,
  currentRevisionId: r.current_revision_id,
  analysisError: r.analysis_error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** What the meals table knows about a meal in the overview; the service adds the revision's part. */
export type MealCaptureSummary = Omit<MealSummary, "title" | "totals" | "openQuestions">;

/** The time a capture stands for: EXIF beats what the client reported beats arrival. */
export const CAPTURE_TIME_SQL = "COALESCE(taken_at, captured_at, created_at)";

export class MealRepo {
  constructor(private readonly db: Db) {}

  insert(m: { id?: string; eatenAt?: number; now?: number } = {}): Meal {
    const id = m.id ?? newId();
    const now = m.now ?? Date.now();
    this.db
      .query(
        `INSERT INTO meals (id, status, eaten_at, eaten_at_source, created_at, updated_at)
         VALUES (?, 'draft', ?, ?, ?, ?)`,
      )
      .run(id, m.eatenAt ?? now, m.eatenAt === undefined ? "created" : "user", now, now);
    return this.get(id)!;
  }

  get(id: string): Meal | null {
    const r = this.db.query<Row, [string]>("SELECT * FROM meals WHERE id = ?").get(id);
    return r ? toMeal(r) : null;
  }

  /** Meals eaten in [from, to), newest first, with what they hold (live captures only). */
  list(q: { from?: number; to?: number; limit: number }): MealCaptureSummary[] {
    const rows = this.db
      .query<Row, [number, number, number]>(
        "SELECT * FROM meals WHERE eaten_at >= ? AND eaten_at < ? ORDER BY eaten_at DESC, id DESC LIMIT ?",
      )
      .all(q.from ?? 0, q.to ?? Number.MAX_SAFE_INTEGER, q.limit);
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const marks = ids.map(() => "?").join(", ");
    const counts = this.db
      .query<{ meal_id: string; kind: CaptureKind; n: number }, string[]>(
        `SELECT meal_id, kind, count(*) AS n FROM captures
         WHERE meal_id IN (${marks}) AND retracted_at IS NULL GROUP BY meal_id, kind`,
      )
      .all(...ids);
    const covers = this.db
      .query<{ meal_id: string; id: string }, string[]>(
        `SELECT meal_id, min(id) AS id FROM captures
         WHERE meal_id IN (${marks}) AND kind = 'image' AND retracted_at IS NULL GROUP BY meal_id`,
      )
      .all(...ids);
    const coverOf = new Map(covers.map((c) => [c.meal_id, c.id]));
    const pending = this.db
      .query<{ meal_id: string; n: number }, string[]>(
        `SELECT c.meal_id, count(*) AS n FROM transcripts t JOIN captures c ON c.id = t.capture_id
         WHERE c.meal_id IN (${marks}) AND c.retracted_at IS NULL AND t.status = 'pending'
         GROUP BY c.meal_id`,
      )
      .all(...ids);
    const pendingOf = new Map(pending.map((p) => [p.meal_id, p.n]));

    return rows.map((r) => {
      const captureKinds: MealSummary["captureKinds"] = {};
      let captureCount = 0;
      for (const c of counts) {
        if (c.meal_id !== r.id) continue;
        captureKinds[c.kind] = c.n;
        captureCount += c.n;
      }
      return {
        ...toMeal(r),
        captureCount,
        captureKinds,
        coverCaptureId: coverOf.get(r.id) ?? null,
        pendingTranscripts: pendingOf.get(r.id) ?? 0,
      };
    });
  }

  /** Sets the status; `error` is kept only with `failed` (why the analysis failed), else cleared. */
  setStatus(id: string, status: MealStatus, now = Date.now(), error: string | null = null): Meal | null {
    this.db
      .query("UPDATE meals SET status = ?, analysis_error = ?, updated_at = ? WHERE id = ?")
      .run(status, status === "failed" ? error : null, now, id);
    return this.get(id);
  }

  /** A new analysis revision is the meal's current one; the status follows it (see RevisionService). */
  setCurrentRevision(id: string, revisionId: string, status: MealStatus, now = Date.now()): Meal | null {
    this.db
      .query(
        "UPDATE meals SET current_revision_id = ?, status = ?, analysis_error = NULL, updated_at = ? WHERE id = ?",
      )
      .run(revisionId, status, now, id);
    return this.get(id);
  }

  /** Meals eaten in [from, to), oldest first, every one (for a day's summary). */
  eatenBetween(from: number, to: number): Meal[] {
    return this.db
      .query<Row, [number, number]>(
        "SELECT * FROM meals WHERE eaten_at >= ? AND eaten_at < ? ORDER BY eaten_at, id",
      )
      .all(from, to)
      .map(toMeal);
  }

  /** Pins `eatenAt` (user or agent); captures no longer move it. */
  setEatenAt(id: string, eatenAt: number, source: "user" | "agent", now = Date.now()): Meal | null {
    this.db
      .query("UPDATE meals SET eaten_at = ?, eaten_at_source = ?, updated_at = ? WHERE id = ?")
      .run(eatenAt, source, now, id);
    return this.get(id);
  }

  /**
   * After its captures changed: bumps `updatedAt` and, unless the time was pinned (`user`,
   * `agent`), sets `eatenAt` to the earliest live capture (or back to the creation time).
   */
  capturesChanged(id: string, now = Date.now()): Meal | null {
    this.db
      .query(
        `UPDATE meals SET
           updated_at = ?,
           eaten_at = CASE WHEN eaten_at_source IN ('created', 'capture')
             THEN COALESCE((SELECT min(${CAPTURE_TIME_SQL}) FROM captures
                            WHERE meal_id = meals.id AND retracted_at IS NULL), created_at)
             ELSE eaten_at END,
           eaten_at_source = CASE WHEN eaten_at_source IN ('created', 'capture')
             THEN CASE WHEN EXISTS (SELECT 1 FROM captures WHERE meal_id = meals.id AND retracted_at IS NULL)
               THEN 'capture' ELSE 'created' END
             ELSE eaten_at_source END
         WHERE id = ?`,
      )
      .run(now, id);
    return this.get(id);
  }
}
