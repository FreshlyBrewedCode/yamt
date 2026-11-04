import type {
  Confidence,
  Meal,
  MealItem,
  MealItemView,
  MealQuestionView,
  MealRevisionView,
  MealStatus,
  Nutrients,
  Provenance,
  Totals,
} from "@yamt/shared";
import type { Repos } from "../db/repos/index.ts";
import { dedupeKeys } from "../db/repos/jobs.ts";
import { emptyNutrients } from "../nutrition/nutrients.ts";
import { computeTotals, itemNutrients } from "../nutrition/totals.ts";
import { HttpError } from "./errors.ts";
import { dayRange } from "./time.ts";

/** The agent asks at most this many questions per revision (epic #2). */
export const MAX_QUESTIONS = 2;
/** How far ahead of the server an `eatenAt` may lie (client clocks, time zones). */
const FUTURE_SLACK_MS = 60 * 60_000;

export interface SaveRevisionInput {
  mealId: string;
  /** The analysis run (#8) saving it; null for interactive sessions. */
  runId: string | null;
  title: string;
  summary: string;
  eatenAt: number | null;
  assumptions: string[];
  items: {
    /** A food from search_foods / lookup_barcode / create_food … */
    foodId?: string | null;
    /** … or, for a pure estimate without a food, its numbers per 100 g (energy required). */
    estimatePer100g?: (Partial<Nutrients> & { energyKcal: number }) | null;
    description: string;
    grams: number;
    provenance: Provenance;
    confidence: Confidence;
    note?: string | null;
  }[];
  questions: { question: string; whyItMatters: string; impactKcal: number }[];
}

export interface DayMeal {
  meal: Meal;
  revision: MealRevisionView | null;
}

export interface DaySummary {
  date: string;
  timeZone: string;
  from: number;
  to: number;
  meals: DayMeal[];
  /** Over every item of every meal's current revision; meals without one count nothing. */
  totals: Totals;
  /** Meals of the day that have no analysis yet (draft, queued, analysing, failed). */
  unanalysed: number;
}

/**
 * Analysis revisions: the agent's (or an interactive session's) result for a meal, saved as a
 * new revision with items, questions and assumptions. Totals are computed from the items here,
 * never taken from the caller.
 */
