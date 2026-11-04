import type { Job, JobRepo, JobType } from "../db/repos/jobs.ts";

/** A claimed job of one type. */
export type JobOf<T extends JobType> = Extract<Job, { type: T }>;

/** What a handler reports; the worker turns it into the queue transition. */
export type JobOutcome =
  /** → done */
  | { status: "done" }
  /** → queued again after the backoff while attempts remain, else failed; `retryable: false` fails at once */
  | { status: "failed"; error: string; retryable?: boolean }
  /** → queued at `runAfter` without spending an attempt (waiting for something) */
  | { status: "reschedule"; runAfter: number; reason: string };

export interface JobContext {
  /** Aborted when the worker stops (server shutdown): wrap up and return `reschedule`. */
  signal: AbortSignal;
}

export interface JobHandler<T extends JobType> {
  type: T;
  /** How many jobs (or batches, with `runBatch`) of this type may run at once; other types don't count. */
  concurrency: number;
  run(job: JobOf<T>, ctx: JobContext): Promise<JobOutcome>;
  /**
   * With `batchSize` > 1: a free slot claims up to that many due jobs at once and runs them
   * together (transcription: one STT process loads the model once for all of them). Returns one
   * outcome per job, in order; a throw fails them all (retryable).
   */
  runBatch?(jobs: JobOf<T>[], ctx: JobContext): Promise<JobOutcome[]>;
  batchSize?: number;
  /**
   * After the queue transition, with the job as it now is: `done`, `queued` (retry or
   * reschedule), `failed` (final) or `cancelled` (a newer job with its key took over).
   */
  settled?(job: JobOf<T>, outcome: JobOutcome): void;
}

export interface WorkerOptions {
  /** How often the queue is polled for due jobs. */
  pollMs?: number;
  now?: () => number;
}

interface Lane {
  // biome-ignore lint/suspicious/noExplicitAny: handlers of every job type share the lanes map
  handler: JobHandler<any>;
  /** One entry per running job or batch, keyed by its first job's id. */
  running: Map<string, { jobs: number; done: Promise<void> }>;
}

/**
 * The single in-process worker loop over the `jobs` table. Handlers register by job type, each
 * with its own concurrency (analyse: one run at a time; transcribe: one batch at a time,
 * alongside). Every poll fills each lane up to its limit with `claim({types: [type]})` (a batch
 * handler claims up to `batchSize` jobs per slot); the queue itself keeps two jobs with the same
 * dedupe key from running at once. A handler's outcome becomes `complete`,
 * `fail` (with the queue's backoff) or `reschedule`; a handler that throws counts as a retryable
 * failure. `stop()` aborts what runs and waits for it.
 */
export class JobWorker {
  private readonly lanes = new Map<JobType, Lane>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly abort = new AbortController();
  private readonly pollMs: number;
  private readonly now: () => number;
  private stopped = false;

  constructor(
    private readonly jobs: JobRepo,
    opts: WorkerOptions = {},
  ) {
    this.pollMs = opts.pollMs ?? 1000;
    this.now = opts.now ?? Date.now;
  }

  register<T extends JobType>(handler: JobHandler<T>): this {
    if (this.lanes.has(handler.type))
      throw new Error(`a handler for ${handler.type} jobs is registered already`);
    this.lanes.set(handler.type, { handler, running: new Map() });
    return this;
  }

  start(): this {
    if (!this.stopped && !this.timer) this.schedule(0);
    return this;
  }

  /** Poll now (e.g. right after enqueueing), instead of at the next tick. */
  wake(): void {
    if (this.stopped || !this.timer) return;
    clearTimeout(this.timer);
    this.schedule(0);
  }

  /** Jobs running now, by type (every job of a batch counts). */
  runningCount(type: JobType): number {
    let n = 0;
    for (const r of this.lanes.get(type)?.running.values() ?? []) n += r.jobs;
    return n;
  }

  /** Stop polling, abort running jobs and wait until their handlers have returned. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.abort.abort();
    await Promise.all([...this.lanes.values()].flatMap((l) => [...l.running.values()].map((r) => r.done)));
  }

  private schedule(ms: number): void {
    this.timer = setTimeout(() => {
      this.poll();
      if (!this.stopped) this.schedule(this.pollMs);
    }, ms);
  }

  private poll(): void {
    for (const [type, lane] of this.lanes) {
      const max = lane.handler.runBatch ? Math.max(1, lane.handler.batchSize ?? 1) : 1;
      while (!this.stopped && lane.running.size < lane.handler.concurrency) {
        const batch: Job[] = [];
        try {
          while (batch.length < max) {
            const job = this.jobs.claim({ types: [type], now: this.now() });
            if (!job) break;
            batch.push(job);
          }
        } catch (e) {
          console.error(`job worker: claiming ${type} failed`, e);
        }
        if (batch.length === 0) break;
        const id = batch[0]!.id;
        const done = this.execute(lane, batch).finally(() => {
          lane.running.delete(id);
          // a slot is free: the next job need not wait for the tick
          if (!this.stopped) this.wake();
        });
        lane.running.set(id, { jobs: batch.length, done });
      }
    }
  }

  private async execute(lane: Lane, batch: Job[]): Promise<void> {
    const ctx = { signal: this.abort.signal };
    let outcomes: JobOutcome[];
    try {
      outcomes = lane.handler.runBatch
        ? await lane.handler.runBatch(batch, ctx)
        : [await lane.handler.run(batch[0]!, ctx)];
    } catch (e) {
      console.error(`job ${batch[0]!.type} ${batch.map((j) => j.id).join(", ")} failed`, e);
      const error = e instanceof Error ? e.message : String(e);
      outcomes = batch.map(() => ({ status: "failed", error }));
    }
    for (const [i, job] of batch.entries()) {
      this.record(lane, job, outcomes[i] ?? { status: "failed", error: "the handler returned no outcome" });
    }
  }

  private record(lane: Lane, job: Job, outcome: JobOutcome): void {
    try {
      const now = this.now();
      const after =
        outcome.status === "done"
          ? this.jobs.complete(job.id, now)
          : outcome.status === "failed"
            ? this.jobs.fail(job.id, outcome.error, { retryable: outcome.retryable, now })
            : this.jobs.reschedule(job.id, outcome.runAfter, outcome.reason, now);
      if (after) lane.handler.settled?.(after, outcome);
    } catch (e) {
      console.error(`job ${job.type} ${job.id}: recording the outcome failed`, e);
    }
  }
}
