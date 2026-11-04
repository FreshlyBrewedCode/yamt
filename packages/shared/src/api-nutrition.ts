import { z } from "zod";

/**
 * Nutrition data, analysis revisions and their computed totals (#7). The agent reads captures
 * and picks foods and grams; the server computes every total from per-100 g data times grams.
 */

/** Where a food's numbers come from: Open Food Facts, USDA FoodData Central, a label, made up. */
export const FoodSource = z.enum(["off", "fdc", "label", "custom"]);
export type FoodSource = z.infer<typeof FoodSource>;

/** How an item's amount and numbers were obtained. */
export const Provenance = z.enum(["weighed", "label", "database", "estimate"]);
export type Provenance = z.infer<typeof Provenance>;

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

/** The core set, per 100 g: energy in kcal, everything else in grams. */
export const CORE_NUTRIENTS = [
  "energyKcal",
  "protein",
  "fat",
  "saturatedFat",
  "carbohydrate",
  "sugars",
  "fiber",
  "salt",
] as const;
export type CoreNutrient = (typeof CORE_NUTRIENTS)[number];

/** Core nutrients per 100 g; null where the source has no value. */
export type Nutrients = Record<CoreNutrient, number | null>;

/** Anything in the source beyond the core set, per 100 g, keyed by the source's name. */
export interface NutrientValue {
  value: number;
  unit: string;
}

/** A known portion, e.g. "1 tbsp" = 13.5 g. */
export interface Portion {
  label: string;
  grams: number;
}

export interface Food {
  id: string;
  source: FoodSource;
  /** Barcode (off, label), FDC id (fdc), null for custom foods. */
  sourceRef: string | null;
  name: string;
  brand: string | null;
  per100g: Nutrients;
  /** The full profile per 100 g as the source reports it. */
  nutrients: Record<string, NutrientValue>;
  portions: Portion[];
  fetchedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export const RevisionStatus = z.enum(["analysed", "needs_input"]);
export type RevisionStatus = z.infer<typeof RevisionStatus>;

/** A revision as stored: what an analysis concluded about a meal. Kept forever. */
export interface MealRevision {
  id: string;
  mealId: string;
  /** 1, 2, … per meal. */
  number: number;
  /** The analysis run (#8) that wrote it; null for interactive sessions. */
  runId: string | null;
  title: string;
  summary: string;
  eatenAt: number | null;
  assumptions: string[];
  status: RevisionStatus;
  createdAt: number;
}

export interface MealItem {
  id: string;
  revisionId: string;
  position: number;
  foodId: string | null;
  /** The item as captured ("a handful of walnuts"). */
  description: string;
  grams: number;
  provenance: Provenance;
  confidence: Confidence;
  note: string | null;
  /** The food's core numbers when the revision was saved (or the estimate), so totals never drift. */
  per100g: Nutrients;
}

export interface MealQuestion {
  id: string;
  revisionId: string;
  position: number;
  question: string;
  whyItMatters: string;
  /** How many kcal the answer could move the total, roughly. */
  impactKcal: number;
  answeredByCaptureId: string | null;
}

/** Totals of a set of items for one group: grams eaten and each core nutrient. */
export interface NutrientTotals {
  grams: number;
  items: number;
  nutrients: Record<CoreNutrient, number>;
}

/** Computed in code from items (never by the model). */
export interface Totals extends NutrientTotals {
  byProvenance: Record<Provenance, NutrientTotals>;
  /** Per nutrient: how many items have no value for it (their share counts as 0). */
  missing: Record<CoreNutrient, number>;
}

export interface MealItemView extends MealItem {
  food: {
    id: string;
    source: FoodSource;
    sourceRef: string | null;
    name: string;
    brand: string | null;
  } | null;
  /** This item's share: per100g × grams / 100, rounded. */
  nutrients: Record<CoreNutrient, number | null>;
}

export interface MealQuestionView extends MealQuestion {
  /** The answer: its text, or a spoken answer's transcript (null while that is pending). */
  answer: string | null;
}

/** A revision with its items, questions and computed totals. */
export interface MealRevisionView {
  revision: MealRevision;
  items: MealItemView[];
  questions: MealQuestionView[];
  totals: Totals;
}
