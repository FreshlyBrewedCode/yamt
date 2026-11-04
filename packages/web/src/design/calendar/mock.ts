// Spike #31: made-up data for the calendar overview variants. Nothing here talks to the server.
// About two and a half months (1 Sept – 18 Nov 2026): untracked days, a few days with meals
// not analysed yet, a period without a goal, a cut starting mid-October (mid-week, from a
// Wednesday), days far under and over, a weight entry on most days. "Today" is fixed so the
// screens are reproducible. Round 2 pinned most days' kcal shares so every state of the plan
// encoding (plan.ts) shows up in the visible months: on-plan days under the target during the
// cut, a cut day far under (too low), weekends over during the cut, maintenance days slightly
// over and under, a week with only two tracked days, the goal change mid-week.
import {
  addDays,
  type Goal,
  type GoalKind,
  goalInForce,
  type NutrientTotals,
  type TargetKey,
  type Targets,
} from "@yamt/shared";
import { dateStart, localDate } from "@/lib/format";

export const TODAY = "2026-11-18";
/** The mock "now": 14:00 on the mock today (for day labels). */
export const NOW = dateStart(TODAY) + 14 * 3_600_000;
export const FIRST = "2026-09-01";

export type Nutrients = Record<TargetKey, number>;

export interface MockDay {
  date: string;
  /** Meals logged that day. */
  meals: number;
  /** Of those, not analysed yet (they count nothing). */
  pending: number;
  /** Totals of the analysed meals; null when nothing counts yet. */
  totals: Nutrients | null;
  weightKg: number | null;
}

export type MockGoal = Pick<Goal, "id" | "effectiveFrom" | "targets" | "note"> & {
  /** What `goalLabel` would say: the note, else the guided summary. */
  label: string;
  /** The guided derivation's choice (null for targets set by hand). */
  kind: GoalKind | null;
  /** The guided derivation's calorie floor (kcal/day), if any. */
  floorKcal: number | null;
};

export const goals: MockGoal[] = [
  {
    id: "goal-cut",
    effectiveFrom: "2026-10-14",
    note: "",
    label: "Cut, standard pace",
    kind: "cut",
    floorKcal: 1500,
    targets: { energyKcal: 2100, protein: 160, fat: 70, carbohydrate: 210, fiber: 30 },
  },
  {
    id: "goal-maintain",
    effectiveFrom: "2026-09-07",
    note: "",
    label: "Maintain",
    kind: "maintain",
    floorKcal: 1500,
    targets: { energyKcal: 2600, protein: 150, fat: 85, carbohydrate: 300, fiber: 30 },
  },
];

export const goalFor = (date: string): MockGoal | null => goalInForce(goals, date);

