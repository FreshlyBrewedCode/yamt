import type { Goal } from "./api-goals.ts";
import { type GoalKind, guidedSummary, KCAL_FLOOR, type Sex } from "./goal-calc.ts";

/**
 * How a day (or a week) sat against its kcal target, relative to the goal in force (#33, from
 * spike #31). Pure: the server hands the calendar its inputs, the web app classifies.
 *
 * The "on plan" range is asymmetric per goal kind, so the helpful direction has more room: cut
 * −15 % … +5 %, maintain ±10 %, bulk −5 % … +15 %. Outside it a day is "just off" (within ±25 %
 * of the target) or "far off" (beyond). The direction is a plain fact (over / under, outside a
 * ±5 % dead zone), never a judgement. "Too low" marks a day under the calorie floor, or more than
 * 25 % under on a cut: a quiet mark of its own, never an alarm colour. Every threshold is a named
 * constant here, so they can be tuned later.
 */

export type PlanBand = "on" | "just" | "far" | "none";
export type PlanDirection = "over" | "under" | null;

/** What the classifier needs of a day. */
export interface DayInput {
  /** kcal counted that day (analysed meals only). */
  kcal: number;
  /** The kcal target in force; null without one. */
  target: number | null;
  /** The range to judge by: the goal's kind (targets set by hand: `maintain`); null without a goal. */
  goalKind: GoalKind | null;
  /** The calorie floor (kcal/day); null when there is none. */
  floor: number | null;
}

export interface Classification {
  band: PlanBand;
  direction: PlanDirection;
  tooLow: boolean;
}

export interface WeekClassification extends Classification {
  /** Days that counted: tracked, analysed, with a kcal target. */
  days: number;
}

/** The on-plan range per goal kind, as deviations from the kcal target (−0.15 = 15 % under). */
export const ON_PLAN: Record<GoalKind, { under: number; over: number }> = {
  cut: { under: -0.15, over: 0.05 },
  maintain: { under: -0.1, over: 0.1 },
  bulk: { under: -0.05, over: 0.15 },
};
/** Within this deviation either way, outside the range, a day is "just off"; beyond it "far off". */
export const FAR_OFF = 0.25;
/** Within this deviation no direction cap shows: the day counts as on the target. */
export const DEAD_ZONE = 0.05;
/** On a cut, a day more than this far under the target is "too low", whatever the floor. */
export const TOO_LOW_ON_CUT = 0.25;
/** A week shows how many days it averages when fewer than this counted. */
export const WEEK_FULL_DAYS = 4;
/** What a goal without a guided derivation is called; it is read with the maintain range. */
export const MANUAL_LABEL = "Manual targets";

export const UNCLASSIFIED: Classification = { band: "none", direction: null, tooLow: false };

// a day exactly on a boundary (1,700 of 2,000 is −15 %) counts as inside it, whatever floating point says
const EPS = 1e-9;

function classify(kcal: number, target: number, goalKind: GoalKind, floor: number | null): Classification {
  const dev = kcal / target - 1;
  const range = ON_PLAN[goalKind];
  const band: PlanBand =
    dev >= range.under - EPS && dev <= range.over + EPS
      ? "on"
      : Math.abs(dev) <= FAR_OFF + EPS
        ? "just"
        : "far";
  const direction: PlanDirection = dev > DEAD_ZONE + EPS ? "over" : dev < -DEAD_ZONE - EPS ? "under" : null;
  const tooLow = (floor !== null && kcal < floor) || (goalKind === "cut" && dev < -TOO_LOW_ON_CUT - EPS);
  return { band, direction, tooLow };
}

const counts = (d: DayInput | null | undefined): d is DayInput & { target: number; goalKind: GoalKind } =>
  !!d && d.target !== null && d.target > 0 && d.goalKind !== null;

/** One day against the goal in force that day. Without a kcal target there is nothing to classify. */
export function classifyDay(day: DayInput | null | undefined): Classification {
  return counts(day) ? classify(day.kcal, day.target, day.goalKind, day.floor) : UNCLASSIFIED;
}

/**
 * A week as the mean of its days' kcal shares of their own targets (each day against the target
 * in force that day, so a goal change mid-week still averages cleanly), judged by the range of
 * the goal in force on the week's last counted day (its floor applies to the mean, in that goal's
 * kcal). Days without a target or totals are left out; `days` says how many counted.
 */
export function classifyWeek(days: readonly (DayInput | null | undefined)[]): WeekClassification {
  const counted = days.filter(counts);
  const last = counted.at(-1);
  if (!last) return { ...UNCLASSIFIED, days: 0 };
  const share = counted.reduce((sum, d) => sum + d.kcal / d.target, 0) / counted.length;
  return { ...classify(share * last.target, last.target, last.goalKind, last.floor), days: counted.length };
}

/** "on plan", "just off, over", "far off, too low"; "" for a day without a classification. */
export function planWords(c: Classification): string {
  if (c.band === "none") return "";
  const band = c.band === "on" ? "on plan" : c.band === "just" ? "just off" : "far off";
  return `${band}${c.tooLow ? ", too low" : c.direction ? `, ${c.direction}` : ""}`;
}

/** "on plan from 15 % under to 5 % over the kcal target", for the legend. */
export function rangeWords(goalKind: GoalKind): string {
  const r = ON_PLAN[goalKind];
  const pct = (x: number) => `${Math.round(Math.abs(x) * 100)} %`;
  return -r.under === r.over
    ? `on plan within ${pct(r.over)} of the kcal target`
    : `on plan from ${pct(r.under)} under to ${pct(r.over)} over the kcal target`;
}

/** What the calendar reads off a goal: its kind (null: set by hand), its label and its kcal floor. */
export interface GoalPlan {
  kind: GoalKind | null;
  label: string;
  floorKcal: number | null;
}

/**
 * A guided goal knows its kind and the floor its calculation used (a cut's floor is at least the
 * resting energy). Targets set by hand have no kind (the calendar reads them with the maintain
 * range) and take the floor yamt would set for the profile's sex; without a profile, none.
 */
export function goalPlan(goal: Pick<Goal, "note" | "derivation">, sex: Sex | null): GoalPlan {
  const d = goal.derivation;
  if (d)
    return { kind: d.choices.goal, label: goal.note || guidedSummary(d), floorKcal: d.result.kcal.floor };
  return { kind: null, label: goal.note || MANUAL_LABEL, floorKcal: sex ? KCAL_FLOOR[sex] : null };
}

/** A day's classifier input from its counted kcal (null: nothing counted) and the goal in force. */
export function dayInput(
  kcal: number | null,
  goal: (GoalPlan & { targets: { energyKcal: number | null } }) | null,
): DayInput | null {
  if (kcal === null) return null;
  if (!goal) return { kcal, target: null, goalKind: null, floor: null };
  return { kcal, target: goal.targets.energyKcal, goalKind: goal.kind ?? "maintain", floor: goal.floorKcal };
}
