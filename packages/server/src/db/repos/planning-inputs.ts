import type { PlanningInput, PlanningInputKind } from "@yamt/shared";
import type { Db } from "../index.ts";

interface Row {
  id: string;
  request_id: string;
  kind: PlanningInputKind;
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
  round_id: string | null;
  retracted_at: number | null;
}

/** An input plus where its files are (relative to the data dir); the API never shows paths. */
export interface PlanningInputRecord extends PlanningInput {
  mediaPath: string | null;
  jpegPath: string | null;
}

const toRecord = (r: Row): PlanningInputRecord => ({
  id: r.id,
  requestId: r.request_id,
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
  roundId: r.round_id,
  retractedAt: r.retracted_at,
  mediaPath: r.media_path,
  jpegPath: r.jpeg_path,
});

export const toPlanningInput = ({ mediaPath: _m, jpegPath: _j, ...i }: PlanningInputRecord): PlanningInput =>
  i;

/** A planning input carries speech (and gets a transcript) when it is a recording. */
export const isVoiceInput = (i: Pick<PlanningInput, "kind">): boolean => i.kind === "audio";

export interface NewPlanningInput {
  id: string;
  requestId: string;
  kind: PlanningInputKind;
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
  now?: number;
}

/**
 * Planning inputs are immutable like captures: inserted, put into a round once, retracted once
 * (the migration's triggers enforce the same).
 */
export class PlanningInputRepo {
  constructor(private readonly db: Db) {}

  insert(i: NewPlanningInput): PlanningInputRecord {
    const m = i.media ?? null;
    this.db
      .query(
        `INSERT INTO planning_inputs (id, request_id, kind, created_at, captured_at, taken_at, mime_type,
           media_path, byte_size, sha256, file_name, jpeg_path, jpeg_status, text, url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        i.id,
        i.requestId,
        i.kind,
        i.now ?? Date.now(),
        i.capturedAt ?? null,
        i.takenAt ?? null,
        m?.mimeType ?? null,
        m?.path ?? null,
        m?.byteSize ?? null,
        m?.sha256 ?? null,
        m?.fileName ?? null,
        m?.jpeg?.status === "ok" ? m.jpeg.path : null,
        m?.jpeg?.status ?? null,
        i.text ?? null,
        i.url ?? null,
      );
    return this.get(i.id)!;
  }

  get(id: string): PlanningInputRecord | null {
    const r = this.db.query<Row, [string]>("SELECT * FROM planning_inputs WHERE id = ?").get(id);
    return r ? toRecord(r) : null;
  }

  /** Every input of a request in arrival order, retracted ones included. */
  listForRequest(requestId: string): PlanningInputRecord[] {
    return this.db
      .query<Row, [string]>("SELECT * FROM planning_inputs WHERE request_id = ? ORDER BY created_at, id")
      .all(requestId)
      .map(toRecord);
  }

  /** The inputs a round started with, in arrival order (retracted ones included). */
  listForRound(roundId: string): PlanningInputRecord[] {
    return this.db
      .query<Row, [string]>("SELECT * FROM planning_inputs WHERE round_id = ? ORDER BY created_at, id")
      .all(roundId)
      .map(toRecord);
  }

  /** Live and pending (not in a round yet) inputs per request. */
  counts(requestIds: readonly string[]): Map<string, { live: number; pending: number }> {
    const out = new Map<string, { live: number; pending: number }>();
    if (requestIds.length === 0) return out;
    const rows = this.db
      .query<{ request_id: string; live: number; pending: number }, string[]>(
        `SELECT request_id, count(*) AS live, sum(round_id IS NULL) AS pending FROM planning_inputs
         WHERE retracted_at IS NULL AND request_id IN (${requestIds.map(() => "?").join(", ")})
         GROUP BY request_id`,
      )
      .all(...requestIds);
    for (const r of rows) out.set(r.request_id, { live: r.live, pending: r.pending });
    return out;
  }

  /** Puts the request's live inputs that are in no round yet into this one; returns how many. */
  assignPending(requestId: string, roundId: string): number {
    return this.db
      .query(
        "UPDATE planning_inputs SET round_id = ? WHERE request_id = ? AND round_id IS NULL AND retracted_at IS NULL",
      )
      .run(roundId, requestId).changes;
  }

  /** Sets `retractedAt` once; retracting again keeps the first time. */
  retract(id: string, now = Date.now()): PlanningInputRecord | null {
    this.db
      .query("UPDATE planning_inputs SET retracted_at = ? WHERE id = ? AND retracted_at IS NULL")
      .run(now, id);
    return this.get(id);
  }
}
