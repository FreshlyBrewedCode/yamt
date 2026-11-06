import type {
  MealSlot,
  PlanningRound,
  PlanningRoundKind,
  PlanningRoundStatus,
  PlanningRoundTally,
  PlanningSuggestion,
  RecipeSourceMode,
  SuggestionStatus,
  SuggestionVerdict,
} from "@yamt/shared";
import { type Db, newId } from "../index.ts";

interface RoundRow {
  id: string;
  request_id: string;
  number: number;
  kind: PlanningRoundKind;
  status: PlanningRoundStatus;
  count: number;
  run_id: string | null;
  error: string | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
}

const toRound = (r: RoundRow): PlanningRound => ({
  id: r.id,
  requestId: r.request_id,
  number: r.number,
  kind: r.kind,
  status: r.status,
  count: r.count,
  runId: r.run_id,
  error: r.error,
  createdAt: r.created_at,
  startedAt: r.started_at,
  endedAt: r.ended_at,
});

interface SuggestionRow {
  id: string;
  round_id: string;
  position: number;
  status: SuggestionStatus;
  title: string;
  approach: string;
  source_mode: RecipeSourceMode;
  source_url: string | null;
  proposed_date: string | null;
  proposed_slot: MealSlot | null;
  recipe_id: string | null;
  why: string;
  failure: string | null;
  verdict: SuggestionVerdict | null;
  planned_meal_id: string | null;
  created_at: number;
  updated_at: number;
}

