// The plan's reading on the phone (#40): what a day looks like, what is open before a dish, what
// "Ate it" will log. Pure: the screens and their tests share it. The numbers come from the server
// or from the shared `computeTotals`, never from anywhere else.
import {
  addDays,
  type Classification,
  classifyDay,
  computeTotals,
  dayInput,
  type MealSlot,
  type PlanDay,
  type PlannedMealView,
  planWords,
  portionItems,
  type Recipe,
  type RecipeItemView,
  scaleGrams,
  type Totals,
  UNCLASSIFIED,
} from "@yamt/shared";
import { dateStart } from "./format";

export const SLOT_NAME: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

/** The slots in a day's order. */
export const SLOTS: readonly MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

/** The plan view and the Plan-for sheet: today and the next six days. */
export const PLAN_DAYS = 7;

/** `today` and the days after it, `n` in all. */
export const nextDays = (today: string, n = PLAN_DAYS): string[] =>
  Array.from({ length: n }, (_, i) => addDays(today, i));

/** "chefkoch.de": the source's name, else its URL's host. */
export function sourceName(r: Pick<Recipe, "sourceName" | "sourceUrl">): string | null {
  if (r.sourceName) return r.sourceName;
  if (!r.sourceUrl) return null;
  try {
    return new URL(r.sourceUrl).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** "From chefkoch.de", "Adapted from chefkoch.de · 3 changes", "Composed for you". */
export function sourceLabel(r: Pick<Recipe, "sourceMode" | "sourceName" | "sourceUrl" | "changes">): string {
  const name = sourceName(r) ?? "a recipe";
  if (r.sourceMode === "published") return `From ${name}`;
  if (r.sourceMode === "adapted") {
    const n = r.changes.length;
    return `Adapted from ${name}${n ? ` · ${n} ${n === 1 ? "change" : "changes"}` : ""}`;
  }
  return "Composed for you";
}

/** How a plan day reads: the classifier's verdict once the day is mostly known, else "rest open". */
export interface DayReading {
  /** The projected kcal; null when nothing is eaten or planned. */
  kcal: number | null;
  c: Classification;
  /** "on plan, under", "1,940 kcal, no goal", "rest open", "nothing planned". */
  words: string;
  look: "plan" | "kcal" | "open" | "empty";
}

export function readDay(day: PlanDay): DayReading {
  const kcal = day.projected?.nutrients.energyKcal ?? null;
  if (kcal === null) return { kcal, c: UNCLASSIFIED, words: "nothing planned", look: "empty" };
  if (!day.mostlyKnown) return { kcal, c: UNCLASSIFIED, words: "rest open", look: "open" };
  const c = classifyDay(dayInput(kcal, day.goal));
  if (c.band !== "none") return { kcal, c, words: planWords(c), look: "plan" };
  return { kcal, c, words: day.goal ? "no kcal target" : "no goal", look: "kcal" };
}

/** The day's planned meals still to eat (not logged, not skipped). */
export const stillPlanned = (day: PlanDay | undefined): PlannedMealView[] =>
  day?.plannedMeals.filter((p) => p.status === "planned") ?? [];

/** "1 planned · 2 eaten · rest open" for a day's strip. */
export function dayMeta(day: PlanDay): string {
  const parts: string[] = [];
  const planned = stillPlanned(day).length;
  if (planned) parts.push(`${planned} planned`);
  if (day.meals.length) parts.push(`${day.meals.length} eaten`);
  if (planned || day.meals.length) parts.push(readDay(day).words);
  return parts.join(" · ");
}

/** A day "with" its planned meals, for the totals slab's note; null with nothing still planned. */
export function withPlanned(
  day: PlanDay | undefined,
): { planned: number; kcal: number; target: number | null; left: number | null } | null {
  const planned = stillPlanned(day).length;
  if (!day || !planned || !day.projected) return null;
  const kcal = day.projected.nutrients.energyKcal;
  const target = day.goal?.targets.energyKcal ?? null;
  return { planned, kcal, target, left: target === null ? null : Math.round(target - kcal) };
}

/** Ate it is offered for a planned meal of today or an earlier day, never ahead of time. */
export const canEat = (p: Pick<PlannedMealView, "date" | "status">, today: string): boolean =>
  p.status === "planned" && p.date <= today;

const MACROS = ["energyKcal", "protein", "fat", "carbohydrate", "fiber"] as const;
export type Macro = (typeof MACROS)[number];

/**
 * What its day holds besides this planned meal, and what that leaves open of each target: the
 * projection without it (a planned one counts in the projection, a logged one through its meal,
 * a skipped one not at all). `open` is null for a target the goal doesn't set (or without a goal).
 */
export function openBefore(
  day: PlanDay | undefined,
  planned: PlannedMealView,
): { base: Record<Macro, number>; open: Record<Macro, number | null> } {
  const projected = day?.projected?.nutrients;
  const own =
    planned.status === "planned"
      ? planned.eaten.nutrients
      : planned.status === "logged"
        ? (day?.meals.find((m) => m.plannedMealId === planned.id)?.totals?.nutrients ?? null)
        : null;
  const base = Object.fromEntries(
    MACROS.map((k) => [k, Math.max(0, (projected?.[k] ?? 0) - (own?.[k] ?? 0))]),
  ) as Record<Macro, number>;
  const targets = day?.goal?.targets;
  const open = Object.fromEntries(
    MACROS.map((k) => {
      const t = targets?.[k] ?? null;
      return [k, t === null ? null : t - base[k]];
    }),
  ) as Record<Macro, number | null>;
  return { base, open };
}

/**
 * What "Ate it" will log: the recipe's items for `portionEaten` portions, the switched-off ones
 * left out, totalled by the shared `computeTotals` (the server computes the same again on save).
 */
export function ateItTotals(
  recipe: Pick<Recipe, "servings">,
  items: readonly RecipeItemView[],
  portionEaten: number,
  without: ReadonlySet<string>,
): Totals {
  return computeTotals(portionItems(recipe, items, portionEaten, without));
}

/** An item's grams for `portions` portions of the recipe (the cook's amounts, "Ate it"'s rows). */
export const gramsFor = (
  recipe: Pick<Recipe, "servings">,
  item: Pick<RecipeItemView, "grams">,
  portions: number,
) => scaleGrams(item.grams, portions / recipe.servings);

/** When a planned meal was typically eaten, for logging one from an earlier day: the slot's hour. */
const SLOT_HOUR: Record<MealSlot, number> = { breakfast: 8, lunch: 12.5, dinner: 19, snack: 15.5 };

/** "Ate it"'s default time: now for today's meals, the slot's usual hour on an earlier day. */
export function defaultEatenAt(date: string, slot: MealSlot, now: number): number {
  if (now < dateStart(addDays(date, 1))) return now;
  return dateStart(date) + SLOT_HOUR[slot] * 3_600_000;
}

/** What already fills `slot` on `day` besides `exceptId`: titles of planned and eaten meals. */
export function slotTaken(day: PlanDay | undefined, slot: MealSlot, exceptId: string): string[] {
  if (!day) return [];
  const planned = day.plannedMeals
    .filter((p) => p.id !== exceptId && p.slot === slot && p.status === "planned")
    .map((p) => p.title);
  const eaten = day.meals
    .filter((m) => m.slot === slot && m.plannedMealId !== exceptId)
    .map((m) => m.title ?? "a meal not analysed yet");
  return [...planned, ...eaten];
}

/** A planned meal's portion presets, plus its own value when it is none of them. */
export function withValue(presets: readonly number[], value: number): number[] {
  return presets.includes(value) ? [...presets] : [...presets, value].sort((a, b) => a - b);
}
