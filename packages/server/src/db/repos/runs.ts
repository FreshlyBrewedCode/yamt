import type { AnalysisRun, RunStatus, RunUsage } from "@yamt/shared";
import type { Db } from "../index.ts";

interface Row {
  id: string;
  meal_id: string;
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
  revision_id: string | null;
}

const toRun = (r: Row): AnalysisRun => ({
  id: r.id,
  mealId: r.meal_id,
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
  revisionId: r.revision_id,
});

export interface NewRun {
  id: string;
  mealId: string;
  jobId: string | null;
  attempt: number;
  harness: string;
  /** What the settings ask for; `model` starts as the requested one until the harness reports its own. */
  model: string | null;
  effort: string | null;
  startedAt: number;
}

export interface RunEnd {
  status: Exclude<RunStatus, "running">;
  endedAt: number;
  model: string | null;
  effort: string | null;
  configNote: string | null;
  stopReason: string | null;
  usage: RunUsage | null;
  error: string | null;
  revisionId: string | null;
}

/** Analysis runs: inserted `running` when a run starts, finished once. */
export class RunRepo {
  constructor(private readonly db: Db) {}

  insert(r: NewRun): AnalysisRun {
    this.db
      .query(
        `INSERT INTO runs (id, meal_id, job_id, attempt, harness, model, requested_model, requested_effort,
           status, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
      )
      .run(r.id, r.mealId, r.jobId, r.attempt, r.harness, r.model, r.model, r.effort, r.startedAt);
    return this.get(r.id)!;
  }

  get(id: string): AnalysisRun | null {
    const r = this.db.query<Row, [string]>("SELECT * FROM runs WHERE id = ?").get(id);
    return r ? toRun(r) : null;
  }

  /** A meal's runs, newest first. */
  listForMeal(mealId: string): AnalysisRun[] {
    return this.db
      .query<Row, [string]>("SELECT * FROM runs WHERE meal_id = ? ORDER BY started_at DESC, id DESC")
      .all(mealId)
      .map(toRun);
  }

  finish(id: string, end: RunEnd): AnalysisRun | null {
    this.db
      .query(
        `UPDATE runs SET status = ?, ended_at = ?, model = COALESCE(?, model), effort = ?, config_note = ?,
           stop_reason = ?, usage = ?, error = ?, revision_id = ? WHERE id = ? AND status = 'running'`,
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
        end.revisionId,
        id,
      );
    return this.get(id);
  }

  /** At startup: runs a previous process left `running` were interrupted with it. */
  failInterrupted(now = Date.now()): number {
    return this.db
      .query(
        "UPDATE runs SET status = 'failed', ended_at = ?, error = 'interrupted: the server stopped while it ran' WHERE status = 'running'",
      )
      .run(now).changes;
  }
}
