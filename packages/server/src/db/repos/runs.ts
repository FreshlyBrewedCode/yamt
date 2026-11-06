import type { AnalysisRun, PlanningRun, RunStatus, RunUsage } from "@yamt/shared";
import type { Db } from "../index.ts";

interface Row {
  id: string;
  meal_id?: string;
  round_id?: string;
  job_id: string | null;
  attempt: number;
  harness: string;
  model: string | null;
  requested_model: string | null;
  requested_effort: string | null;
  effort: string | null;
  config_note: string | null;
  status: RunStatus;
  started_at: number;
  ended_at: number | null;
  stop_reason: string | null;
  usage: string | null;
  error: string | null;
  revision_id?: string | null;
  ready?: number | null;
}

/** What analysis and planning runs have in common. */
type RunFields = Omit<AnalysisRun, "mealId" | "revisionId">;

const toFields = (r: Row): RunFields => ({
  id: r.id,
  jobId: r.job_id,
  attempt: r.attempt,
  harness: r.harness,
  requestedModel: r.requested_model,
  model: r.model,
  requestedEffort: r.requested_effort,
  effort: r.effort,
  configNote: r.config_note,
  status: r.status,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  stopReason: r.stop_reason,
  usage: r.usage === null ? null : (JSON.parse(r.usage) as RunUsage),
  error: r.error,
});

interface NewRunFields {
  id: string;
  jobId: string | null;
  attempt: number;
  harness: string;
  /** What the settings ask for; `model` starts as the requested one until the harness reports its own. */
  model: string | null;
  effort: string | null;
  startedAt: number;
}

export interface NewRun extends NewRunFields {
  mealId: string;
}

export interface NewPlanningRun extends NewRunFields {
  roundId: string;
}

interface RunEndFields {
  status: Exclude<RunStatus, "running">;
  endedAt: number;
  model: string | null;
  effort: string | null;
  configNote: string | null;
  stopReason: string | null;
  usage: RunUsage | null;
  error: string | null;
}

export interface RunEnd extends RunEndFields {
  revisionId: string | null;
}

export interface PlanningRunEnd extends RunEndFields {
  ready: number;
}

const INTERRUPTED = "interrupted: the server stopped while it ran";

/**
 * Agent runs, inserted `running` when a run starts and finished once: `runs` (an analysis of a
 * meal) and `planning_runs` (a planning round's, #45) share these columns and this SQL; each adds
 * what it belongs to and what it produced.
 */
abstract class RunTable<T, New extends NewRunFields, End extends RunEndFields> {
  constructor(
    protected readonly db: Db,
    private readonly table: "runs" | "planning_runs",
    private readonly owner: "meal_id" | "round_id",
    private readonly result: "revision_id" | "ready",
  ) {}

  protected abstract toRun(r: Row): T;
  protected abstract ownerOf(r: New): string;
  protected abstract resultOf(e: End): string | number | null;

  insert(r: New): T {
    this.db
      .query(
        `INSERT INTO ${this.table} (id, ${this.owner}, job_id, attempt, harness, model, requested_model,
           requested_effort, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
      )
      .run(r.id, this.ownerOf(r), r.jobId, r.attempt, r.harness, r.model, r.model, r.effort, r.startedAt);
    return this.get(r.id)!;
  }

  get(id: string): T | null {
    const r = this.db.query<Row, [string]>(`SELECT * FROM ${this.table} WHERE id = ?`).get(id);
    return r ? this.toRun(r) : null;
  }

  /** The runs of a meal or round, newest first. */
  protected listFor(ownerId: string): T[] {
    return this.db
      .query<Row, [string]>(
        `SELECT * FROM ${this.table} WHERE ${this.owner} = ? ORDER BY started_at DESC, id DESC`,
      )
      .all(ownerId)
      .map((r) => this.toRun(r));
  }

  finish(id: string, end: End): T | null {
    this.db
      .query(
        `UPDATE ${this.table} SET status = ?, ended_at = ?, model = COALESCE(?, model), effort = ?,
           config_note = ?, stop_reason = ?, usage = ?, error = ?, ${this.result} = ?
         WHERE id = ? AND status = 'running'`,
      )
      .run(
        end.status,
        end.endedAt,
        end.model,
        end.effort,
        end.configNote,
        end.stopReason,
        end.usage === null ? null : JSON.stringify(end.usage),
        end.error,
        this.resultOf(end),
        id,
      );
    return this.get(id);
  }

  /** At startup: runs a previous process left `running` were interrupted with it. */
  failInterrupted(now = Date.now()): number {
    return this.db
      .query(`UPDATE ${this.table} SET status = 'failed', ended_at = ?, error = ? WHERE status = 'running'`)
      .run(now, INTERRUPTED).changes;
  }
}

/** Analysis runs (#8). */
export class RunRepo extends RunTable<AnalysisRun, NewRun, RunEnd> {
  constructor(db: Db) {
    super(db, "runs", "meal_id", "revision_id");
  }

  protected toRun(r: Row): AnalysisRun {
    return { ...toFields(r), mealId: r.meal_id!, revisionId: r.revision_id ?? null };
  }
  protected ownerOf(r: NewRun): string {
    return r.mealId;
  }
  protected resultOf(e: RunEnd): string | null {
    return e.revisionId;
  }

  /** A meal's runs, newest first. */
  listForMeal(mealId: string): AnalysisRun[] {
    return this.listFor(mealId);
  }
}

/** Planning runs (#45): one per attempt of a round's `plan` job. */
export class PlanningRunRepo extends RunTable<PlanningRun, NewPlanningRun, PlanningRunEnd> {
  constructor(db: Db) {
    super(db, "planning_runs", "round_id", "ready");
  }

  protected toRun(r: Row): PlanningRun {
    return { ...toFields(r), roundId: r.round_id!, ready: r.ready ?? null };
  }
  protected ownerOf(r: NewPlanningRun): string {
    return r.roundId;
  }
  protected resultOf(e: PlanningRunEnd): number {
    return e.ready;
  }

  /** A round's runs, newest first. */
  listForRound(roundId: string): PlanningRun[] {
    return this.listFor(roundId);
  }

  /** The running runs of a request's rounds (an archive revokes their tokens). */
  runningForRequest(requestId: string): PlanningRun[] {
    return this.db
      .query<Row, [string]>(
        `SELECT p.* FROM planning_runs p JOIN planning_rounds r ON r.id = p.round_id
         WHERE r.request_id = ? AND p.status = 'running'`,
      )
      .all(requestId)
      .map((r) => this.toRun(r));
  }
}