// mulberry32: a tiny seeded PRNG, so the data is the same on every load
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = rng(31);
const gauss = (mean: number, sd: number) => {
  const u = 1 - random();
  const v = random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Days with nothing logged: a few scattered ones, a long weekend away, a week with two tracked days (2–8 Nov). */
const UNTRACKED = new Set([
  "2026-09-04",
  "2026-09-13",
  "2026-09-20",
  "2026-10-03",
  "2026-10-04",
  "2026-10-05",
  "2026-11-02",
  "2026-11-03",
  "2026-11-04",
  "2026-11-06",
  "2026-11-08",
  "2026-11-14",
]);
/** Days with meals waiting for analysis (count: how many; the first number of meals total). */
const PENDING: Record<string, [meals: number, pending: number]> = {
  "2026-10-29": [3, 1],
  "2026-11-15": [1, 1],
  "2026-11-17": [4, 1],
  "2026-11-18": [2, 1],
};
/**
 * Pinned days: the kcal share of the target in force. Maintenance (±10 % on plan): slightly
 * under and over, a day far under the floor, just-off days both ways, far over. The cut from
 * Wed 14 Oct (−15 % … +5 % on plan): on-plan days under the target, weekends over, one day far
 * under (too low), just-off days both ways. The rest of the days come from the seeded noise.
 */
const SHARE: Record<string, number> = {
  // maintenance
  "2026-09-08": 0.93,
  "2026-09-10": 1.07,
  "2026-09-14": 0.42,
  "2026-09-17": 1.14,
  "2026-09-22": 0.86,
  "2026-09-26": 1.52,
  "2026-10-10": 1.38,
  "2026-10-12": 0.95,
  "2026-10-13": 1.08,
  // the cut
  "2026-10-14": 0.9,
  "2026-10-15": 0.87,
  "2026-10-16": 0.97,
  "2026-10-17": 1.14,
  "2026-10-18": 1.22,
  "2026-10-19": 0.92,
  "2026-10-20": 0.83,
  "2026-10-21": 0.6,
  "2026-10-22": 0.95,
  "2026-10-23": 1.03,
  "2026-10-24": 1.09,
  "2026-10-25": 1.31,
  "2026-10-26": 0.88,
  "2026-10-27": 0.94,
  "2026-10-28": 0.79,
  "2026-10-30": 1.0,
  "2026-10-31": 1.61,
  "2026-11-01": 1.12,
  "2026-11-05": 0.92,
  "2026-11-07": 1.16,
  "2026-11-09": 0.9,
  "2026-11-10": 0.38,
  "2026-11-11": 1.27,
  "2026-11-12": 0.93,
  "2026-11-13": 1.04,
  "2026-11-16": 0.89,
};

function buildDays(): Map<string, MockDay> {
  const days = new Map<string, MockDay>();
  let weight = 83.2;
  for (let d = FIRST; d <= TODAY; d = addDays(d, 1)) {
    const goal = goalFor(d);
    // the trend: slow loss, faster once the cut starts, with daily noise
    weight -= goal?.kind === "cut" ? 0.055 : 0.02;
    const weightKg = random() < 0.85 ? Math.round((weight + gauss(0, 0.35)) * 10) / 10 : null;
    if (UNTRACKED.has(d)) {
      days.set(d, { date: d, meals: 0, pending: 0, totals: null, weightKg });
      continue;
    }
    const [meals, pending] = PENDING[d] ?? [clamp(Math.round(gauss(3.2, 0.8)), 2, 5), 0];
    if (meals === pending) {
      days.set(d, { date: d, meals, pending, totals: null, weightKg });
      continue;
    }
    // without a goal the day still has numbers; scale them against what a goal would be
    const base = goal?.targets ?? { energyKcal: 2600, protein: 150, fat: 85, carbohydrate: 300, fiber: 30 };
    const share = SHARE[d] ?? clamp(gauss(0.94, 0.16), 0.5, 1.4);
    // today: lunch still waiting, so the counted part is small
    const counted = d === TODAY ? 0.46 : pending > 0 ? share * (1 - pending / meals) : share;
    const kcal = base.energyKcal! * counted;
    const protein = clamp(gauss(0.92, 0.18), 0.4, 1.5) * base.protein! * (counted / share);
    const fiber = clamp(gauss(0.72, 0.28), 0.2, 1.4) * base.fiber! * (counted / share);
    const fat = clamp(gauss(1.0, 0.2), 0.4, 1.8) * base.fat! * counted;
    // carbs take what the kcal leave after protein and fat
    const carbohydrate = Math.max(40, (kcal - protein * 4 - fat * 9 - fiber * 2) / 4);
    days.set(d, {
      date: d,
      meals,
      pending,
      weightKg,
      totals: {
        energyKcal: Math.round(kcal),
        protein: Math.round(protein),
        fat: Math.round(fat),
        carbohydrate: Math.round(carbohydrate),
        fiber: Math.round(fiber),
      },
    });
  }
  return days;
}

export const days: Map<string, MockDay> = buildDays();

export const dayOf = (date: string): MockDay | undefined => days.get(date);

/** The day's numbers in the shape the totals slab takes (the nutrients it doesn't show as 0). */
export const asTotals = (n: Nutrients): NutrientTotals => ({
  grams: 0,
  items: 0,
  nutrients: { ...n, saturatedFat: 0, sugars: 0, salt: 0 },
});

/** The kcal share of the target in force: 0.95 = 95 % of it; null without a target or totals. */
export function kcalShare(day: MockDay | undefined): number | null {
  const target = day && goalFor(day.date)?.targets.energyKcal;
  if (!day?.totals || !target) return null;
  return day.totals.energyKcal / target;
}

export const TARGET_ORDER: readonly TargetKey[] = ["energyKcal", "protein", "fat", "carbohydrate", "fiber"];

/** Each target's share (value / target), in `TARGET_ORDER`; null where there is no target. */
export function shares(day: MockDay | undefined): (number | null)[] {
  const targets = day && goalFor(day.date)?.targets;
  return TARGET_ORDER.map((k) => {
    const t = targets?.[k];
    return day?.totals && t ? day.totals[k] / t : null;
  });
}

// ---- months and weeks ----

const monthLong = new Intl.DateTimeFormat("en-GB", { month: "long" });
const monthShort = new Intl.DateTimeFormat("en-GB", { month: "short" });

/** `YYYY-MM` of a date. */
export const monthOf = (date: string): string => date.slice(0, 7);
export const monthStart = (month: string): string => `${month}-01`;
export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return localDate(new Date(y!, m!, 0).getTime());
}
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y!, m! - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export const monthName = (month: string): string => monthLong.format(dateStart(monthStart(month)));
export const monthShortName = (month: string): string => monthShort.format(dateStart(monthStart(month)));
export const yearOf = (month: string): string => month.slice(0, 4);

