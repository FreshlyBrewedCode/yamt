import { z } from "zod";
import { type MealSlot, MealSlot as MealSlotEnum, RecipeSourceMode } from "./api-planning.ts";
import {
  MAX_SUGGESTIONS,
  type PlanningRequest,
  type PlanningRequestDetail,
} from "./api-planning-requests.ts";
import type { NightlySettings } from "./api-planning-settings.ts";

/**
 * The nightly run (#36, #48): each day at the time Settings → Planning names, the server makes a
 * planning request for today's open main slots (`origin: nightly`, an ordinary thread) and runs
 * its first round; the same run writes **starters**, ideas the entry screen offers. A starter is
 * stored without a number: the app computes it live (protein open now, days since a meal, …) from
 * the kind and the reference.
 */

export const planningNightlyPaths = {
  /** GET (`NightlyResponse`): the settings, the next run, today's nightly requests, the starters. */
  nightly: "/api/planning/nightly",
  /** POST (`RegenerateNightlyBody`): a new nightly request now; the earlier one stays until it is done. */
  regenerate: "/api/planning/nightly/regenerate",
} as const;

/** What a starter is about; the app computes its number from the kind and the reference. */
export const STARTER_KINDS = [
  "protein_gap",
  "use_up",
  "variety",
  "like_meal",
  "season",
  "last_request",
  "other",
] as const;
export const StarterKind = z.enum(STARTER_KINDS);
export type StarterKind = z.infer<typeof StarterKind>;

/** How many starters a nightly run saves. */
export const MIN_STARTERS = 4;
export const MAX_STARTERS = 6;

/**
 * The filters a tap on a starter applies (over the defaults), as the entry screen's draft: days
 * relative (`today`, `tomorrow`, `week`: the rest of it), so a starter stays true the next morning.
 */
export const StarterFilters = z
  .object({
    when: z.enum(["today", "tomorrow", "week"]).optional(),
    slots: z.array(MealSlotEnum).min(1).max(4).optional(),
    timeCapMin: z.number().int().min(5).max(600).nullable().optional(),
    constraints: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    /** Short texts ("½ Hokkaido"). */
    useUp: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
    sourceMode: RecipeSourceMode.optional(),
    portionsCooked: z.number().int().min(1).max(20).optional(),
    count: z.number().int().min(1).max(MAX_SUGGESTIONS).optional(),
  })
  .strict();
export type StarterFilters = z.infer<typeof StarterFilters>;

/** What a starter is about, by id: the app reads the live number from it. */
export const StarterRef = z
  .object({
    mealId: z.uuid().optional(),
    requestId: z.uuid().optional(),
    recipeId: z.uuid().optional(),
    /** A leftover of the leftovers list (#49). */
    leftoverId: z.uuid().optional(),
  })
  .strict();
export type StarterRef = z.infer<typeof StarterRef>;

/** One starter as the agent saves it (`save_starters`). */
export const StarterInput = z
  .object({
    kind: StarterKind,
    /** The idea, as the band's headline: "Lachs mal wieder", "High protein tonight". */
    text: z.string().trim().min(1).max(80),
    /** One line of why. */
    detail: z.string().trim().max(160).default(""),
    filters: StarterFilters.default({}),
    ref: StarterRef.default({}),
  })
  .strict();
export type StarterInput = z.input<typeof StarterInput>;

export interface PlanningStarter {
  id: string;
  /** The nightly round that wrote it. */
  roundId: string;
  position: number;
  kind: StarterKind;
  text: string;
  detail: string;
  filters: StarterFilters;
  ref: StarterRef;
  createdAt: number;
}

/** A starter with what its reference names today, for the app's live number. */
export interface PlanningStarterView extends PlanningStarter {
  /** The referenced meal (not removed): when it was eaten. */
  meal: { id: string; title: string | null; eatenAt: number } | null;
  /** The referenced request: when it was made. */
  request: Pick<PlanningRequest, "id" | "title" | "createdAt"> | null;
}

/** `GET /api/planning/nightly`. */
export interface NightlyResponse {
  settings: NightlySettings;
  /** The zone the run's time is in (the server's). */
  timeZone: string;
  /** When the scheduled run is due next (epoch ms); null while off. */
  nextRunAt: number | null;
  /**
   * The open nightly requests for today or later, newest first: usually one; two while a
   * regenerated one hasn't finished (the earlier one stays until it has).
   */
  requests: PlanningRequestDetail[];
  /** The latest run's starters (at most `STARTERS_MAX_AGE_MS` old), in its order; [] without. */
  starters: PlanningStarterView[];
}

/** Starters older than this are not offered any more (the nightly run was turned off). */
export const STARTERS_MAX_AGE_MS = 48 * 3_600_000;

/** `POST /api/planning/nightly/regenerate`: `id` is the new request's client id (a retry gets it back). */
export const RegenerateNightlyBody = z.object({ id: z.uuid().optional() }).strict();
export type RegenerateNightlyBody = z.infer<typeof RegenerateNightlyBody>;

export interface RegenerateNightlyResponse {
  request: PlanningRequest;
  /** The slots it plans for: today's open main slots. */
  slots: MealSlot[];
}
