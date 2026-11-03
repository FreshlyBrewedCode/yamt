import {
  ALGORITHM_VERSION,
  type CreateGoalBody,
  calculateGoal,
  type DayResponse,
  dayProgress,
  type FixGoalBody,
  type Goal,
  type GoalDerivation,
  type GoalInputs,
  type GuidedGoalBody,
  goalWeight,
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

  /**
   * A guided goal (#24): logs the weight given (if any), takes the weight from the log, runs
   * `calculateGoal` on the server (never the client's numbers), saves the profile and adds a goal
   * from today with its derivation. All or nothing: a refusal (422) logs and saves nothing.
   */
  guided(body: GuidedGoalBody): Goal {
    const now = this.now();
    const today = body.effectiveFrom ?? localDate(now, this.timeZone);
    return this.repos.db.transaction(() => {
      if (body.weightKg !== undefined) {
        this.repos.weight.insert({ measuredAt: now, kg: body.weightKg, note: "", now });
      }
      // a week's entries are a few dozen at most; 200 is plenty for "the last 7 days"
      const weight = goalWeight(this.repos.weight.list({ to: now + 1, limit: 200 }), now);
      if (!weight) throw new HttpError(400, "weightKg: no weight logged yet", "send weightKg to log one");
      const inputs: GoalInputs = {
        ...body.profile,
        weightKg: weight.kg,
        today,
        pregnantOrBreastfeeding: body.pregnantOrBreastfeeding,
      };
      const result = calculateGoal(inputs, body.choices);
      if (!result.ok) throw new HttpError(422, result.message, result.reason);
      this.repos.profile.put(body.profile, now);
      const derivation: GoalDerivation = {
        version: ALGORITHM_VERSION,
        inputs,
        choices: body.choices,
        weight,
        result,
      };
      return this.repos.goals.insert({
        effectiveFrom: today,
        targets: result.targets,
        note: "",
        derivation,
        now,
      });
    })();
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
