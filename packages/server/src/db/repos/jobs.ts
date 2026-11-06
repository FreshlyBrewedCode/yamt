import { type Db, newId } from "../index.ts";

/**
 * The job queue: a table the single in-process worker loop (#8, #9) polls. Server-internal, so
 * its types live here rather than in @yamt/shared.
 *
 * Lifecycle: `queued` → (claim) `running` → `done` | back to `queued` (retry, reschedule) |
 * `failed` (attempts used up, or not retryable) | `cancelled` (no longer needed, or superseded by
 * a newer queued job with the same dedupe key).
 */
export interface JobPayloads {
  /** A voice capture's transcript, or a voice planning input's (#44). */
  transcribe: { captureId: string } | { inputId: string };
  analyse: { mealId: string };
  /** Fills a planning round with suggestions (#45 registers the handler; until then it waits). */
  plan: { roundId: string };
}
export type JobType = keyof JobPayloads;
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

interface JobBase {
  id: string;
  /** At most one `queued` job per key, and a job is not claimed while another with its key runs. */
  dedupeKey: string | null;
  status: JobStatus;
  /** Claims so far, including the current one while running. */
  attempts: number;
  maxAttempts: number;
  /** Not claimed before this time. */
  runAfter: number;
  lastError: string | null;
  claimedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type Job = { [T in JobType]: JobBase & { type: T; payload: JobPayloads[T] } }[JobType];

/**
 * One open analysis per meal, one transcription per voice capture or voice planning input, one
 * open `plan` job per planning request (its rounds run one after the other).
 */
export const dedupeKeys = {
  analyse: (mealId: string) => `analyse:${mealId}`,
  transcribe: (captureId: string) => `transcribe:${captureId}`,
  transcribeInput: (inputId: string) => `transcribe:input:${inputId}`,
  plan: (requestId: string) => `plan:${requestId}`,
};

/** Wait before retry n (1-based): 30 s, 2 min, 8 min, … capped at an hour. */
export const retryDelayMs = (attempt: number): number =>
  Math.min(30_000 * 4 ** Math.max(0, attempt - 1), 3_600_000);

interface Row {
  id: string;
  type: JobType;
  payload: string;
  dedupe_key: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: number;
  last_error: string | null;
  claimed_at: number | null;
  finished_at: number | null;
  created_at: number;
  updated_at: number;
}

const toJob = (r: Row): Job =>
  ({
    id: r.id,
    type: r.type,
    payload: JSON.parse(r.payload),
    dedupeKey: r.dedupe_key,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    runAfter: r.run_after,
    lastError: r.last_error,
    claimedAt: r.claimed_at,
    finishedAt: r.finished_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }) as Job;

export interface EnqueueOptions {
  dedupeKey?: string | null;
  runAfter?: number;
  maxAttempts?: number;
  now?: number;
}

export class JobRepo {
  constructor(private readonly db: Db) {}

