import { z } from "zod";
import type { MealSlot } from "./api-planning.ts";

/**
 * The shopping list (#36, #49): for a range of the plan's days, code adds up what the planned
 * meals still `planned` there need (each recipe item's grams ÷ servings × portions cooked; a
 * leftover planned meal needs nothing), grouped by food (by food id, else the cleaned
 * description), minus the open leftovers of the same food, in aisles from the food's data. Only
 * what the user does to it is stored: checks (by line key, kept where the line still exists) and
 * lines of their own. Online only.
 */

export const shoppingPaths = {
  /** GET the list (`ShoppingQuery` → `ShoppingListResponse`). */
  list: "/api/shopping",
  /** POST (`ShoppingCheckBody`): a line into the basket or out of it. */
  check: "/api/shopping/check",
  /** POST a line of the user's own (`AddShoppingLineBody`). */
  lines: "/api/shopping/lines",
  /** DELETE a line of the user's own. */
  line: (id: string) => `/api/shopping/lines/${id}`,
} as const;

/** The aisles, in the order the list shows them. */
export const AISLES = [
  "produce",
  "bakery",
  "meat_fish",
  "dairy_eggs",
  "pantry",
  "frozen",
  "drinks",
  "other",
] as const;
export type Aisle = (typeof AISLES)[number];

export const AISLE_NAME: Record<Aisle, string> = {
  produce: "Produce",
  bakery: "Bakery",
  meat_fish: "Meat & fish",
  dairy_eggs: "Dairy & eggs",
  pantry: "Pantry",
  frozen: "Frozen",
  drinks: "Drinks",
  other: "Other",
};

/**
 * `GET /api/shopping?from&to&tz`: without `from`, today (in `tz`); without `to`, the last day with
 * a planned meal from `from` on (or `from`). At most `MAX_PLAN_DAYS` days.
 */
export const ShoppingQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  tz: z.string().min(1).max(64).optional(),
});
export type ShoppingQuery = z.infer<typeof ShoppingQuery>;

/** A planned meal that needs a line's food, with its share. */
export interface ShoppingNeed {
  plannedMealId: string;
  title: string;
  date: string;
  slot: MealSlot;
  grams: number;
}

/** A leftover matched to a line ("½ Hokkaido at home"). */
export interface ShoppingAtHome {
  leftoverId: string;
  description: string;
  quantity: string | null;
  /** Null: no amount known, so it covers the line. */
  grams: number | null;
}

export interface ShoppingLine {
  /** "food:<id>", "name:<words>", or "line:<id>" for one of the user's own. */
  key: string;
  /** "Hokkaido"; the user's own line as typed. */
  name: string;
  aisle: Aisle;
  /** What the planned meals need, in whole grams; null for the user's own line. */
  needed: number | null;
  /** What is left to buy after the leftovers at home (≥ 0); null for the user's own line. */
  grams: number | null;
  atHome: ShoppingAtHome[];
  /** The leftovers at home cover it: nothing to buy (shown muted, not counted). */
  covered: boolean;
  checked: boolean;
  /** One of the user's own lines. */
  own: boolean;
  /** The planned meals that need it, by date and slot. */
  needs: ShoppingNeed[];
}

export interface ShoppingListResponse {
  from: string;
  to: string;
  timeZone: string;
  today: string;
  /** The last day with a planned meal from today on (null: none), for the range sheet's days. */
  lastPlannedDay: string | null;
  /** The planned meals the list is for (leftover ones need nothing and aren't counted). */
  meals: number;
  /** By aisle (`AISLES`), then the lines to buy by grams, the user's own, the covered ones. */
  lines: ShoppingLine[];
  /** Lines to buy (not covered), and of those the ones checked. */
  toBuy: number;
  inBasket: number;
}

const range = { from: z.iso.date(), to: z.iso.date() };

/** `POST /api/shopping/check`: the line `key` of the list for `from`–`to` checked or not. */
export const ShoppingCheckBody = z
  .object({ ...range, key: z.string().min(1).max(300), checked: z.boolean() })
  .strict();
export type ShoppingCheckBody = z.infer<typeof ShoppingCheckBody>;

/** `POST /api/shopping/lines`: a line of the user's own, for the range it was added in (idempotent with `id`). */
export const AddShoppingLineBody = z
  .object({ ...range, id: z.uuid().optional(), text: z.string().trim().min(1).max(120) })
  .strict();
export type AddShoppingLineBody = z.infer<typeof AddShoppingLineBody>;
