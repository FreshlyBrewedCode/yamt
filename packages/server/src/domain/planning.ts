import {
  addDays,
  type CreatePlannedMealBody,
  type LogPlannedMealBody,
  type LogPlannedMealResponse,
  MAIN_SLOTS,
  MAX_PLAN_DAYS,
  type MealItem,
  type MealSlot,
  type PlanDay,
  type PlanMeal,
  type PlannedMeal,
  type PlannedMealView,
  type PlanQuery,
  type PlanResponse,
  portionItems,
  type Recipe,
  type RecipeItem,
  slotOf,
  type UpdatePlannedMealBody,
} from "@yamt/shared";
import type { Repos } from "../db/repos/index.ts";
import { computeTotals, type TotalsItem } from "../nutrition/totals.ts";
import { goalsByDate } from "./calendar.ts";
import { HttpError } from "./errors.ts";
import { requestZone } from "./goals.ts";
import { CLOCK_SKEW_MS, nutrientTotals } from "./meals.ts";
import { recipeTotals } from "./recipes.ts";
import type { RevisionService } from "./revisions.ts";
import { dayRange, localDate, localHour } from "./time.ts";

const asTotalsItem = (i: MealItem | RecipeItem): TotalsItem => ({
  grams: i.grams,
  per100g: i.per100g,
  provenance: i.provenance,
});

interface RecipeData {
  recipe: Recipe;
  items: RecipeItem[];
}

const dataOf = (recipes: Map<string, RecipeData>, p: PlannedMeal): RecipeData => {
  const d = recipes.get(p.recipeId);
  if (!d) throw new Error(`planned meal ${p.id} names a missing recipe ${p.recipeId}`);
  return d;
};

/** 1, 0.5, 1.25: a portion count as the assumption line says it. */
const amount = (n: number) => String(Math.round(n * 100) / 100);