export class RevisionService {
  constructor(
    private readonly repos: Repos,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Validates and saves a revision, makes it the meal's current one and moves the meal to
   * `analysed` (no questions) or `needs_input`, unless another analysis of the meal is already
   * queued: then the meal stays `queued` (#6: captures arrived while this run worked).
   */
  save(input: SaveRevisionInput): MealRevisionView {
    const now = this.now();
    const meal = this.repos.meals.get(input.mealId);
    if (!meal) throw new HttpError(404, `no meal with id ${input.mealId}`);
    if (input.items.length === 0 && input.questions.length === 0) {
      throw new HttpError(400, "items: a revision needs items, or a question when nothing can be identified");
    }
    if (input.questions.length > MAX_QUESTIONS) {
      throw new HttpError(
        400,
        `questions: at most ${MAX_QUESTIONS}, only those that change the result materially`,
      );
    }
    if (input.eatenAt !== null && input.eatenAt > now + FUTURE_SLACK_MS) {
      throw new HttpError(400, "eatenAt lies in the future");
    }

    const foods = this.repos.foods.getMany(input.items.flatMap((i) => (i.foodId ? [i.foodId] : [])));
    const items = input.items.map((it, n) => {
      const where = `items[${n}]`;
      if (it.foodId && it.estimatePer100g) {
        throw new HttpError(400, `${where}: give either foodId or estimatePer100g, not both`);
      }
      let per100g: Nutrients;
      if (it.foodId) {
        const food = foods.get(it.foodId);
        if (!food)
          throw new HttpError(400, `${where}.foodId: no food ${it.foodId} (search or create it first)`);
        if (food.per100g.energyKcal === null) {
          throw new HttpError(
            400,
            `${where}: ${food.name} has no energy value; pick another food or create_food with the label's numbers`,
          );
        }
        per100g = food.per100g;
      } else if (it.estimatePer100g) {
        if (it.provenance === "database" || it.provenance === "label") {
          throw new HttpError(400, `${where}: provenance ${it.provenance} needs a foodId`);
        }
        per100g = { ...emptyNutrients(), ...it.estimatePer100g };
      } else {
        throw new HttpError(400, `${where}: give a foodId, or estimatePer100g for a pure estimate`);
      }
      return {
        foodId: it.foodId ?? null,
        description: it.description.trim(),
        grams: it.grams,
        provenance: it.provenance,
        confidence: it.confidence,
        note: it.note?.trim() || null,
        per100g,
      };
    });

    const status = input.questions.length > 0 ? "needs_input" : "analysed";
    const revision = this.repos.db.transaction(() => {
      const revision = this.repos.revisions.insert({
        mealId: meal.id,
        runId: input.runId,
        title: input.title.trim(),
        summary: input.summary.trim(),
        eatenAt: input.eatenAt,
        assumptions: input.assumptions.map((a) => a.trim()).filter(Boolean),
        status,
        items,
        questions: input.questions.map((q) => ({
          question: q.question.trim(),
          whyItMatters: q.whyItMatters.trim(),
          impactKcal: q.impactKcal,
        })),
        now,
      });
      const queued = this.repos.jobs.hasQueued(dedupeKeys.analyse(meal.id));
      const mealStatus: MealStatus = queued ? "queued" : status;
      this.repos.meals.setCurrentRevision(meal.id, revision.id, mealStatus, now);
      // the analysis may refine when it was eaten, but never overrides the user
      if (input.eatenAt !== null && meal.eatenAtSource !== "user") {
        this.repos.meals.setEatenAt(meal.id, input.eatenAt, "agent", now);
      }
      return revision;
    })();
    return this.view(revision.id)!;
  }

  /** A revision with items (and their foods), questions (and answers) and computed totals. */
  view(revisionId: string): MealRevisionView | null {
    const revision = this.repos.revisions.get(revisionId);
    if (!revision) return null;
    const items = this.repos.revisions.items(revisionId);
    const foods = this.repos.foods.getMany(items.flatMap((i) => (i.foodId ? [i.foodId] : [])));
    const itemViews: MealItemView[] = items.map((i) => {
      const food = i.foodId ? foods.get(i.foodId) : undefined;
      return {
        ...i,
        food: food
          ? {
              id: food.id,
              source: food.source,
              sourceRef: food.sourceRef,
              name: food.name,
              brand: food.brand,
            }
          : null,
        nutrients: itemNutrients(i),
      };
    });
    const questions: MealQuestionView[] = this.repos.revisions.questions(revisionId).map((q) => ({
      ...q,
      answer: q.answeredByCaptureId ? (this.repos.captures.get(q.answeredByCaptureId)?.text ?? null) : null,
    }));
    return { revision, items: itemViews, questions, totals: totalsOf(items) };
  }

  /** The meal's current revision, if it has one. */
  current(meal: Meal): MealRevisionView | null {
    return meal.currentRevisionId ? this.view(meal.currentRevisionId) : null;
  }

  /** The meals eaten on a calendar day (in `timeZone`) with their current revisions and the day's totals. */
  day(date: string, timeZone: string): DaySummary {
    let range: { from: number; to: number };
    try {
      range = dayRange(date, timeZone);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const meals = this.repos.meals.eatenBetween(range.from, range.to).map((meal) => ({
      meal,
      revision: this.current(meal),
    }));
    const allItems = meals.flatMap((m) => m.revision?.items ?? []);
    return {
      date,
      timeZone,
      ...range,
      meals,
      totals: totalsOf(allItems),
      unanalysed: meals.filter((m) => m.revision === null).length,
    };
  }
}

/** The totals of any set of stored items (a revision, a day): `computeTotals`, nothing else. */
export const totalsOf = (items: readonly MealItem[]): Totals =>
  computeTotals(items.map((i) => ({ grams: i.grams, per100g: i.per100g, provenance: i.provenance })));
