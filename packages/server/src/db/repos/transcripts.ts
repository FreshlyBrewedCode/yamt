import type { PlanningTranscript, Transcript, TranscriptSegment, TranscriptStatus } from "@yamt/shared";
import type { Db } from "../index.ts";

interface Row {
  capture_id?: string;
  input_id?: string;
  status: TranscriptStatus;
  text: string | null;
  model: string | null;
  language: string | null;
  duration_ms: number | null;
  segments: string | null;
  elapsed_ms: number | null;
  settings: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

/** A transcript without its key: what voice captures' and voice planning inputs' have in common. */
type TranscriptFields = Omit<Transcript, "captureId">;

const toFields = (r: Row): TranscriptFields => ({
  status: r.status,
  text: r.text,
  model: r.model,
  language: r.language,
  durationMs: r.duration_ms,
  segments: r.segments === null ? null : (JSON.parse(r.segments) as TranscriptSegment[]),
  elapsedMs: r.elapsed_ms,
  settings: r.settings === null ? null : (JSON.parse(r.settings) as Transcript["settings"]),
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface TranscriptResult {
  text: string;
  model: string;
  language: string | null;
  durationMs: number | null;
  segments: TranscriptSegment[] | null;
  elapsedMs?: number | null;
  settings?: Transcript["settings"];
}

/**
 * One transcript per voice source, keyed by it: `transcripts` (voice captures) and
 * `planning_transcripts` (voice planning inputs, #44) share these columns and this SQL. Derived
 * data: it can be reset and filled again.
 */
abstract class TranscriptTable<T> {
  constructor(
    protected readonly db: Db,
    private readonly table: "transcripts" | "planning_transcripts",
    protected readonly key: "capture_id" | "input_id",
  ) {}

  protected abstract toTranscript(id: string, fields: TranscriptFields): T;

  protected map = (r: Row): T => this.toTranscript(r[this.key]!, toFields(r));

  /** A `pending` transcript, or the existing one reset to `pending` (re-transcription). */
  upsertPending(id: string, now = Date.now()): T {
    this.db
      .query(
        `INSERT INTO ${this.table} (${this.key}, status, created_at, updated_at) VALUES (?, 'pending', ?, ?)
         ON CONFLICT (${this.key}) DO UPDATE SET status = 'pending', text = NULL, model = NULL,
           language = NULL, duration_ms = NULL, segments = NULL, elapsed_ms = NULL, settings = NULL, error = NULL,
           updated_at = excluded.updated_at`,
      )
      .run(id, now, now);
    return this.get(id)!;
  }

  get(id: string): T | null {
    const r = this.db.query<Row, [string]>(`SELECT * FROM ${this.table} WHERE ${this.key} = ?`).get(id);
    return r ? this.map(r) : null;
  }

  complete(id: string, t: TranscriptResult, now = Date.now()): T | null {
    this.db
      .query(
        `UPDATE ${this.table} SET status = 'done', text = ?, model = ?, language = ?, duration_ms = ?,
           segments = ?, elapsed_ms = ?, settings = ?, error = NULL, updated_at = ? WHERE ${this.key} = ?`,
      )
      .run(
        t.text,
        t.model,
        t.language,
        t.durationMs,
        t.segments === null ? null : JSON.stringify(t.segments),
        t.elapsedMs ?? null,
        t.settings ? JSON.stringify(t.settings) : null,
        now,
        id,
      );
    return this.get(id);
  }

  fail(id: string, error: string, now = Date.now()): T | null {
    this.db
      .query(`UPDATE ${this.table} SET status = 'failed', error = ?, updated_at = ? WHERE ${this.key} = ?`)
      .run(error, now, id);
    return this.get(id);
  }
}

/** One transcript per voice capture (audio, a spoken answer or correction). */
export class TranscriptRepo extends TranscriptTable<Transcript> {
  constructor(db: Db) {
    super(db, "transcripts", "capture_id");
  }

  protected toTranscript(captureId: string, f: TranscriptFields): Transcript {
    return { captureId, ...f };
  }

  listForMeal(mealId: string): Transcript[] {
    return this.db
      .query<Row, [string]>(
        `SELECT t.* FROM transcripts t JOIN captures c ON c.id = t.capture_id
         WHERE c.meal_id = ? ORDER BY c.created_at, c.id`,
      )
      .all(mealId)
      .map(this.map);
  }
}

/** One transcript per voice planning input (#44). */
export class PlanningTranscriptRepo extends TranscriptTable<PlanningTranscript> {
  constructor(db: Db) {
    super(db, "planning_transcripts", "input_id");
  }

  protected toTranscript(inputId: string, f: TranscriptFields): PlanningTranscript {
    return { inputId, ...f };
  }

  listForRequest(requestId: string): PlanningTranscript[] {
    return this.db
      .query<Row, [string]>(
        `SELECT t.* FROM planning_transcripts t JOIN planning_inputs i ON i.id = t.input_id
         WHERE i.request_id = ? ORDER BY i.created_at, i.id`,
      )
      .all(requestId)
      .map(this.map);
  }
}
