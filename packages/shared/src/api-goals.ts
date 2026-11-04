import { z } from "zod";
import type { MealSummary } from "./api-meals.ts";
import type { CoreNutrient, NutrientTotals } from "./api-nutrition.ts";
import type { WeightEntry } from "./api-weight.ts";

/**
 * Daily goals and the day view (#12). A goal is a set of daily targets in force from a local
 * calendar date (`YYYY-MM-DD`) until the next goal starts, so a past day is always compared
 * with the targets that applied then. Setting new targets adds a goal; only a typo fix changes
 * the latest one in place.
 */

export const goalPaths = {
  /** GET the history (newest first); POST a new goal (`CreateGoalBody`). */
  goals: "/api/goals",
  /** GET the goal in force on `?date=` (default today, in `?tz=`). */
  current: "/api/goals/current",
  /** PATCH: fix the latest goal in place (`FixGoalBody`), for typos. */
  goal: (id: string) => `/api/goals/${id}`,
  /** GET a calendar day (`?tz=`): meals, totals, the goal in force, progress, weight. */
  day: (date: string) => `/api/days/${date}`,
} as const;

/** What a goal can set a daily target for: energy and four macros (the core set's names). */
export const TARGET_KEYS = ["energyKcal", "protein", "fat", "carbohydrate", "fiber"] as const;
export type TargetKey = (typeof TARGET_KEYS)[number] & CoreNutrient;

/** Daily targets: kcal for energy, grams for the rest; null = no target for it. */
export type Targets = Record<TargetKey, number | null>;

export interface Goal {
  id: string;
  /** The local calendar date it applies from (`YYYY-MM-DD`). */
  effectiveFrom: string;
  targets: Targets;
  note: string;
  createdAt: number;
  updatedAt: number;
}

/** `YYYY-MM-DD`, a real calendar date. */
export const LocalDate = z.iso.date();

const kcalTarget = z.number().int().min(1).max(20_000).nullable().default(null);
const gramsTarget = z.number().positive().max(2_000).nullable().default(null);

const targetsShape = {
  energyKcal: kcalTarget,
  protein: gramsTarget,
  fat: gramsTarget,
  carbohydrate: gramsTarget,
  fiber: gramsTarget,
  note: z.string().trim().max(1_000).default(""),
};

/**
 * `POST /api/goals`: new targets from `effectiveFrom` (default: today in the server's zone; the
 * web app sends the phone's today). An omitted target is "no target". Earlier goals stay as
 * they are: the history is never rewritten.
 */
export const CreateGoalBody = z.object({ ...targetsShape, effectiveFrom: LocalDate.optional() }).strict();
export type CreateGoalBody = z.infer<typeof CreateGoalBody>;

/**
 * `PATCH /api/goals/:id`: fix a typo in the latest goal, in place (same `effectiveFrom`). Older
 * goals are history and can't be changed (409).
 */
export const FixGoalBody = z.object(targetsShape).strict();
export type FixGoalBody = z.infer<typeof FixGoalBody>;

/** `GET /api/goals/current?date&tz`. */
export const CurrentGoalQuery = z.object({
  date: LocalDate.optional(),
  tz: z.string().min(1).max(64).optional(),
});
export type CurrentGoalQuery = z.infer<typeof CurrentGoalQuery>;

/** `GET /api/days/:date?tz`: the day reckoned in `tz` (an IANA zone; the server's by default). */
export const DayQuery = z.object({ tz: z.string().min(1).max(64).optional() });
export type DayQuery = z.infer<typeof DayQuery>;

export interface GoalsResponse {
  /** Newest first: by `effectiveFrom`, then creation. */
  goals: Goal[];
}

export interface GoalResponse {
  goal: Goal;
}

export interface CurrentGoalResponse {
  date: string;
  goal: Goal | null;
}

/** One target's state on a day: what was eaten against it. */
export interface TargetProgress {
  eaten: number;
  /** Null when the goal sets none (or there is no goal). */
  target: number | null;
  /** `target − eaten`; negative when over. Null without a target. */
  left: number | null;
  /** Eaten more than the target (a fact, not a verdict: protein and fibre are minimums). */
  over: boolean;
}

export type DayProgress = Record<TargetKey, TargetProgress>;

/**
 * `GET /api/days/:date`: the meals eaten that day (as in the overview), the day's totals over
 * their current revisions, the goal in force and the progress against it, and the weight
 * entries measured that day (newest first).
 */
export interface DayResponse {
  date: string;
  timeZone: string;
  /** The day's bounds in the zone, [from, to) epoch ms. */
  from: number;
  to: number;
  meals: MealSummary[];
  totals: NutrientTotals;
  /** Meals without an analysis yet: listed, but not counted in `totals`. */
  unanalysed: number;
  goal: Goal | null;
  progress: DayProgress;
  weight: WeightEntry[];
}

/**
 * The goal in force on `date`: the latest with `effectiveFrom` ≤ date (two on the same date: the
 * one created later, i.e. the larger UUIDv7). The server's SQL does the same; this one serves
 * the web app, which has the whole (short) history anyway.
 */
export function goalInForce<G extends Pick<Goal, "id" | "effectiveFrom">>(
  goals: readonly G[],
  date: string,
): G | null {
  let best: G | null = null;
  for (const g of goals) {
    if (g.effectiveFrom > date) continue;
    if (
      !best ||
      g.effectiveFrom > best.effectiveFrom ||
      (g.effectiveFrom === best.effectiveFrom && g.id > best.id)
    )
      best = g;
  }
  return best;
}

/** Eaten against each target. Totals are already computed and rounded (`computeTotals`). */
export function dayProgress(nutrients: Record<CoreNutrient, number>, targets: Targets | null): DayProgress {
  const out = {} as DayProgress;
  for (const key of TARGET_KEYS) {
    const eaten = nutrients[key];
    const target = targets?.[key] ?? null;
    const left = target === null ? null : Math.round((target - eaten) * 10) / 10;
    out[key] = { eaten, target, left, over: left !== null && left < 0 };
  }
  return out;
}

/** `YYYY-MM-DD` plus `days` calendar days (date arithmetic only; no zone involved). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * When each goal of a history held: `until` is the last day before the next later start (null:
 * still in force, or not yet started); `replaced` marks a goal that a newer one with the same
 * start date replaced, so it was never in force. `goals` newest first, as the API lists them.
 */
export function goalPeriods<G extends Pick<Goal, "id" | "effectiveFrom">>(
  goals: readonly G[],
): (G & { until: string | null; replaced: boolean })[] {
  return goals.map((g, i) => {
    const newer = goals.slice(0, i);
    const next = newer.findLast((n) => n.effectiveFrom > g.effectiveFrom);
    return {
      ...g,
      until: next ? addDays(next.effectiveFrom, -1) : null,
      replaced: newer.some((n) => n.effectiveFrom === g.effectiveFrom),
    };
  });
}