  /**
   * Adds a job, or, when a queued job with the same dedupe key exists, returns that one instead
   * (moving its `runAfter` earlier if this call asks for an earlier time). A *running* job with
   * the key does not count: work requested while it runs gets its own queued job, which waits
   * until the running one finishes.
   */
  enqueue<T extends JobType>(
    type: T,
    payload: JobPayloads[T],
    opts: EnqueueOptions = {},
  ): { job: Job; created: boolean } {
    const now = opts.now ?? Date.now();
    const runAfter = opts.runAfter ?? now;
    const key = opts.dedupeKey ?? null;
    return this.db.transaction(() => {
      if (key !== null) {
        const open = this.queuedWithKey(key);
        if (open) {
          if (runAfter < open.runAfter) {
            this.db
              .query("UPDATE jobs SET run_after = ?, updated_at = ? WHERE id = ?")
              .run(runAfter, now, open.id);
          }
          return { job: this.get(open.id)!, created: false };
        }
      }
      const id = newId();
      this.db
        .query(
          `INSERT INTO jobs (id, type, payload, dedupe_key, status, max_attempts, run_after, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
        )
        .run(id, type, JSON.stringify(payload), key, opts.maxAttempts ?? 3, runAfter, now, now);
      return { job: this.get(id)!, created: true };
    })();
  }

  get(id: string): Job | null {
    const r = this.db.query<Row, [string]>("SELECT * FROM jobs WHERE id = ?").get(id);
    return r ? toJob(r) : null;
  }

  list(q: { status?: JobStatus; type?: JobType } = {}): Job[] {
    return this.db
      .query<Row, [string | null, string | null, string | null, string | null]>(
        `SELECT * FROM jobs WHERE (? IS NULL OR status = ?) AND (? IS NULL OR type = ?)
         ORDER BY created_at, id`,
      )
      .all(q.status ?? null, q.status ?? null, q.type ?? null, q.type ?? null)
      .map(toJob);
  }

  /**
   * Takes the next due job (oldest `runAfter` first) and marks it `running`, counting an
   * attempt. Runs as an IMMEDIATE transaction, so two claimers never get the same job. Skips jobs
   * whose dedupe key already has a running job. Returns null when nothing is due.
   */
  claim(opts: { types?: JobType[]; now?: number } = {}): Job | null {
    const now = opts.now ?? Date.now();
    const types = opts.types ?? null;
    if (types !== null && types.length === 0) return null;
    const typeFilter = types === null ? "" : `AND type IN (${types.map(() => "?").join(", ")})`;
    return this.db
      .transaction(() => {
        const row = this.db
          .query<Row, (string | number)[]>(
            `SELECT * FROM jobs j WHERE status = 'queued' AND run_after <= ? ${typeFilter}
               AND (dedupe_key IS NULL OR NOT EXISTS (
                 SELECT 1 FROM jobs r WHERE r.status = 'running' AND r.dedupe_key = j.dedupe_key))
             ORDER BY run_after, id LIMIT 1`,
          )
          .get(now, ...(types ?? []));
        if (!row) return null;
        this.db
          .query(
            `UPDATE jobs SET status = 'running', attempts = attempts + 1, claimed_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(now, now, row.id);
        return this.get(row.id);
      })
      .immediate();
  }

  /** running → done. Null if the job is not running (e.g. it was released meanwhile). */
  complete(id: string, now = Date.now()): Job | null {
    const changed = this.db
      .query(
        "UPDATE jobs SET status = 'done', last_error = NULL, finished_at = ?, updated_at = ? WHERE id = ? AND status = 'running'",
      )
      .run(now, now, id).changes;
    return changed > 0 ? this.get(id) : null;
  }

  /**
   * running → queued again after `retryDelayMs(attempts)` while attempts remain and the error is
   * retryable, else → failed. The returned job's status tells the caller which (`failed` is final:
   * time to mark the meal or transcript failed). Null if the job is not running.
   */
  fail(id: string, error: string, opts: { retryable?: boolean; now?: number } = {}): Job | null {
    const now = opts.now ?? Date.now();
    const job = this.running(id);
    if (!job) return null;
    if (opts.retryable === false || job.attempts >= job.maxAttempts) {
      this.finish(id, "failed", error, now);
      return this.get(id);
    }
    return this.requeue(job, now + retryDelayMs(job.attempts), error, 0, now);
  }

  /**
   * running → queued at `runAfter` without spending an attempt: the job could not proceed yet
   * (e.g. an analysis waiting for its transcripts, the GPU host asleep). Null if not running.
   */
  reschedule(id: string, runAfter: number, reason: string | null = null, now = Date.now()): Job | null {
    const job = this.running(id);
    if (!job) return null;
    return this.requeue(job, runAfter, reason, -1, now);
  }

  /**
   * running → cancelled: the handler stopped because the work is no longer wanted (the meal was
   * removed while it was analysed). Null if the job is not running.
   */
  cancelRunning(id: string, reason: string, now = Date.now()): Job | null {
    if (!this.running(id)) return null;
    this.finish(id, "cancelled", reason, now);
    return this.get(id);
  }

  /** Whether a job with this key is queued or running (e.g. a capture's transcription). */
  isOpen(dedupeKey: string): boolean {
    return (
      this.db
        .query<{ n: number }, [string]>(
          "SELECT count(*) AS n FROM jobs WHERE dedupe_key = ? AND status IN ('queued', 'running')",
        )
        .get(dedupeKey)!.n > 0
    );
  }

  /** Whether a job with this key waits in the queue (e.g. another analysis of the meal). */
  hasQueued(dedupeKey: string): boolean {
    return this.queuedWithKey(dedupeKey) !== null;
  }

  /**
   * Makes the queued job with this key due now if it waits for later (e.g. an analysis waiting
   * for a transcript that just finished). Returns whether one was moved.
   */
  expedite(dedupeKey: string, now = Date.now()): boolean {
    return (
      this.db
        .query(
          `UPDATE jobs SET run_after = ?, updated_at = ?
           WHERE dedupe_key = ? AND status = 'queued' AND run_after > ?`,
        )
        .run(now, now, dedupeKey, now).changes > 0
    );
  }

  /** Cancels the queued job with this key, if any (e.g. the audio capture was retracted). */
  cancelQueued(dedupeKey: string, reason: string, now = Date.now()): number {
    return this.db
      .query(
        `UPDATE jobs SET status = 'cancelled', last_error = ?, finished_at = ?, updated_at = ?
         WHERE dedupe_key = ? AND status = 'queued'`,
      )
      .run(reason, now, now, dedupeKey).changes;
  }

  /**
   * At startup, before the worker loop claims anything: jobs a previous process left `running`
   * were interrupted. They count as a failed attempt (so a job that crashes the server cannot loop
   * forever) and are queued again or failed.
   */
  releaseInterrupted(now = Date.now()): Job[] {
    return this.db.transaction(() =>
      this.db
        .query<Row, []>("SELECT * FROM jobs WHERE status = 'running' ORDER BY claimed_at, id")
        .all()
        .map(toJob)
        .map((job) => this.fail(job.id, "interrupted: the server stopped while it ran", { now })!),
    )();
  }

  private running(id: string): Job | null {
    const job = this.get(id);
    return job?.status === "running" ? job : null;
  }

  private queuedWithKey(key: string): Job | null {
    const r = this.db
      .query<Row, [string]>("SELECT * FROM jobs WHERE dedupe_key = ? AND status = 'queued'")
      .get(key);
    return r ? toJob(r) : null;
  }

  private finish(id: string, status: "failed" | "cancelled", error: string | null, now: number): void {
    this.db
      .query("UPDATE jobs SET status = ?, last_error = ?, finished_at = ?, updated_at = ? WHERE id = ?")
      .run(status, error, now, now, id);
  }

  /** Back to queued, unless a newer queued job with the same key took over: then cancelled. */
  private requeue(job: Job, runAfter: number, error: string | null, attemptsDelta: number, now: number): Job {
    return this.db.transaction(() => {
      const newer = job.dedupeKey === null ? null : this.queuedWithKey(job.dedupeKey);
      if (newer) {
        this.finish(job.id, "cancelled", `${error ?? "requeued"}; superseded by job ${newer.id}`, now);
      } else {
        this.db
          .query(
            `UPDATE jobs SET status = 'queued', run_after = ?, attempts = attempts + ?, last_error = ?,
               updated_at = ? WHERE id = ?`,
          )
          .run(runAfter, attemptsDelta, error, now, job.id);
      }
      return this.get(job.id)!;
    })();
  }
}