export const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

/** Monday-first weeks of a month: 7 dates each, including the neighbouring months' days that pad
 * the first and last week (`inMonth` tells them apart). */
export function monthWeeks(month: string): string[][] {
  const first = monthStart(month);
  const last = monthEnd(month);
  const lead = (new Date(dateStart(first)).getDay() + 6) % 7;
  const cells: string[] = [];
  for (let d = addDays(first, -lead); d <= last || cells.length % 7; d = addDays(d, 1)) cells.push(d);
  const weeks: string[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
export const inMonth = (date: string, month: string): boolean => date.startsWith(month);

export interface MonthSummary {
  /** Days of the month up to today. */
  daysSoFar: number;
  tracked: number;
  pending: number;
  /** Mean kcal of the days with totals, and the mean of their shares of the target in force. */
  avgKcal: number | null;
  avgKcalShare: number | null;
  avgProtein: number | null;
  avgProteinShare: number | null;
  /** The 7-day weight average at the start and the end of the month's tracked range. */
  weightFrom: number | null;
  weightTo: number | null;
  /** Macro targets in force at the end of the range (for "/160"). */
  targets: Targets | null;
}

/** The 7-day moving average of the weight ending on `date`. */
export function weightAvg(date: string): number | null {
  const kgs: number[] = [];
  for (let i = 0; i < 7; i++) {
    const w = days.get(addDays(date, -i))?.weightKg;
    if (w != null) kgs.push(w);
  }
  return kgs.length >= 3 ? Math.round((kgs.reduce((a, b) => a + b, 0) / kgs.length) * 10) / 10 : null;
}

/** The last day of the month that is shown: today in the current month. */
export const lastShown = (month: string): string => (monthEnd(month) < TODAY ? monthEnd(month) : TODAY);

export function monthSummary(month: string): MonthSummary {
  const last = lastShown(month);
  const list: MockDay[] = [];
  for (let d = monthStart(month); d <= last; d = addDays(d, 1)) {
    const day = days.get(d);
    if (day) list.push(day);
  }
  const withTotals = list.filter((d) => d.totals);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const kcalShares = withTotals.map(kcalShare).filter((s): s is number => s !== null);
  const proteinShares = withTotals.map((d) => shares(d)[1]).filter((s): s is number => s != null);
  return {
    daysSoFar: list.length,
    tracked: list.filter((d) => d.meals > 0).length,
    pending: list.filter((d) => d.pending > 0).length,
    avgKcal: mean(withTotals.map((d) => d.totals!.energyKcal)),
    avgKcalShare: mean(kcalShares),
    avgProtein: mean(withTotals.map((d) => d.totals!.protein)),
    avgProteinShare: mean(proteinShares),
    weightFrom: weightAvg(addDays(monthStart(month), 6)),
    weightTo: weightAvg(last),
    targets: goalFor(last)?.targets ?? null,
  };
}

/** The first and last month with data (navigation stops there). */
export const FIRST_MONTH = monthOf(FIRST);
export const LAST_MONTH = monthOf(TODAY);
