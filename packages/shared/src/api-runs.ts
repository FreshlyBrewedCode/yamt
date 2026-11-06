import { z } from "zod";

/**
 * Analysis runs (#8): each attempt of a meal's `analyse` job drives an agent over ACP and gets a
 * run, with its full event stream stored as a trace. A revision saved by a run carries its
 * `runId`; `GET /api/meals/:id` lists the meal's runs.
 */

export const runPaths = {
  run: (id: string) => `/api/runs/${id}`,
  /** A planning run (`PlanningRunResponse`). */
  planningRun: (id: string) => `/api/planning/runs/${id}`,
  /** An analysis or planning run's NDJSON (`application/x-ndjson`), one `TraceEntry` per line. */
  trace: (id: string) => `/api/runs/${id}/trace`,
} as const;

/** `running` → `succeeded` (saved exactly one revision) | `failed` | `cancelled` (server stopped). */
export const RunStatus = z.enum(["running", "succeeded", "failed", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatus>;

export interface RunUsage {
  /** The turn's token usage as the harness reports it (ACP `PromptResponse.usage`), if it does. */
  turn: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    thoughtTokens?: number | null;
    cachedReadTokens?: number | null;
    cachedWriteTokens?: number | null;
  } | null;
  /** The last context report: tokens in context, window size, cumulative cost. */
  context: { used: number; size: number; cost: { amount: number; currency: string } | null } | null;
}

export interface AnalysisRun {
  id: string;
  mealId: string;
  jobId: string | null;
  /** The job's attempt (1, 2, …): a failed run is retried with backoff. */
  attempt: number;
  /** `claude-code`, `opencode` or `custom`. */
  harness: string;
  /** The model the settings asked for (null: the harness's default). */
  requestedModel: string | null;
  /** The model that answered, as the harness reports it (else the one asked for). */
  model: string | null;
  /** The effort the settings asked for (null: the harness's default). */
  requestedEffort: string | null;
  /** The effort the session ran with (the harness's effort option at the prompt), null if it has none. */
  effort: string | null;
  /**
   * What didn't apply as asked, in a sentence: a model or effort the harness doesn't offer (any
   * more), so its default ran. Null when everything applied.
   */
  configNote: string | null;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  /** ACP stop reason: `end_turn`, `max_tokens`, `refusal`, `cancelled`, … */
  stopReason: string | null;
  usage: RunUsage | null;
  error: string | null;
  /** The revision this run saved. */
  revisionId: string | null;
}

export interface RunResponse {
  run: AnalysisRun;
}

/**
 * A planning run (#45): an attempt of a round's `plan` job, with its trace in the same place
 * (`runPaths.trace` serves both kinds). Like an analysis run, without the meal and the revision.
 */
export interface PlanningRun extends Omit<AnalysisRun, "mealId" | "revisionId"> {
  roundId: string;
  /** The round's suggestions that were ready when the run ended; null while it runs. */
  ready: number | null;
}

/** `GET /api/planning/runs/:id`. */
export interface PlanningRunResponse {
  run: PlanningRun;
}

/**
 * One line of a trace. `t` is ms since the run started. `kind` is `run.start`, `process.start`,
 * `initialize`, `session.new`, `config`, `prompt`, `update` (an ACP `session/update`, in
 * `update`), `permission`, `cancel`, `prompt.end`, `notification`, `process.exit`, `run.end`.
 * Secrets are redacted and image data replaced by its size.
 */
export interface TraceEntry {
  t: number;
  at: number;
  kind: string;
  [key: string]: unknown;
}