/** "A", "A and B", "A, B and C". */
const list = (xs: readonly string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

/**
 * Planned meals and the plan (#36, ADR 0003): a recipe on a date's slot with portions, moved,
 * skipped or unplanned while `planned`, and logged with "Ate it" (a new meal whose revision of
 * kind `plan` holds the recipe's items for the portion eaten, like Log again: no run, no model).
 * The plan reads days like the calendar: eaten (analysed meals) + planned, against the goal.
 */
export class PlanningService {
  constructor(
    private readonly repos: Repos,
    private readonly revisions: RevisionService,
    /** The server's zone: the default for the days. */
    private readonly timeZone: string,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * A recipe onto a date's slot, at its end. Idempotent with a client `id`: the stored one is
   * answered (`created: false`); an id of a planned meal of another recipe is a 409.
   */
  create(body: CreatePlannedMealBody): { plannedMeal: PlannedMealView; created: boolean } {
    if (body.id) {
      const existing = this.repos.plannedMeals.get(body.id);
      if (existing) {
        if (existing.recipeId !== body.recipeId)
          throw new HttpError(409, "id: another planned meal has this id");
        return { plannedMeal: this.view(existing), created: false };
      }
    }
    const recipe = this.repos.recipes.get(body.recipeId);
    if (!recipe) throw new HttpError(400, `recipeId: no recipe ${body.recipeId}`);
    const planned = this.repos.plannedMeals.insert({
      id: body.id,
      date: body.date,
      slot: body.slot,
      recipeId: recipe.id,
      title: recipe.title,
      portionsCooked: body.portionsCooked ?? 1,
      portionEaten: body.portionEaten ?? 1,
      note: body.note?.trim() || null,
      now: this.now(),
    });
    return { plannedMeal: this.view(planned), created: true };
  }

  get(id: string): PlannedMealView {
    return this.view(this.planned(id));
  }

  /**
   * Moves (a new date or slot: to its end unless `position` says where), reorders, or changes the
   * portions and the note. Only while `planned`.
   */
  update(id: string, body: UpdatePlannedMealBody): PlannedMealView {
    const p = this.open(id, "changed");
    const now = this.now();
    const updated = this.repos.db.transaction(() => {
      let cur = p;
      const date = body.date ?? p.date;
      const slot = body.slot ?? p.slot;
      if (date !== p.date || slot !== p.slot || body.position !== undefined) {
        cur = this.repos.plannedMeals.move(id, { date, slot, position: body.position }, now)!;
      }
      if (body.portionsCooked !== undefined || body.portionEaten !== undefined || body.note !== undefined) {
        cur = this.repos.plannedMeals.update(
          id,
          {
            portionsCooked: body.portionsCooked ?? cur.portionsCooked,
            portionEaten: body.portionEaten ?? cur.portionEaten,
            note: body.note === undefined ? cur.note : body.note?.trim() || null,
          },
          now,
        )!;
      }
      return cur;
    })();
    return this.view(updated);
  }

  /** It won't be eaten; idempotent. A logged one can't be skipped (409). */
  skip(id: string): PlannedMealView {
    const p = this.planned(id);
    if (p.status === "skipped") return this.view(p);
    if (p.status === "logged") throw this.logged();
    return this.view(this.repos.plannedMeals.setStatus(id, "skipped", this.now())!);
  }

  /** Undoes a skip; idempotent. */
  unskip(id: string): PlannedMealView {
    const p = this.planned(id);
    if (p.status === "planned") return this.view(p);
    if (p.status === "logged") throw this.logged();
    return this.view(this.repos.plannedMeals.setStatus(id, "planned", this.now())!);
  }

  /** Unplans it: deleted, only while `planned` (logged and skipped ones are history). */
  unplan(id: string): void {
    this.open(id, "unplanned");
    this.repos.plannedMeals.delete(id);
  }

  /**
   * "Ate it": in one transaction a new meal at `eatenAt` (pinned, naming the planned meal) with
   * revision 1 of kind `plan`, no run, no questions: the recipe's items but the excluded ones, grams
   * = one portion × `portionEaten` (to 0.01 g), the per-100 g snapshots as stored, title and summary
   * from the recipe, an assumption naming the plan. The planned meal becomes `logged`. Idempotent
   * with the new meal's client `id`. No queue, no notification.
   */
  log(id: string, body: LogPlannedMealBody): LogPlannedMealResponse & { created: boolean } {
    const now = this.now();
    if (body.id) {
      const existing = this.repos.meals.get(body.id);
      if (existing) {
        const revision = this.revisions.current(existing);
        if (existing.sourcePlannedMealId !== id || !revision) {
          throw new HttpError(409, "id: another meal has this id");
        }
        return { plannedMeal: this.get(id), meal: existing, revision, created: false };
      }
    }
    const p = this.planned(id);
    if (p.status === "logged") throw this.logged();
    if (p.status === "skipped") throw new HttpError(409, "the planned meal was skipped", "unskip it first");
    if (body.eatenAt > now + CLOCK_SKEW_MS) {
      throw new HttpError(400, "eatenAt lies in the future", "check the device clock");
    }
    const recipe = this.recipe(p.recipeId);
    const items = this.repos.recipes.items(recipe.id);
    const exclude = new Set(body.excludeItemIds);
    const known = new Set(items.map((i) => i.id));
    const unknown = body.excludeItemIds.find((x) => !known.has(x));
    if (unknown) throw new HttpError(400, `excludeItemIds: ${unknown} is not an item of the recipe`);
    const factor = body.portionEaten ?? p.portionEaten;
    const kept = portionItems(recipe, items, factor, exclude);
    if (kept.length === 0) throw new HttpError(400, "excludeItemIds: nothing would be left to log");

    const without = items.filter((i) => exclude.has(i.id)).map((i) => i.description);
    const portions = `${amount(factor)} of ${amount(p.portionsCooked)} portion${p.portionsCooked === 1 ? "" : "s"}`;
    const assumptions = [
      `Logged from the plan: ${recipe.title}, ${portions}${without.length ? `, without ${list(without)}` : ""}`,
    ];
    if (recipe.servings !== 1) {
      assumptions.push(
        `The items' descriptions are for the whole recipe (${recipe.servings} servings); grams are for the portion eaten`,
      );
    }

    const { meal, planned } = this.repos.db.transaction(() => {
      const meal = this.repos.meals.insert({
        id: body.id,
        eatenAt: body.eatenAt,
        sourcePlannedMealId: p.id,
        now,
      });
      const revision = this.repos.revisions.insert({
        mealId: meal.id,
        runId: null,
        kind: "plan",
        title: recipe.title,
        summary: recipe.summary,
        eatenAt: body.eatenAt,
        assumptions,
        status: "analysed",
        items: kept.map((i) => ({
          foodId: i.foodId,
          description: i.description,
          grams: i.grams,
          provenance: i.provenance,
          confidence: i.confidence,
          note: i.note,
          per100g: i.per100g,
        })),
        questions: [],
        now,
      });
      return {
        meal: this.repos.meals.setCurrentRevision(meal.id, revision.id, "analysed", now)!,
        planned: this.repos.plannedMeals.markLogged(p.id, meal.id, factor, now)!,
      };
    })();
    return { plannedMeal: this.view(planned), meal, revision: this.revisions.current(meal)!, created: true };
  }

  /**
   * The days `from` … `to` (inclusive) in the phone's zone: each day's planned meals, the meals
   * eaten (with the slot each fills), the eaten totals over the analysed ones (as the day view
   * counts), the projection (eaten + planned meals still `planned`), the goal in force, the main
   * slots still open and whether the day is mostly known. One pass: the planned meals, their
   * recipes and items, the meals, their current items and the goals, each read once.
   */
  plan(q: PlanQuery): PlanResponse {
    const timeZone = requestZone(q.tz, this.timeZone);
    if (q.to < q.from) throw new HttpError(400, "to: lies before from");
    const dates: string[] = [];
    for (let d = q.from; d <= q.to; d = addDays(d, 1)) {
      dates.push(d);
      if (dates.length > MAX_PLAN_DAYS)
        throw new HttpError(400, `to: at most ${MAX_PLAN_DAYS} days at a time`);
    }
    const from = dayRange(q.from, timeZone).from;
    const to = dayRange(q.to, timeZone).to;
    const today = localDate(this.now(), timeZone);

    const planned = this.repos.plannedMeals.between(q.from, q.to);
    const recipes = this.recipesOf(planned);
    const views = planned.map((p) => this.view(p, recipes));
    const plannedById = new Map(planned.map((p) => [p.id, p]));

    const itemsOf = new Map<string, MealItem[]>();
    for (const { mealId, item } of this.repos.revisions.currentItemsBetween(from, to)) {
      itemsOf.set(mealId, [...(itemsOf.get(mealId) ?? []), item]);
    }
    const mealsOn = new Map<string, { meal: PlanMeal; items: MealItem[] }[]>();
    for (const m of this.repos.meals.tallyBetween(from, to)) {
      // a draft with nothing captured is no meal yet; a copy or a plan meal has a revision instead
      if (m.currentRevisionId === null && m.captures === 0) continue;
      const items = m.currentRevisionId ? (itemsOf.get(m.id) ?? []) : [];
      const totals = m.currentRevisionId ? nutrientTotals(computeTotals(items.map(asTotalsItem))) : null;
      const source = m.sourcePlannedMealId
        ? (plannedById.get(m.sourcePlannedMealId) ?? this.repos.plannedMeals.get(m.sourcePlannedMealId))
        : null;
      const slot: MealSlot =
        source?.slot ?? slotOf(localHour(m.eatenAt, timeZone), totals?.nutrients.energyKcal ?? null);
      const date = localDate(m.eatenAt, timeZone);
      const meal: PlanMeal = {
        mealId: m.id,
        title: m.title,
        eatenAt: m.eatenAt,
        slot,
        totals,
        plannedMealId: m.sourcePlannedMealId,
      };
      mealsOn.set(date, [...(mealsOn.get(date) ?? []), { meal, items }]);
    }

    const goalOn = goalsByDate(this.repos);
    const days: PlanDay[] = dates.map((date) => {
      const eatenMeals = mealsOn.get(date) ?? [];
      const plannedMeals = views.filter((v) => v.date === date);
      const analysed = eatenMeals.filter((m) => m.meal.totals !== null);
      const open = plannedMeals.filter((p) => p.status === "planned");
      const eatenItems = analysed.flatMap((m) => m.items.map(asTotalsItem));
      const plannedItems = open.flatMap((p) => {
        const { recipe, items } = dataOf(recipes, p);
        return portionItems(recipe, items, p.portionEaten).map(asTotalsItem);
      });
      const openSlots = MAIN_SLOTS.filter(
        (s) => !eatenMeals.some((m) => m.meal.slot === s) && !open.some((p) => p.slot === s),
      );
      return {
        date,
        plannedMeals,
        meals: eatenMeals.map((m) => m.meal),
        unanalysed: eatenMeals.length - analysed.length,
        eaten: analysed.length ? nutrientTotals(computeTotals(eatenItems)) : null,
        projected:
          analysed.length || open.length
            ? nutrientTotals(computeTotals([...eatenItems, ...plannedItems]))
            : null,
        goal: goalOn(date),
        openSlots,
        mostlyKnown: date < today || openSlots.length === 0,
      };
    });
    return { from: q.from, to: q.to, timeZone, today, days };
  }

  /** The recipes of some planned meals with their items, in two queries. */
  private recipesOf(planned: readonly PlannedMeal[]): Map<string, RecipeData> {
    const ids = planned.map((p) => p.recipeId);
    const items = this.repos.recipes.itemsOf(ids);
    return new Map(
      [...this.repos.recipes.getMany(ids)].map(([id, recipe]) => [
        id,
        { recipe, items: items.get(id) ?? [] },
      ]),
    );
  }

  /** A planned meal with one portion's totals and what it counts as eaten (all items). */
  private view(p: PlannedMeal, recipes = this.recipesOf([p])): PlannedMealView {
    const { recipe, items } = dataOf(recipes, p);
    return {
      ...p,
      perPortion: nutrientTotals(recipeTotals(portionItems(recipe, items, 1))),
      eaten: nutrientTotals(recipeTotals(portionItems(recipe, items, p.portionEaten))),
    };
  }

  private recipe(id: string): Recipe {
    const recipe = this.repos.recipes.get(id);
    if (!recipe) throw new Error(`planned meal names a missing recipe ${id}`);
    return recipe;
  }

  private planned(id: string): PlannedMeal {
    const p = this.repos.plannedMeals.get(id);
    if (!p) throw new HttpError(404, "planned meal not found");
    return p;
  }

  /** A planned meal that may still be changed or unplanned (409 once logged or skipped). */
  private open(id: string, what: string): PlannedMeal {
    const p = this.planned(id);
    if (p.status === "logged") throw this.logged();
    if (p.status === "skipped")
      throw new HttpError(409, `a skipped meal can't be ${what}`, "unskip it first");
    return p;
  }

  private logged() {
    return new HttpError(409, "the planned meal was already logged", "change the meal it logged instead");
  }
}
