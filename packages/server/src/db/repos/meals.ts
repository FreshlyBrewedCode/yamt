import type { CaptureKind, EatenAtSource, Meal, MealStatus, MealSummary } from "@yamt/shared";
import { type Db, newId } from "../index.ts";

interface Row {
  id: string;
  status: MealStatus;
  eaten_at: number;
  eaten_at_source: EatenAtSource;
  current_revision_id: string | null;
  analysis_error: string | null;
  source_meal_id: string | null;
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
  sourceMealId: r.source_meal_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** What the meals table knows about a meal in the overview; the service adds the revision's part. */
export type MealCaptureSummary = Omit<MealSummary, "title" | "totals" | "openQuestions">;

/** The time a capture stands for: EXIF beats what the client reported beats arrival. */
export const CAPTURE_TIME_SQL = "COALESCE(taken_at, captured_at, created_at)";

export class MealRepo {
  constructor(private readonly db: Db) {}

  /** A new draft; `eatenAt` pins the time (`user`). `sourceMealId`: logged again from that meal (#30). */
  insert(m: { id?: string; eatenAt?: number; sourceMealId?: string; now?: number } = {}): Meal {
    const id = m.id ?? newId();
    const now = m.now ?? Date.now();
    this.db
      .query(
        `INSERT INTO meals (id, status, eaten_at, eaten_at_source, source_meal_id, created_at, updated_at)
         VALUES (?, 'draft', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        m.eatenAt ?? now,
        m.eatenAt === undefined ? "created" : "user",
        m.sourceMealId ?? null,
        now,
        now,
      );
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

  /**
   * The most recently updated meal still in `draft` whose last change (or creation) is at or
   * after `since`, or null. What the share route adds to (#26).
   */
  latestDraftSince(since: number): Meal | null {
    const r = this.db
      .query<Row, [number]>(
        "SELECT * FROM meals WHERE status = 'draft' AND updated_at >= ? ORDER BY updated_at DESC, id DESC LIMIT 1",
      )
      .get(since);
    return r ? toMeal(r) : null;
  }

  /**
   * Meals eaten in [from, to) whose current revision is an analysed one (not preliminary), newest
   * first, with that revision's id and title: what can be logged again (#30).
   */
  analysedBetween(from: number, to: number): { meal: Meal; revisionId: string; title: string }[] {
    return this.db
      .query<Row & { revision_title: string }, [number, number]>(
        `SELECT m.*, r.title AS revision_title FROM meals m
         JOIN meal_revisions r ON r.id = m.current_revision_id
         WHERE m.eaten_at >= ? AND m.eaten_at < ? AND r.status = 'analysed'
         ORDER BY m.eaten_at DESC, m.id DESC`,
      )
      .all(from, to)
      .map((r) => ({ meal: toMeal(r), revisionId: r.current_revision_id!, title: r.revision_title }));
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

  /**
   * The calendar's pass over meals eaten in [from, to) (#33): one row per meal with its time,
   * current revision and live captures, in one query.
   */
  tallyBetween(
    from: number,
    to: number,
  ): { id: string; eatenAt: number; currentRevisionId: string | null; captures: number }[] {
    return this.db
      .query<
        { id: string; eaten_at: number; current_revision_id: string | null; captures: number },
        [number, number]
      >(
        `SELECT m.id, m.eaten_at, m.current_revision_id,
           (SELECT count(*) FROM captures c WHERE c.meal_id = m.id AND c.retracted_at IS NULL) AS captures
         FROM meals m WHERE m.eaten_at >= ? AND m.eaten_at < ? ORDER BY m.eaten_at, m.id`,
      )
      .all(from, to)
      .map((r) => ({
        id: r.id,
        eatenAt: r.eaten_at,
        currentRevisionId: r.current_revision_id,
        captures: r.captures,
      }));
  }

  /** Pins `eatenAt` (user or agent); captures no longer move it. */
  setEatenAt(id: string, eatenAt: number, source: "user" | "agent", now = Date.now()): Meal | null {
    this.db
      .query("UPDATE meals SET eaten_at = ?, eaten_at_source = ?, updated_at = ? WHERE id = ?")
      .run(eatenAt, source, now, id);
    return this.get(id);
  }

  /** Unpins `eatenAt`: it follows the captures again (or the creation time without any). */
  unpinEatenAt(id: string, now = Date.now()): Meal | null {
    return this.db.transaction(() => {
      this.db.query("UPDATE meals SET eaten_at_source = 'created' WHERE id = ?").run(id);
      return this.capturesChanged(id, now);
    })();
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
