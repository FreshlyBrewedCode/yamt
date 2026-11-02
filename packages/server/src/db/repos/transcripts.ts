import type { Transcript, TranscriptSegment, TranscriptStatus } from "@yamt/shared";
import type { Db } from "../index.ts";

interface Row {
  capture_id: string;
  status: TranscriptStatus;
  text: string | null;
  model: string | null;
  language: string | null;
  duration_ms: number | null;
  segments: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

const toTranscript = (r: Row): Transcript => ({
  captureId: r.capture_id,
  status: r.status,
  text: r.text,
  model: r.model,
  language: r.language,
  durationMs: r.duration_ms,
  segments: r.segments === null ? null : (JSON.parse(r.segments) as TranscriptSegment[]),
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** One transcript per audio capture. Derived data: it can be reset and filled again. */
export class TranscriptRepo {
  constructor(private readonly db: Db) {}

  /** A `pending` transcript, or the existing one reset to `pending` (re-transcription). */
  upsertPending(captureId: string, now = Date.now()): Transcript {
    this.db
      .query(
        `INSERT INTO transcripts (capture_id, status, created_at, updated_at) VALUES (?, 'pending', ?, ?)
         ON CONFLICT (capture_id) DO UPDATE SET status = 'pending', text = NULL, model = NULL,
           language = NULL, duration_ms = NULL, segments = NULL, error = NULL, updated_at = excluded.updated_at`,
      )
      .run(captureId, now, now);
    return this.get(captureId)!;
  }

  get(captureId: string): Transcript | null {
    const r = this.db.query<Row, [string]>("SELECT * FROM transcripts WHERE capture_id = ?").get(captureId);
    return r ? toTranscript(r) : null;
  }

  listForMeal(mealId: string): Transcript[] {
    return this.db
      .query<Row, [string]>(
        `SELECT t.* FROM transcripts t JOIN captures c ON c.id = t.capture_id
         WHERE c.meal_id = ? ORDER BY c.created_at, c.id`,
      )
      .all(mealId)
      .map(toTranscript);
  }

  complete(
    captureId: string,
    t: {
      text: string;
      model: string;
      language: string | null;
      durationMs: number | null;
      segments: TranscriptSegment[] | null;
    },
    now = Date.now(),
  ): Transcript | null {
    this.db
      .query(
        `UPDATE transcripts SET status = 'done', text = ?, model = ?, language = ?, duration_ms = ?,
           segments = ?, error = NULL, updated_at = ? WHERE capture_id = ?`,
      )
      .run(
        t.text,
        t.model,
        t.language,
        t.durationMs,
        t.segments === null ? null : JSON.stringify(t.segments),
        now,
        captureId,
      );
    return this.get(captureId);
  }

  fail(captureId: string, error: string, now = Date.now()): Transcript | null {
    this.db
      .query("UPDATE transcripts SET status = 'failed', error = ?, updated_at = ? WHERE capture_id = ?")
      .run(error, now, captureId);
    return this.get(captureId);
  }
}
