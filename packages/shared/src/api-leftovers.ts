import { z } from "zod";
import type { NutrientTotals } from "./api-nutrition.ts";
import { MealSlot } from "./api-planning.ts";

/**
 * Leftovers (#36, #49): a short list of what is at home to use up, not a pantry. Extra portions of
 * a planned meal (`cooked`, made by "Ate it" with portions cooked > eaten), remainders of a pack
 * the planning agent noted (`pack`, "½ Hokkaido") and lines the user added (`user`). The plan
 * offers a cooked one for a next meal (**Plan it**: a planned meal with `leftoverOf`, nothing
 * cooked), the planning agent reads the open ones, and the shopping list subtracts them.
 */

export const leftoverPaths = {
  /** GET the open leftovers (`LeftoversResponse`); POST one of the user's (`CreateLeftoverBody`). */
  leftovers: "/api/leftovers",
  /** PATCH (`UpdateLeftoverBody`): used, gone, or open again. */
  leftover: (id: string) => `/api/leftovers/${id}`,
  /** POST (`PlanLeftoverBody`): a cooked leftover onto a slot ("Plan it"), a planned meal. */
  plan: (id: string) => `/api/leftovers/${id}/plan`,
} as const;

export const LeftoverSource = z.enum(["cooked", "pack", "user"]);
export type LeftoverSource = z.infer<typeof LeftoverSource>;

/** `open` → `used` (eaten or cooked with) | `gone` (thrown away, or not there after all), and back. */
export const LeftoverStatus = z.enum(["open", "used", "gone"]);
export type LeftoverStatus = z.infer<typeof LeftoverStatus>;

export interface Leftover {
  id: string;
  /** "Hokkaido"; a cooked one: the recipe's title. */
  description: string;
  /** The food it is, when known. */
  foodId: string | null;
  /** As said: "½", "1 bunch". */
  quantity: string | null;
  grams: number | null;
  /** A cooked one: the portions still left; null otherwise. */
  portions: number | null;
  source: LeftoverSource;
  /** A cooked one: the planned meal cooked with the extra portions (null once that was unplanned). */
  plannedMealId: string | null;
  recipeId: string | null;
  /** A cooked one: the planned meal's date. */
  cookedOn: string | null;
  /** A pack the planning agent noted: its round. */
  roundId: string | null;
  /**
   * A pack noted for a suggestion: it is on the list only once a planned meal of that suggestion is
   * logged (cooked).
   */
  suggestionId: string | null;
  /** "Bought Saturday", "Rest from the curry". */
  note: string | null;
  status: LeftoverStatus;
  createdAt: number;
  updatedAt: number;
  /** When it became used or gone. */
  closedAt: number | null;
}

/** Where a cooked leftover is planned: a planned meal with `leftoverOf`, still `planned`. */
export interface LeftoverPlannedFor {
  plannedMealId: string;
  date: string;
  slot: MealSlot;
  portionEaten: number;
}

export interface LeftoverView extends Leftover {
  /** The food's name, when it has one. */
  food: { id: string; name: string } | null;
  /** A cooked one: the portions not planned yet (`portions` − what its planned meals eat). */
  available: number | null;
  /** A cooked one: the planned meals that eat it, still planned. */
  plannedFor: LeftoverPlannedFor[];
  /** A cooked one: one portion of its recipe. */
  perPortion: NutrientTotals | null;
}

/** A cooked leftover the plan offers for a slot of a day ("Leftover · 1 portion, offered for lunch"). */
export interface LeftoverOffer {
  leftoverId: string;
  slot: MealSlot;
}

export interface LeftoversResponse {
  /** The open ones, oldest first. */
  leftovers: LeftoverView[];
}

export interface LeftoverResponse {
  leftover: LeftoverView;
}

const clientId = z.uuid().optional();

/**
 * `POST /api/leftovers`: one of the user's ("Koriander", "1 bunch"). With an `id` it is idempotent
 * (201, then 200 with the stored one).
 */
export const CreateLeftoverBody = z
  .object({
    id: clientId,
    description: z.string().trim().min(1).max(120),
    quantity: z.string().trim().max(40).optional(),
    grams: z.number().positive().max(100_000).optional(),
    note: z.string().trim().max(200).optional(),
  })
  .strict();
export type CreateLeftoverBody = z.infer<typeof CreateLeftoverBody>;

/** `PATCH /api/leftovers/:id`: used, gone, or open again (an undo). */
export const UpdateLeftoverBody = z.object({ status: LeftoverStatus }).strict();
export type UpdateLeftoverBody = z.infer<typeof UpdateLeftoverBody>;

/**
 * `POST /api/leftovers/:id/plan` ("Plan it"): a cooked leftover onto a day's slot, as a planned
 * meal of its recipe with `leftoverOf` and nothing cooked; `portionEaten` defaults to one portion,
 * or what is left when less. With an `id` (the planned meal's) it is idempotent.
 */
export const PlanLeftoverBody = z
  .object({
    id: clientId,
    date: z.iso.date(),
    slot: MealSlot,
    portionEaten: z.number().min(0.1).max(10).optional(),
  })
  .strict();
export type PlanLeftoverBody = z.infer<typeof PlanLeftoverBody>;

/** Less than this of a portion counts as none (rounding: portions are kept to 0.01). */
export const PORTION_EPSILON = 0.005;

const number = (n: number) => String(Math.round(n * 100) / 100);

/**
 * How much of a leftover there is, in words: "1 portion", "½ · 500 g", "1 bunch", "200 g"; ""
 * when nothing says.
 */
export function leftoverAmount(l: Pick<Leftover, "quantity" | "grams" | "portions" | "source">): string {
  if (l.source === "cooked" && l.portions !== null) {
    return `${number(l.portions)} ${l.portions === 1 ? "portion" : "portions"}`;
  }
  const grams = l.grams !== null ? `${Math.round(l.grams)} g` : "";
  if (l.quantity && grams) return `${l.quantity} · ≈ ${grams}`;
  return l.quantity ?? grams;
}
