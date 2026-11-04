import { z } from "zod";
import type { Goal } from "./api-goals.ts";
import type { NutrientTotals } from "./api-nutrition.ts";
import type { DayInput, GoalPlan } from "./plan.ts";

/**
 * The calendar (#33): a month of days, each against the goal in force that day, read by the
 * classifier in `plan.ts`. One request per month; the days are the phone's calendar days.
 */

export const calendarPaths = {
  /** GET a month (`YYYY-MM`, `?tz=`): its days, weeks, summary and weight. */
  month: (month: string) => `/api/months/${month}`,
} as const;

/** `YYYY-MM`. */
export const LocalMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected YYYY-MM");

/** `GET /api/months/:month?tz`: the month reckoned in `tz` (an IANA zone; the server's by default). */
export const MonthQuery = z.object({ tz: z.string().min(1).max(64).optional() });
export type MonthQuery = z.infer<typeof MonthQuery>;

/** The goal in force on a day, as the calendar reads it. */
export type PlanGoal = Pick<Goal, "id" | "effectiveFrom" | "targets"> & GoalPlan;

export interface MonthDay {
  /** `YYYY-MM-DD` in the zone. */
  date: string;
  /** Meals eaten that day (a draft with nothing captured is no meal yet; a copy is one). */
  meals: number;
  /** Of those, the ones without an analysis yet: they count nothing. */
  unanalysed: number;
  /** Over the current revisions of the analysed meals (`computeTotals`); null when none counts. */
  totals: NutrientTotals | null;
  goal: PlanGoal | null;
  /** The mean of the day's weight entries; null without one. */
  weightKg: number | null;
}

export interface MonthWeek {
  /** Its Monday (`YYYY-MM-DD`; may lie in the month before). */
  start: string;
  /**
   * Monday to Sunday, neighbouring months' days included, each as `classifyWeek` takes it: null
   * for a day with nothing counted, or one after today.
   */
  days: (DayInput | null)[];
}

export interface MonthSummary {
  /** Days of the month up to today (all of them for a past month). */
  days: number;
  /** Of those, days with a meal. */
  tracked: number;
  /** Mean kcal over the days with something counted; null without any. */
  avgKcal: number | null;
  /** Mean of those days' kcal shares of their own kcal target (1 = on it); null without targets. */
  kcalShare: number | null;
  avgProtein: number | null;
  /** The goal in force on the last day so far, for "/2,100". */
  goal: PlanGoal | null;
}

/** A day of the month with weight entries: their mean, and the 7-day moving average up to it. */
export interface MonthWeight {
  date: string;
  kg: number;
  avg: number;
}

export interface MonthResponse {
  month: string;
  timeZone: string;
  /** Today in the zone: later days are the future. */
  today: string;
  /** Every day of the month, the 1st first. */
  days: MonthDay[];
  /** The Monday-first weeks the month touches, the first first. */
  weeks: MonthWeek[];
  summary: MonthSummary;
  /** The days so far with weight entries, oldest first. */
  weight: MonthWeight[];
}

/** Days in a month: `monthDays("2026-02")` → 28. */
export function monthDays(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/** `YYYY-MM` plus `n` months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** 0 for Monday … 6 for Sunday (date arithmetic only; no zone involved). */
export const weekdayIndex = (date: string): number => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
