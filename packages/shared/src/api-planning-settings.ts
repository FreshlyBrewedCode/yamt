import { z } from "zod";
import { RecipeSourceMode } from "./api-planning.ts";

/**
 * Settings → Planning (#36, #46): the defaults a new request's filters fall back to (count,
 * source mode, portions to cook; #51's `PLANNING_DEFAULTS` still covers what isn't here) and the
 * preferences `get_planning_context` hands the plan-meals skill (never eat is a hard rule,
 * dislikes are avoided, equipment and weekday cooking time are constraints, favourite sites are
 * looked at first). One JSON value, the `settings` table's `planning` key.
 */

export const planningSettingsPaths = {
  /** GET the settings (`PlanningSettingsResponse`); PUT replaces them whole (`PlanningSettingsBody`). */
  settings: "/api/planning/settings",
} as const;

const list = (max: number) => z.array(z.string().trim().min(1).max(80)).max(max);

/** Personal data (database only, never the repo or logs): what the plan-meals skill must know. */
export const PlanningPreferences = z
  .object({
    /** Avoid where there's a better option ("Rosenkohl"). */
    dislikes: list(20),
    /** Never: a suggestion with one is wrong ("Erdnüsse"). */
    neverEat: list(20),
    /** What the kitchen has, so a recipe needing more isn't suggested ("Airfryer", "kein Ofen"). */
    equipment: list(20),
    /** Most minutes of active cooking on a weekday; null: no limit. */
    weekdayCookingMin: z.number().int().min(5).max(240).nullable(),
    /** Looked at first for a real recipe ("chefkoch.de"). */
    favouriteSites: list(10),
  })
  .strict();
export type PlanningPreferences = z.infer<typeof PlanningPreferences>;

export const DEFAULT_PLANNING_PREFERENCES: PlanningPreferences = {
  dislikes: [],
  neverEat: [],
  equipment: [],
  weekdayCookingMin: null,
  favouriteSites: [],
};

/**
 * The nightly run (#48): a planning request for today's open main slots made at `time` (the
 * server's zone, `HH:MM`) each day, with `count` suggestions and agent-written starters. Off by
 * default: it costs a run a day.
 */
export const NightlySettings = z
  .object({
    enabled: z.boolean(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM, 00:00 to 23:59"),
    count: z.number().int().min(1).max(5),
  })
  .strict();
export type NightlySettings = z.infer<typeof NightlySettings>;

export const DEFAULT_NIGHTLY_SETTINGS: NightlySettings = { enabled: false, time: "03:00", count: 3 };

/**
 * `GET` / `PUT /api/planning/settings`: a whole replace, like `AgentSettingsBody`. `count` 2–5
 * (default 3), `portionsCooked` 1–4 (default 1): narrower than a request's own filters, which may
 * still ask for more. `nightly`: the nightly run's options (#48).
 */
export const PlanningSettingsBody = z
  .object({
    count: z.number().int().min(2).max(5),
    sourceMode: RecipeSourceMode,
    portionsCooked: z.number().int().min(1).max(4),
    preferences: PlanningPreferences,
    nightly: NightlySettings,
  })
  .strict();
export type PlanningSettingsBody = z.infer<typeof PlanningSettingsBody>;

export const DEFAULT_PLANNING_SETTINGS: PlanningSettingsBody = {
  count: 3,
  sourceMode: "adapted",
  portionsCooked: 1,
  preferences: DEFAULT_PLANNING_PREFERENCES,
  nightly: DEFAULT_NIGHTLY_SETTINGS,
};

export interface PlanningSettingsResponse {
  settings: PlanningSettingsBody;
}
