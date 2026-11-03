import {
  type CreateGoalBody,
  type DayResponse,
  dayProgress,
  type FixGoalBody,
  type Goal,
  type Targets,
} from "@yamt/shared";
import type { Repos } from "../db/repos/index.ts";
import { HttpError } from "./errors.ts";
import type { MealService } from "./meals.ts";
import { nutrientTotals } from "./meals.ts";
import { totalsOf } from "./revisions.ts";
import { assertTimeZone, dayRange, localDate } from "./time.ts";

/** A zone from a request, or 400. */
export function requestZone(tz: string | undefined, fallback: string): string {
  const zone = tz ?? fallback;
  try {
    assertTimeZone(zone);
  } catch {
    throw new HttpError(400, `tz: unknown time zone ${zone}`, "an IANA zone like Europe/Berlin");
  }
  return zone;
}

const targetsOf = (b: FixGoalBody): Targets => ({
  energyKcal: b.energyKcal,
  protein: b.protein,
  fat: b.fat,
  carbohydrate: b.carbohydrate,
  fiber: b.fiber,
});

/**
 * Daily goals (#12) and the day view built on them. Dates are local calendar dates in the
 * caller's zone (the phone's), the same reckoning as the overview's day totals.
 */
export class GoalService {
  constructor(
    private readonly repos: Repos,
    private readonly meals: MealService,
    /** The server's zone: the default for "today". */
    private readonly timeZone: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** New targets from a date (default today): a new row; earlier goals stay as they were. */
  create(body: CreateGoalBody): Goal {
    return this.repos.goals.insert({
      effectiveFrom: body.effectiveFrom ?? localDate(this.now(), this.timeZone),
      targets: targetsOf(body),
      note: body.note,
      now: this.now(),
    });
  }

  /** A typo fix of the latest goal, in place. Older goals are history (409). */
  fix(id: string, body: FixGoalBody): Goal {
    const goal = this.repos.goals.get(id);
    if (!goal) throw new HttpError(404, "goal not found");
    if (this.repos.goals.latest()?.id !== id) {
      throw new HttpError(
        409,
        "only the latest goal can be fixed",
        "set new targets instead: older goals are history",
      );
    }
    return this.repos.goals.fix(id, { targets: targetsOf(body), note: body.note, now: this.now() })!;
  }

  list(): Goal[] {
    return this.repos.goals.list();
  }

  /** The goal in force on `date` (default today in the zone). */
  current(q: { date?: string; tz?: string }): { date: string; goal: Goal | null } {
    const date = q.date ?? localDate(this.now(), requestZone(q.tz, this.timeZone));
    return { date, goal: this.repos.goals.inForce(date) };
  }

  /**
   * A calendar day: its meals as the overview lists them, their totals (unanalysed meals listed
   * but not counted), the goal in force, the progress against it and the weight measured that day.
   */
  day(date: string, tz?: string): DayResponse {
    const timeZone = requestZone(tz, this.timeZone);
    let range: { from: number; to: number };
    try {
      range = dayRange(date, timeZone);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const list = this.meals.list({ ...range, tz: timeZone, limit: 500 });
    const totals = list.days.find((d) => d.date === date)?.totals ?? nutrientTotals(totalsOf([]));
    const goal = this.repos.goals.inForce(date);
    return {
      date,
      timeZone,
      ...range,
      meals: list.meals,
      totals,
      // empty drafts (nothing captured) are no meal yet, as in the overview
      unanalysed: list.meals.filter((m) => m.currentRevisionId === null && m.captureCount > 0).length,
      goal,
      progress: dayProgress(totals.nutrients, goal?.targets ?? null),
      weight: this.repos.weight.list({ ...range, limit: 100 }),
    };
  }
}
