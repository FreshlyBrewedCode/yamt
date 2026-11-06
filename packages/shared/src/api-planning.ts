import { z } from "zod";
import type { PlanGoal } from "./api-calendar.ts";
import type { Meal } from "./api-meals.ts";
import type {
  Confidence,
  CoreNutrient,
  FoodSource,
  MealRevisionView,
  Nutrients,
  NutrientTotals,
  Provenance,
  Totals,
} from "./api-nutrition.ts";

/**
 * Meal planning (#36, ADR 0003): recipes with items matched to foods (insert-only, per-100 g
 * snapshots like meal items), planned meals on days, the plan (each day eaten + planned against
 * its goal) and "Ate it" (a planned meal logged as a meal without a model). The calendar's
 * classifier stays in `plan.ts`; the web app classifies a projected day with it.
 */

export const planningPaths = {
  /** GET the plan (`PlanQuery`): days with planned meals, eaten and projected totals, goals. */
  plan: "/api/plan",
  /** GET a recipe (`RecipeView`). */
  recipe: (id: string) => `/api/recipes/${id}`,
  /** POST a planned meal (`CreatePlannedMealBody`). */
  plannedMeals: "/api/planned-meals",
  /** PATCH (`UpdatePlannedMealBody`) or DELETE (unplan) a planned meal; only while `planned`. */
  plannedMeal: (id: string) => `/api/planned-meals/${id}`,
  /** POST: the planned meal won't be eaten (`skipped`); idempotent. */
  skip: (id: string) => `/api/planned-meals/${id}/skip`,
  /** POST: undoes a skip (back to `planned`); idempotent. */
  unskip: (id: string) => `/api/planned-meals/${id}/unskip`,
  /** POST "Ate it" (`LogPlannedMealBody`): a new meal from the planned meal's recipe. */
  log: (id: string) => `/api/planned-meals/${id}/log`,
} as const;

/** `published`: as published; `adapted`: based on a real recipe, changes listed; `composed`: the agent's own. */
export const RecipeSourceMode = z.enum(["published", "adapted", "composed"]);
export type RecipeSourceMode = z.infer<typeof RecipeSourceMode>;

export const MealSlot = z.enum(["breakfast", "lunch", "dinner", "snack"]);
export type MealSlot = z.infer<typeof MealSlot>;

/** The slots a day needs eaten or planned to be mostly known (snacks are optional). */
export const MAIN_SLOTS = ["breakfast", "lunch", "dinner"] as const satisfies readonly MealSlot[];

/** `planned` → `logged` ("Ate it") | `skipped` (and back, `unskip`). */
export const PlannedMealStatus = z.enum(["planned", "logged", "skipped"]);
export type PlannedMealStatus = z.infer<typeof PlannedMealStatus>;

/** A plan covers at most this many days per request. */
export const MAX_PLAN_DAYS = 31;

/**
 * An eaten meal without a planned meal has no slot: it takes the one its local time falls in
 * (from these hours on; before breakfast it is a late snack), unless it is analysed and smaller
 * than `SNACK_KCAL`, which makes it a snack (a coffee at four doesn't make dinner known).
 */
export const SLOT_HOURS = { breakfast: 4, lunch: 11, dinner: 16 } as const;
export const SNACK_KCAL = 150;

/** The slot an eaten meal fills, from its local hour and its kcal (null: not analysed yet). */
export function slotOf(hour: number, kcal: number | null): MealSlot {
  if (kcal !== null && kcal < SNACK_KCAL) return "snack";
  if (hour < SLOT_HOURS.breakfast) return "snack";
  if (hour < SLOT_HOURS.lunch) return "breakfast";
  if (hour < SLOT_HOURS.dinner) return "lunch";
  return "dinner";
}

export interface Recipe {
  id: string;
  title: string;
  /** One line. */
  summary: string;
  sourceMode: RecipeSourceMode;
  sourceUrl: string | null;
  /** "chefkoch.de". */
  sourceName: string | null;
  /** What an adapted recipe changed ("Sahne → Kokosmilch light"); empty otherwise. */
  changes: string[];
  /** The portions the item grams are for. */
  servings: number;
  timeActiveMin: number | null;
  timeTotalMin: number | null;
  steps: string[];
  notes: string | null;
  createdAt: number;
}

export interface RecipeItem {
  id: string;
  recipeId: string;
  position: number;
  /** Null for a pure estimate. */
  foodId: string | null;
  /** As written: "½ Hokkaido (ca. 500 g)". */
  description: string;
  /** For the whole recipe (its `servings`). */
  grams: number;
  provenance: Provenance;
  confidence: Confidence;
  note: string | null;
  /** "Feta, optional". */
  optional: boolean;
  /** The food's core numbers when the recipe was saved (or the estimate). */
  per100g: Nutrients;
}

export interface RecipeItemView extends RecipeItem {
  food: { id: string; source: FoodSource; name: string; brand: string | null } | null;
  /** This item's share of the whole recipe (per100g × grams / 100, rounded). */
  nutrients: Record<CoreNutrient, number | null>;
  /** One portion: grams ÷ servings (to 0.01 g, as "Ate it" logs it). */
  portionGrams: number;
  portionNutrients: Record<CoreNutrient, number | null>;
}

/** `GET /api/recipes/:id`: the recipe, its items for the whole recipe and per portion, and both totals. */
export interface RecipeView {
  recipe: Recipe;
  items: RecipeItemView[];
  /** One portion's totals (`computeTotals`). */
  perPortion: Totals;
  /** The whole recipe's. */
  whole: Totals;
}