const toSuggestion = (r: SuggestionRow): PlanningSuggestion => ({
  id: r.id,
  roundId: r.round_id,
  position: r.position,
  status: r.status,
  title: r.title,
  approach: r.approach,
  sourceMode: r.source_mode,
  sourceUrl: r.source_url,
  proposedDate: r.proposed_date,
  proposedSlot: r.proposed_slot,
  recipeId: r.recipe_id,
  why: JSON.parse(r.why) as string[],
  failure: r.failure,
  verdict: r.verdict,
  plannedMealId: r.planned_meal_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** An idea of a round's outline. */
export interface OutlineIdea {
  title: string;
  approach: string;
  sourceMode: RecipeSourceMode;
  sourceUrl: string | null;
  proposedDate: string | null;
  proposedSlot: MealSlot | null;
}

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");

/**
 * A request's rounds (`queued` → `running` → `done` | `failed`; one open per request, a unique
 * index backs it) and their suggestions (`outlined` → `ready` | `failed`, with the user's verdict).
 * The service checks where a transition may come from.
 */
export class PlanningRoundRepo {
  constructor(private readonly db: Db) {}

  /** The request's next round (number = the last + 1), `queued`. */
  insert(r: {
    id?: string;
    requestId: string;
    kind: PlanningRoundKind;
    count: number;
    now?: number;
  }): PlanningRound {
    const id = r.id ?? newId();
    this.db
      .query(
        `INSERT INTO planning_rounds (id, request_id, number, kind, count, created_at)
         VALUES (?, ?, (SELECT coalesce(max(number), 0) + 1 FROM planning_rounds WHERE request_id = ?), ?, ?, ?)`,
      )
      .run(id, r.requestId, r.requestId, r.kind, r.count, r.now ?? Date.now());
    return this.get(id)!;
  }

  get(id: string): PlanningRound | null {
    const r = this.db.query<RoundRow, [string]>("SELECT * FROM planning_rounds WHERE id = ?").get(id);
    return r ? toRound(r) : null;
  }

  /** Oldest first. */
  listForRequest(requestId: string): PlanningRound[] {
    return this.db
      .query<RoundRow, [string]>("SELECT * FROM planning_rounds WHERE request_id = ? ORDER BY number")
      .all(requestId)
      .map(toRound);
  }

  /** The request's queued or running round, if any. */
  open(requestId: string): PlanningRound | null {
    const r = this.db
      .query<RoundRow, [string]>(
        "SELECT * FROM planning_rounds WHERE request_id = ? AND status IN ('queued', 'running')",
      )
      .get(requestId);
    return r ? toRound(r) : null;
  }

  /** Each request's latest round with its suggestions counted. */
  latestTallies(requestIds: readonly string[]): Map<string, PlanningRoundTally> {
    const out = new Map<string, PlanningRoundTally>();
    if (requestIds.length === 0) return out;
    const rows = this.db
      .query<
        RoundRow & {
          outlined: number;
          ready: number;
          failed: number;
          picked: number;
          rejected: number;
        },
        string[]
      >(
        `SELECT r.*,
           coalesce(sum(s.status = 'outlined'), 0) AS outlined,
           coalesce(sum(s.status = 'ready'), 0) AS ready,
           coalesce(sum(s.status = 'failed'), 0) AS failed,
           coalesce(sum(s.verdict = 'picked'), 0) AS picked,
           coalesce(sum(s.verdict = 'rejected'), 0) AS rejected
         FROM planning_rounds r LEFT JOIN planning_suggestions s ON s.round_id = r.id
         WHERE r.request_id IN (${placeholders(requestIds.length)})
           AND r.number = (SELECT max(number) FROM planning_rounds m WHERE m.request_id = r.request_id)
         GROUP BY r.id`,
      )
      .all(...requestIds);
    for (const r of rows) {
      out.set(r.request_id, {
        id: r.id,
        number: r.number,
        kind: r.kind,
        status: r.status,
        count: r.count,
        outlined: r.outlined,
        ready: r.ready,
        failed: r.failed,
        picked: r.picked,
        rejected: r.rejected,
      });
    }
    return out;
  }

  /** A run takes it: `running`, with the run and the time it started. */
  start(id: string, runId: string | null, now = Date.now()): PlanningRound | null {
    this.db
      .query(
        "UPDATE planning_rounds SET status = 'running', run_id = ?, started_at = ?, error = NULL WHERE id = ?",
      )
      .run(runId, now, id);
    return this.get(id);
  }

  /** Back to `queued` (a retry, a server stop); the run that had it stays named until the next. */
  requeue(id: string, error: string | null = null): PlanningRound | null {
    this.db.query("UPDATE planning_rounds SET status = 'queued', error = ? WHERE id = ?").run(error, id);
    return this.get(id);
  }

  finish(
    id: string,
    status: "done" | "failed",
    error: string | null,
    now = Date.now(),
  ): PlanningRound | null {
    this.db
      .query("UPDATE planning_rounds SET status = ?, error = ?, ended_at = ? WHERE id = ?")
      .run(status, error, now, id);
    return this.get(id);
  }

  // suggestions

  getSuggestion(id: string): PlanningSuggestion | null {
    const r = this.db
      .query<SuggestionRow, [string]>("SELECT * FROM planning_suggestions WHERE id = ?")
      .get(id);
    return r ? toSuggestion(r) : null;
  }

  suggestionAt(roundId: string, position: number): PlanningSuggestion | null {
    const r = this.db
      .query<SuggestionRow, [string, number]>(
        "SELECT * FROM planning_suggestions WHERE round_id = ? AND position = ?",
      )
      .get(roundId, position);
    return r ? toSuggestion(r) : null;
  }

  /** By position. */
  suggestions(roundId: string): PlanningSuggestion[] {
    return this.db
      .query<SuggestionRow, [string]>(
        "SELECT * FROM planning_suggestions WHERE round_id = ? ORDER BY position",
      )
      .all(roundId)
      .map(toSuggestion);
  }

  /** The suggestions of every round of a request, by round, then position. */
  suggestionsOfRequest(requestId: string): Map<string, PlanningSuggestion[]> {
    const out = new Map<string, PlanningSuggestion[]>();
    const rows = this.db
      .query<SuggestionRow, [string]>(
        `SELECT s.* FROM planning_suggestions s JOIN planning_rounds r ON r.id = s.round_id
         WHERE r.request_id = ? ORDER BY r.number, s.position`,
      )
      .all(requestId);
    for (const r of rows) out.set(r.round_id, [...(out.get(r.round_id) ?? []), toSuggestion(r)]);
    return out;
  }

  /** The round's outline: its ideas as `outlined` suggestions 0, 1, …, replacing any earlier ones. */
  replaceOutline(roundId: string, ideas: readonly OutlineIdea[], now = Date.now()): PlanningSuggestion[] {
    return this.db.transaction(() => {
      this.db.query("DELETE FROM planning_suggestions WHERE round_id = ?").run(roundId);
      const insert = this.db.query(
        `INSERT INTO planning_suggestions (id, round_id, position, title, approach, source_mode, source_url,
           proposed_date, proposed_slot, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      ideas.forEach((idea, position) => {
        insert.run(
          newId(),
          roundId,
          position,
          idea.title,
          idea.approach,
          idea.sourceMode,
          idea.sourceUrl,
          idea.proposedDate,
          idea.proposedSlot,
          now,
          now,
        );
      });
      return this.suggestions(roundId);
    })();
  }

  /** `ready`: its recipe saved (a second save replaces the first's recipe). */
  markReady(
    id: string,
    s: {
      title: string;
      sourceMode: RecipeSourceMode;
      sourceUrl: string | null;
      proposedDate: string | null;
      proposedSlot: MealSlot | null;
      recipeId: string;
      why: string[];
    },
    now = Date.now(),
  ): PlanningSuggestion | null {
    this.db
      .query(
        `UPDATE planning_suggestions SET status = 'ready', title = ?, source_mode = ?, source_url = ?,
           proposed_date = ?, proposed_slot = ?, recipe_id = ?, why = ?, failure = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        s.title,
        s.sourceMode,
        s.sourceUrl,
        s.proposedDate,
        s.proposedSlot,
        s.recipeId,
        JSON.stringify(s.why),
        now,
        id,
      );
    return this.getSuggestion(id);
  }

  markFailed(id: string, failure: string, now = Date.now()): PlanningSuggestion | null {
    this.db
      .query("UPDATE planning_suggestions SET status = 'failed', failure = ?, updated_at = ? WHERE id = ?")
      .run(failure, now, id);
    return this.getSuggestion(id);
  }

  /** The round's ideas still `outlined` become `failed` with this reason; returns how many. */
  failOutlined(roundId: string, failure: string, now = Date.now()): number {
    return this.db
      .query(
        `UPDATE planning_suggestions SET status = 'failed', failure = ?, updated_at = ?
         WHERE round_id = ? AND status = 'outlined'`,
      )
      .run(failure, now, roundId).changes;
  }

  setVerdict(
    id: string,
    verdict: SuggestionVerdict | null,
    plannedMealId: string | null,
    now = Date.now(),
  ): PlanningSuggestion | null {
    this.db
      .query("UPDATE planning_suggestions SET verdict = ?, planned_meal_id = ?, updated_at = ? WHERE id = ?")
      .run(verdict, plannedMealId, now, id);
    return this.getSuggestion(id);
  }

  /** Its planned meal was unplanned: the pick is undone (no verdict). Returns how many. */
  clearPick(plannedMealId: string, now = Date.now()): number {
    return this.db
      .query(
        `UPDATE planning_suggestions SET verdict = NULL, planned_meal_id = NULL, updated_at = ?
         WHERE planned_meal_id = ?`,
      )
      .run(now, plannedMealId).changes;
  }
}
