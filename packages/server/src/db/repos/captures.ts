import type { Capture, CaptureKind } from "@yamt/shared";
import type { Db } from "../index.ts";

interface Row {
  id: string;
  meal_id: string;
  kind: CaptureKind;
  created_at: number;
  captured_at: number | null;
  taken_at: number | null;
  mime_type: string | null;
  media_path: string | null;
  byte_size: number | null;
  sha256: string | null;
  file_name: string | null;
  jpeg_path: string | null;
  jpeg_status: "ok" | "missing" | null;
  text: string | null;
  url: string | null;
  question_id: string | null;
  retracted_at: number | null;
}

/** A capture plus where its files are (relative to the data dir); the API never shows paths. */
export interface CaptureRecord extends Capture {
  mediaPath: string | null;
  jpegPath: string | null;
}

const toRecord = (r: Row): CaptureRecord => ({
  id: r.id,
  mealId: r.meal_id,
  kind: r.kind,
  createdAt: r.created_at,
  capturedAt: r.captured_at,
  takenAt: r.taken_at,
  mimeType: r.mime_type,
  byteSize: r.byte_size,
  sha256: r.sha256,
  fileName: r.file_name,
  jpegDerivative: r.jpeg_status,
  text: r.text,
  url: r.url,
  questionId: r.question_id,
  retractedAt: r.retracted_at,
  mediaPath: r.media_path,
  jpegPath: r.jpeg_path,
});

export const toCapture = ({ mediaPath: _m, jpegPath: _j, ...c }: CaptureRecord): Capture => c;

export interface NewCapture {
  /** Media captures pass the id their files are named after. */
  id: string;
  mealId: string;
  kind: CaptureKind;
  capturedAt?: number | null;
  takenAt?: number | null;
  media?: {
    mimeType: string;
    path: string;
    byteSize: number;
    sha256: string;
    fileName: string | null;
    jpeg?: { status: "ok"; path: string } | { status: "missing" } | null;
  } | null;
  text?: string | null;
  url?: string | null;
  questionId?: string | null;
  now?: number;
}

/**
 * Captures are immutable: this repo can insert and retract, nothing else (the migration's
 * triggers enforce the same in the database).
 */
export class CaptureRepo {
  constructor(private readonly db: Db) {}

  insert(c: NewCapture): CaptureRecord {
    const m = c.media ?? null;
    this.db
      .query(
        `INSERT INTO captures (id, meal_id, kind, created_at, captured_at, taken_at, mime_type, media_path,
           byte_size, sha256, file_name, jpeg_path, jpeg_status, text, url, question_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.id,
        c.mealId,
        c.kind,
        c.now ?? Date.now(),
        c.capturedAt ?? null,
        c.takenAt ?? null,
        m?.mimeType ?? null,
        m?.path ?? null,
        m?.byteSize ?? null,
        m?.sha256 ?? null,
        m?.fileName ?? null,
        m?.jpeg?.status === "ok" ? m.jpeg.path : null,
        m?.jpeg?.status ?? null,
        c.text ?? null,
        c.url ?? null,
        c.questionId ?? null,
      );
    return this.get(c.id)!;
  }

  get(id: string): CaptureRecord | null {
    const r = this.db.query<Row, [string]>("SELECT * FROM captures WHERE id = ?").get(id);
    return r ? toRecord(r) : null;
  }

  /** Every capture of a meal in arrival order, retracted ones included. */
  listForMeal(mealId: string): CaptureRecord[] {
    return this.db
      .query<Row, [string]>("SELECT * FROM captures WHERE meal_id = ? ORDER BY created_at, id")
      .all(mealId)
      .map(toRecord);
  }

  countLive(mealId: string): number {
    return (
      this.db
        .query<{ n: number }, [string]>(
          "SELECT count(*) AS n FROM captures WHERE meal_id = ? AND retracted_at IS NULL",
        )
        .get(mealId)?.n ?? 0
    );
  }

  /** Sets `retractedAt` once; retracting again keeps the first time. */
  retract(id: string, now = Date.now()): CaptureRecord | null {
    this.db.query("UPDATE captures SET retracted_at = ? WHERE id = ? AND retracted_at IS NULL").run(now, id);
    return this.get(id);
  }
}
