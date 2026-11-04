// Spike #31, round 2: how a day (or a week) sits against its kcal target, relative to the goal in
// force. Pure, no React, no mock: meant to be lifted into the app as it is.
//
// The "on plan" range is asymmetric per goal kind, so the helpful direction has more room:
// cut −15 % … +5 %, maintain ±10 %, bulk −5 % … +15 %. Outside it the day is "just off" (still
// within ±25 % of the target) or "far off" (beyond). Direction is a plain fact (over / under,
// outside a ±5 % dead zone), never a judgement. "Too low" marks a day under the calorie floor,
// or more than 25 % under on a cut: it gets its own quiet mark, never an alarm colour.
import type { GoalKind } from "@yamt/shared";

export type Band = "on" | "just" | "far" | "none";
export type Direction = "over" | "under" | null;

export interface DayInput {
  /** kcal counted that day (analysed meals only). */
  kcal: number;
  /** The kcal target in force; null without a goal. */
  target: number | null;
  goalKind: GoalKind | null;
  /** The calorie floor of the goal (kcal/day); null when the goal has none. */
  floor: number | null;
}

export interface Classification {
  band: Band;
  direction: Direction;
  tooLow: boolean;
}

/** The on-plan range per goal kind, as deviations from the target (−0.15 = 15 % under). */
export const ON_PLAN: Record<GoalKind, { under: number; over: number }> = {
  cut: { under: -0.15, over: 0.05 },
  maintain: { under: -0.1, over: 0.1 },
  bulk: { under: -0.05, over: 0.15 },
};
/** Beyond this deviation in either direction a day is "far off". */
export const FAR = 0.25;
/** Within this deviation no direction cap is shown: the day counts as on the target. */
export const DEAD_ZONE = 0.05;

export const NONE: Classification = { band: "none", direction: null, tooLow: false };

// a day exactly on a boundary (1,700 of 2,000 is −15 %) counts as inside it, whatever floating point says
const EPS = 1e-9;

function classify(kcal: number, target: number, goalKind: GoalKind, floor: number | null): Classification {
  const dev = kcal / target - 1;
  const range = ON_PLAN[goalKind];
  const band: Band =
    dev >= range.under - EPS && dev <= range.over + EPS ? "on" : Math.abs(dev) <= FAR + EPS ? "just" : "far";
  const direction: Direction = dev > DEAD_ZONE + EPS ? "over" : dev < -DEAD_ZONE - EPS ? "under" : null;
  const tooLow = (floor !== null && kcal < floor) || (goalKind === "cut" && dev < -FAR - EPS);
  return { band, direction, tooLow };
}

/** One day against the goal in force that day. Without a target there is nothing to classify. */
export function classifyDay({ kcal, target, goalKind, floor }: DayInput): Classification {
  if (target === null || target <= 0 || goalKind === null) return NONE;
  return classify(kcal, target, goalKind, floor);
}

export interface WeekClassification extends Classification {
  /** Days that counted: tracked, analysed, with a target. */
  days: number;
}

/**
 * A week as the mean of its days' kcal shares of their own targets (each day against the target
 * in force that day, so a goal change mid-week still averages cleanly), judged by the range of
 * the goal in force on the week's last counted day. Days without a target or totals are left
 * out; `days` says how many counted (the grid shows it when fewer than four).
 */
export function classifyWeek(days: (DayInput | null | undefined)[]): WeekClassification {
  const counted = days.filter(
    (d): d is DayInput => !!d && d.target !== null && d.target > 0 && d.goalKind !== null,
  );
  const last = counted.at(-1);
  if (!last || last.target === null || last.goalKind === null) return { ...NONE, days: 0 };
  const share = counted.reduce((sum, d) => sum + d.kcal / d.target!, 0) / counted.length;
  // the floor applies to the week's average kcal, in the last goal's terms
  const c = classify(share * last.target, last.target, last.goalKind, last.floor);
  return { ...c, days: counted.length };
}

/** "on plan from 15 % under to 5 % over" for the legend. */
export function rangeWords(goalKind: GoalKind): string {
  const r = ON_PLAN[goalKind];
  const pct = (x: number) => `${Math.round(Math.abs(x) * 100)} %`;
  return -r.under === r.over
    ? `on plan within ${pct(r.over)} of the kcal target`
    : `on plan from ${pct(r.under)} under to ${pct(r.over)} over the kcal target`;
}
