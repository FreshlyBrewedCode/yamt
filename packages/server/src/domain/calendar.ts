import {
  addDays,
  dailyWeights,
  dayInput,
  type Goal,
  goalInForce,
  goalPlan,
  type MealItem,
  type MonthDay,
  type MonthResponse,
  type MonthSummary,
  type MonthWeek,
  monthDays,
  type PlanGoal,
  weekdayIndex,
} from "@yamt/shared";
import type { Repos } from "../db/repos/index.ts";
import { requestZone } from "./goals.ts";
import { nutrientTotals } from "./meals.ts";
import { totalsOf } from "./revisions.ts";
import { dayRange, localDate } from "./time.ts";

const mean = (xs: readonly number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
/** Rounded to `digits` decimals. */
const round = (n: number | null, digits = 0): number | null =>
  n === null ? null : Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * The calendar (#33): a month of the phone's calendar days, each with what the day view counts
 * (analysed meals through `computeTotals`, meals without an analysis listed but not counted) and
 * the goal in force as the classifier reads it (`goalPlan`). One pass per month: the meals, the
 * current revisions' items, the weight entries, the goals and the profile, each read once.
 */
export class CalendarService {
  constructor(
    private readonly repos: Repos,
    /** The server's zone: the default for the days. */
    private readonly timeZone: string,
    private readonly now: () => number = Date.now,
  ) {}

  month(month: string, tz?: string): MonthResponse {
    const timeZone = requestZone(tz, this.timeZone);
    const first = `${month}-01`;
    const last = `${month}-${String(monthDays(month)).padStart(2, "0")}`;
    // the grid: Monday before the 1st to the Sunday after the last day, so weeks are whole
    const gridStart = addDays(first, -weekdayIndex(first));
    const gridEnd = addDays(last, 6 - weekdayIndex(last));
    const from = dayRange(gridStart, timeZone).from;
    const to = dayRange(gridEnd, timeZone).to;
    const today = localDate(this.now(), timeZone);

    // meals and the items of their current revisions, by local day
    const tally = new Map<
      string,
      { meals: number; unanalysed: number; analysed: number; items: MealItem[] }
    >();
    const dayOf = (date: string) => {
      let d = tally.get(date);
      if (!d) {
        d = { meals: 0, unanalysed: 0, analysed: 0, items: [] };
        tally.set(date, d);
      }
      return d;
    };
    const mealDate = new Map<string, string>();
    for (const m of this.repos.meals.tallyBetween(from, to)) {
      // a draft with nothing captured is no meal yet (as in the overview); a copy has no captures but a revision
      if (m.currentRevisionId === null && m.captures === 0) continue;
      const date = localDate(m.eatenAt, timeZone);
      mealDate.set(m.id, date);
      const d = dayOf(date);
      d.meals++;
      if (m.currentRevisionId === null) d.unanalysed++;
      else d.analysed++;
    }
    for (const { mealId, item } of this.repos.revisions.currentItemsBetween(from, to)) {
      const date = mealDate.get(mealId);
      if (date) dayOf(date).items.push(item);
    }

    // the goal in force per day, read once per goal
    const goals = this.repos.goals.list();
    const sex = this.repos.profile.get()?.sex ?? null;
    const plans = new Map<string, PlanGoal>();
    const planOf = (g: Goal): PlanGoal => {
      let p = plans.get(g.id);
      if (!p) {
        p = { id: g.id, effectiveFrom: g.effectiveFrom, targets: g.targets, ...goalPlan(g, sex) };
        plans.set(g.id, p);
      }
      return p;
    };
    const goalOn = (date: string): PlanGoal | null => {
      const g = goalInForce(goals, date);
      return g ? planOf(g) : null;
    };

    // weight: a week before the 1st on, so the 7-day average is whole from the start
    const weighings = new Map<string, number[]>();
    for (const w of this.repos.weight.list({
      from: dayRange(addDays(first, -6), timeZone).from,
      to,
      limit: 5_000,
    })) {
      const date = localDate(w.measuredAt, timeZone);
      weighings.set(date, [...(weighings.get(date) ?? []), w.kg]);
    }
    const weights = new Map(dailyWeights(weighings).map((w) => [w.date, w]));

    const record = (date: string): MonthDay => {
      const t = tally.get(date);
      return {
        date,
        meals: t?.meals ?? 0,
        unanalysed: t?.unanalysed ?? 0,
        totals: t?.analysed ? nutrientTotals(totalsOf(t.items)) : null,
        goal: goalOn(date),
        weightKg: weights.get(date)?.kg ?? null,
      };
    };

    const grid = new Map<string, MonthDay>();
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) grid.set(d, record(d));
    const days = [...grid.values()].filter((d) => d.date >= first && d.date <= last);

    const weeks: MonthWeek[] = [];
    for (let start = gridStart; start <= gridEnd; start = addDays(start, 7)) {
      const week: MonthWeek = { start, days: [] };
      for (let i = 0; i < 7; i++) {
        const d = grid.get(addDays(start, i))!;
        week.days.push(d.date > today ? null : dayInput(d.totals?.nutrients.energyKcal ?? null, d.goal));
      }
      weeks.push(week);
    }

    const soFar = days.filter((d) => d.date <= today);
    const counted = soFar.filter((d) => d.totals !== null);
    const shares = counted.flatMap((d) => {
      const target = d.goal?.targets.energyKcal;
      return target ? [d.totals!.nutrients.energyKcal / target] : [];
    });
    const summary: MonthSummary = {
      days: soFar.length,
      tracked: soFar.filter((d) => d.meals > 0).length,
      avgKcal: round(mean(counted.map((d) => d.totals!.nutrients.energyKcal))),
      kcalShare: round(mean(shares), 3),
      avgProtein: round(mean(counted.map((d) => d.totals!.nutrients.protein)), 1),
      goal: soFar.at(-1)?.goal ?? null,
    };

    return {
      month,
      timeZone,
      today,
      days,
      weeks,
      summary,
      weight: [...weights.values()].filter((w) => w.date >= first && w.date <= last && w.date <= today),
    };
  }
}