export interface PlannedMeal {
  id: string;
  /** The local calendar date (`YYYY-MM-DD`). */
  date: string;
  slot: MealSlot;
  /** 0, 1, … within the date's slot. */
  position: number;
  recipeId: string;
  /** The recipe's title. */
  title: string;
  /** Portions cooked (the shopping list's amount). */
  portionsCooked: number;
  /** A factor of one portion: what is eaten. */
  portionEaten: number;
  status: PlannedMealStatus;
  /** The meal "Ate it" logged; null unless `logged`. */
  loggedMealId: string | null;
  /** The planned meal whose extra cooked portion this is (leftovers, #36 wave 2); null. */
  leftoverOf: string | null;
  /** The suggestion it was picked from (#36, subtask 5 on); null. */
  suggestionId: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

/** A planned meal with its computed numbers. */
export interface PlannedMealView extends PlannedMeal {
  /** One portion of the recipe. */
  perPortion: NutrientTotals;
  /** One portion × `portionEaten`: what the plan counts and "Ate it" logs (all items). */
  eaten: NutrientTotals;
}

/** A meal eaten on a plan day (removed ones are left out), with the slot it fills. */
export interface PlanMeal {
  mealId: string;
  /** The current revision's title; null before the first analysis. */
  title: string | null;
  eatenAt: number;
  /** Its planned meal's slot when logged from the plan, else from its time and size (`slotOf`). */
  slot: MealSlot;
  /** Null until it is analysed. */
  totals: NutrientTotals | null;
  /** The planned meal it was logged from ("Ate it"); null for a meal of its own. */
  plannedMealId: string | null;
}

export interface PlanDay {
  /** `YYYY-MM-DD` in the zone. */
  date: string;
  /** By slot (breakfast, lunch, dinner, snack), then position; every status. */
  plannedMeals: PlannedMealView[];
  /** Meals eaten that day (a draft with nothing captured is no meal yet). */
  meals: PlanMeal[];
  /** Of those, the ones without an analysis yet: they count nothing. */
  unanalysed: number;
  /** Over the analysed meals' current revisions (as the day view counts); null when none counts. */
  eaten: NutrientTotals | null;
  /** Eaten + the planned meals still `planned` (their `eaten`); null when there is neither. */
  projected: NutrientTotals | null;
  goal: PlanGoal | null;
  /** Main slots with nothing eaten or planned (skipped ones don't count). */
  openSlots: MealSlot[];
  /**
   * A past day, or one with every main slot eaten or planned: only then does the web app classify
   * `projected` (`dayInput`, `classifyDay`); before that the day is "rest open".
   */
  mostlyKnown: boolean;
}

/** `GET /api/plan?from&to&tz`: the days from `from` to `to` (inclusive, at most `MAX_PLAN_DAYS`). */
export const PlanQuery = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  tz: z.string().min(1).max(64).optional(),
});
export type PlanQuery = z.infer<typeof PlanQuery>;

export interface PlanResponse {
  from: string;
  to: string;
  timeZone: string;
  /** Today in the zone: earlier days are past. */
  today: string;
  days: PlanDay[];
}

const clientId = z.uuid().optional();
const portionsCooked = z.number().int().min(1).max(20);
const portionEaten = z.number().min(0.1).max(10);
const note = z.string().trim().max(1_000);

/**
 * `POST /api/planned-meals`: a recipe onto a date's slot, at its end. With an `id` it is idempotent:
 * 201 the first time, 200 with the stored one after (an id of a planned meal of another recipe is a
 * 409). Portions default to 1 cooked, 1 eaten.
 */
export const CreatePlannedMealBody = z
  .object({
    id: clientId,
    recipeId: z.uuid(),
    date: z.iso.date(),
    slot: MealSlot,
    portionsCooked: portionsCooked.optional(),
    portionEaten: portionEaten.optional(),
    note: note.optional(),
  })
  .strict();
export type CreatePlannedMealBody = z.infer<typeof CreatePlannedMealBody>;

/**
 * `PATCH /api/planned-meals/:id`: move it (a new date or slot puts it at the slot's end unless
 * `position` says where), reorder it within its slot, change portions or the note. Only while
 * `planned` (409 otherwise).
 */
export const UpdatePlannedMealBody = z
  .object({
    date: z.iso.date().optional(),
    slot: MealSlot.optional(),
    position: z.number().int().min(0).max(100).optional(),
    portionsCooked: portionsCooked.optional(),
    portionEaten: portionEaten.optional(),
    note: note.nullable().optional(),
  })
  .strict();
export type UpdatePlannedMealBody = z.infer<typeof UpdatePlannedMealBody>;

/**
 * `POST /api/planned-meals/:id/log` ("Ate it"): a new meal at `eatenAt` (pinned) whose revision 1
 * (kind `plan`, no run) holds the recipe's items but the excluded ones, grams = one portion ×
 * `portionEaten` (default: the planned meal's). The planned meal becomes `logged`. With an `id` (the
 * new meal's) it is idempotent: 201 the first time, 200 with the stored meal after.
 */
export const LogPlannedMealBody = z
  .object({
    id: clientId,
    eatenAt: z.number().int().nonnegative(),
    portionEaten: portionEaten.optional(),
    excludeItemIds: z.array(z.uuid()).max(100).default([]),
  })
  .strict();
export type LogPlannedMealBody = z.infer<typeof LogPlannedMealBody>;

export interface PlannedMealResponse {
  plannedMeal: PlannedMealView;
}

/** "Ate it": the planned meal (now `logged`), the new meal and its one revision. */
export interface LogPlannedMealResponse {
  plannedMeal: PlannedMealView;
  meal: Meal;
  revision: MealRevisionView;
}
