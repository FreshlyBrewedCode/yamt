import type {
  Confidence,
  MealItem,
  MealQuestion,
  MealRevision,
  Nutrients,
  Provenance,
  RevisionStatus,
} from "@yamt/shared";
import { type Db, newId } from "../index.ts";
import { type NutrientRow, nutrientsOf, nutrientValues } from "./foods.ts";

interface RevisionRow {
  id: string;
  meal_id: string;
  number: number;
  run_id: string | null;
  title: string;
  summary: string;
  eaten_at: number | null;
  assumptions: string;
  status: RevisionStatus;
  created_at: number;
}

interface ItemRow extends NutrientRow {
  id: string;
  revision_id: string;
  position: number;
  food_id: string | null;
  description: string;
  grams: number;
  provenance: Provenance;
  confidence: Confidence;
  note: string | null;
}

interface QuestionRow {
  id: string;
  revision_id: string;
  position: number;
  question: string;
  why_it_matters: string;
  impact_kcal: number;
  answered_by_capture_id: string | null;
}

const toRevision = (r: RevisionRow): MealRevision => ({
  id: r.id,
  mealId: r.meal_id,
  number: r.number,
  runId: r.run_id,
  title: r.title,
  summary: r.summary,
  eatenAt: r.eaten_at,
  assumptions: JSON.parse(r.assumptions) as string[],
  status: r.status,
  createdAt: r.created_at,
});

const toItem = (r: ItemRow): MealItem => ({
  id: r.id,
  revisionId: r.revision_id,
  position: r.position,
  foodId: r.food_id,
  description: r.description,
  grams: r.grams,
  provenance: r.provenance,
  confidence: r.confidence,
  note: r.note,
  per100g: nutrientsOf(r),
});

const toQuestion = (r: QuestionRow): MealQuestion => ({
  id: r.id,
  revisionId: r.revision_id,
  position: r.position,
  question: r.question,
  whyItMatters: r.why_it_matters,
  impactKcal: r.impact_kcal,
  answeredByCaptureId: r.answered_by_capture_id,
});

export interface NewRevision {
  mealId: string;
  runId: string | null;
  title: string;
  summary: string;
  eatenAt: number | null;
  assumptions: string[];
  status: RevisionStatus;
  items: {
    foodId: string | null;
    description: string;
    grams: number;
    provenance: Provenance;
    confidence: Confidence;
    note: string | null;
    /** The food's numbers (copied) or the estimate. */
    per100g: Nutrients;
  }[];
  questions: { question: string; whyItMatters: string; impactKcal: number }[];
  now?: number;
}

/**
 * Analysis revisions with their items and questions: one aggregate, written once and kept (the
 * migration's triggers refuse updates and deletes). Only a question's answer link changes.
 */
export class RevisionRepo {
  constructor(private readonly db: Db) {}

  /** Inserts the revision as the meal's next number. Call inside the caller's transaction. */
  insert(r: NewRevision): MealRevision {
    const id = newId();
    const now = r.now ?? Date.now();
    const number =
      (this.db
        .query<{ n: number | null }, [string]>(
          "SELECT max(number) AS n FROM meal_revisions WHERE meal_id = ?",
        )
        .get(r.mealId)?.n ?? 0) + 1;
    this.db
      .query(
        `INSERT INTO meal_revisions (id, meal_id, number, run_id, title, summary, eaten_at, assumptions, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        r.mealId,
        number,
        r.runId,
        r.title,
        r.summary,
        r.eatenAt,
        JSON.stringify(r.assumptions),
        r.status,
        now,
      );
    const item = this.db.query(
      `INSERT INTO meal_items (id, revision_id, position, food_id, description, grams, provenance, confidence, note,
         energy_kcal, protein_g, fat_g, saturated_fat_g, carbohydrate_g, sugars_g, fiber_g, salt_g)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    r.items.forEach((it, i) => {
      item.run(
        newId(),
        id,
        i,
        it.foodId,
        it.description,
        it.grams,
        it.provenance,
        it.confidence,
        it.note,
        ...nutrientValues(it.per100g),
      );
    });
    const question = this.db.query(
      `INSERT INTO meal_questions (id, revision_id, position, question, why_it_matters, impact_kcal)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    r.questions.forEach((q, i) => {
      question.run(newId(), id, i, q.question, q.whyItMatters, q.impactKcal);
    });
    return this.get(id)!;
  }

  get(id: string): MealRevision | null {
    const r = this.db.query<RevisionRow, [string]>("SELECT * FROM meal_revisions WHERE id = ?").get(id);
    return r ? toRevision(r) : null;
  }

  /** The revisions an analysis run saved (a run saves exactly one; the tool refuses a second). */
  forRun(runId: string): MealRevision[] {
    return this.db
      .query<RevisionRow, [string]>("SELECT * FROM meal_revisions WHERE run_id = ? ORDER BY number")
      .all(runId)
      .map(toRevision);
  }

  /** Every revision of a meal, oldest first. */
  listForMeal(mealId: string): MealRevision[] {
    return this.db
      .query<RevisionRow, [string]>("SELECT * FROM meal_revisions WHERE meal_id = ? ORDER BY number")
      .all(mealId)
      .map(toRevision);
  }

  items(revisionId: string): MealItem[] {
    return this.db
      .query<ItemRow, [string]>("SELECT * FROM meal_items WHERE revision_id = ? ORDER BY position")
      .all(revisionId)
      .map(toItem);
  }

  questions(revisionId: string): MealQuestion[] {
    return this.db
      .query<QuestionRow, [string]>("SELECT * FROM meal_questions WHERE revision_id = ? ORDER BY position")
      .all(revisionId)
      .map(toQuestion);
  }

  question(id: string): MealQuestion | null {
    const r = this.db.query<QuestionRow, [string]>("SELECT * FROM meal_questions WHERE id = ?").get(id);
    return r ? toQuestion(r) : null;
  }

  /**
   * Points the question at its latest live answer capture (or none): after an answer arrives or
   * one is retracted. `captures.question_id` is the source of truth; this is its shortcut.
   */
  refreshAnswer(questionId: string): MealQuestion | null {
    this.db
      .query(
        `UPDATE meal_questions SET answered_by_capture_id = (
           SELECT id FROM captures WHERE question_id = meal_questions.id AND kind = 'answer' AND retracted_at IS NULL
           ORDER BY created_at DESC, id DESC LIMIT 1)
         WHERE id = ?`,
      )
      .run(questionId);
    return this.question(questionId);
  }
}
