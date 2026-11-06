import {
  type MealSlot,
  type NutrientTotals,
  type PlanDay,
  roundNutrient,
  TARGET_KEYS,
  type TargetKey,
  type Targets,
} from "@yamt/shared";

/**
 * A main meal's portion takes at most this share of the day's target, per nutrient (spike #38:
 * the biggest quality problem was portions sized to everything still open, 300–380 g of fish or
 * a 1.47 kg risotto for one dinner).
 */
export const MAIN_MEAL_MAX_SHARE = 0.42;
/** Kept free for a snack while none is eaten or planned that day. */
export const SNACK_RESERVE_SHARE = 0.1;
/** A snack takes at most this share of the day's target. */
export const SNACK_MAX_SHARE = 0.15;
/** How what is open is shared between the day's main slots still open. */
export const SLOT_WEIGHTS: Record<Exclude<MealSlot, "snack">, number> = {
  breakfast: 25,
  lunch: 35,
  dinner: 35,
};

const MAIN: readonly MealSlot[] = ["breakfast", "lunch", "dinner"];

export type PerTarget = Record<TargetKey, number | null>;

/** One requested slot's ceiling, computed from the day's projection and its goal. */
export interface SlotBudget {
  date: string;
  slot: MealSlot;
  /** The day's targets; null without a goal (then there is no budget either). */
  targets: Targets | null;
  /** Target − projected (eaten + planned), never below 0; null per key without a target. */
  openForTheDay: PerTarget;
  /** The main slots still open that day, this one included (they share what is open). */
  sharedWith: MealSlot[];
  /** Whether room for a snack was kept (no snack eaten or planned that day yet). */
  snackRoomKept: boolean;
  /**
   * What one portion should stay within: its share of what is open, capped at
   * `MAIN_MEAL_MAX_SHARE` (snacks `SNACK_MAX_SHARE`) of the day's target. A ceiling, not a
   * target: kcal, fat and carbohydrate should stay below it; protein and fibre are its share to
   * aim for, within what a normal plate carries.
   */
  budget: PerTarget;
}

const nulls = (): PerTarget => Object.fromEntries(TARGET_KEYS.map((k) => [k, null])) as PerTarget;

/**
 * The slot budget of `slot` on `day` (#45): what is open (target − projection) after keeping room
 * for a snack, shared by weight between the main slots still open (this one included), and capped
 * at a share of the day's target, so one meal never takes everything a nearly empty day has left.
 */
export function slotBudget(day: PlanDay, slot: MealSlot): SlotBudget {
  const targets = day.goal?.targets ?? null;
  const projected = day.projected?.nutrients ?? null;
  const snackTaken =
    day.meals.some((m) => m.slot === "snack") ||
    day.plannedMeals.some((p) => p.slot === "snack" && p.status === "planned");
  const sharedWith = MAIN.filter((s) => s === slot || day.openSlots.includes(s));
  const isMain = slot !== "snack";
  const snackRoomKept = isMain && !snackTaken;
  const weight = (s: MealSlot) => SLOT_WEIGHTS[s as keyof typeof SLOT_WEIGHTS] ?? 0;
  const share = isMain ? weight(slot) / sharedWith.reduce((a, s) => a + weight(s), 0) : 1;

  const open = nulls();
  const budget = nulls();
  if (targets) {
    for (const k of TARGET_KEYS) {
      const target = targets[k];
      if (target === null) continue;
      const left = Math.max(0, target - (projected?.[k] ?? 0));
      open[k] = roundNutrient(k, left);
      const avail = Math.max(0, left - (snackRoomKept ? target * SNACK_RESERVE_SHARE : 0));
      const cap = target * (isMain ? MAIN_MEAL_MAX_SHARE : SNACK_MAX_SHARE);
      budget[k] = roundNutrient(k, Math.min(avail * share, cap));
    }
  }
  return {
    date: day.date,
    slot,
    targets,
    openForTheDay: open,
    sharedWith: isMain ? sharedWith : [],
    snackRoomKept,
    budget,
  };
}

/** One portion against a slot's budget, per target: the portion, the budget, portion − budget. */
export function fitToSlot(
  portion: NutrientTotals["nutrients"],
  b: SlotBudget,
): Record<TargetKey, { portion: number; budget: number | null; diff: number | null }> {
  return Object.fromEntries(
    TARGET_KEYS.map((k) => {
      const budget = b.budget[k];
      const p = portion[k];
      return [k, { portion: p, budget, diff: budget === null ? null : roundNutrient(k, p - budget) }];
    }),
  ) as ReturnType<typeof fitToSlot>;
}

/** What the day has open after one portion (target − projection − portion); null without a target. */
export function openAfter(portion: NutrientTotals["nutrients"], b: SlotBudget): PerTarget {
  return Object.fromEntries(
    TARGET_KEYS.map((k) => {
      const open = b.openForTheDay[k];
      return [k, open === null ? null : roundNutrient(k, open - portion[k])];
    }),
  ) as PerTarget;
}
