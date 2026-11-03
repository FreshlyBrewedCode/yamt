import { z } from "zod";
import { LocalDate } from "./api-goals.ts";
import {
  DAILY_LIFE_KEYS,
  DURATIONS,
  FAT_PERCENT,
  GOAL_KINDS,
  INTENSITIES,
  MAX_SESSIONS,
  PACES,
  PROTEIN_PRESETS,
  SEXES,
  TRAINING_TYPES,
} from "./goal-calc.ts";

/**
 * The body profile and guided goals (#24). The profile is one row: what the guided setup asks
 * about the user (sex, birth year, height, body fat, daily life, training), saved with each
 * guided goal and pre-filling the flow next time. Weight comes from the weight log.
 */

export const profilePaths = {
  /** GET the profile (null before the first guided setup); PUT replaces it (`ProfileBody`). */
  profile: "/api/profile",
  /** POST a guided goal (`GuidedGoalBody`): calculated on the server, saved from today. */
  guidedGoal: "/api/goals/guided",
} as const;

export const TrainingBody = z
  .object({
    sessionsPerWeek: z.number().int().min(0).max(MAX_SESSIONS),
    minutes: z.literal(DURATIONS),
    type: z.enum(TRAINING_TYPES),
    intensity: z.enum(INTENSITIES),
  })
  .strict();

/** `PUT /api/profile`, and the profile part of a guided goal. */
export const ProfileBody = z
  .object({
    sex: z.enum(SEXES),
    birthYear: z.number().int().min(1900).max(2100),
    heightCm: z.number().min(100).max(250),
    bodyFatPct: z.number().min(3).max(70).nullable().default(null),
    dailyLife: z.enum(DAILY_LIFE_KEYS),
    training: TrainingBody,
  })
  .strict();
export type ProfileBody = z.infer<typeof ProfileBody>;

export type Profile = ProfileBody & { updatedAt: number };

export interface ProfileResponse {
  profile: Profile | null;
}

export const GoalChoicesBody = z
  .object({
    goal: z.enum(GOAL_KINDS),
    pace: z.enum(PACES).default("standard"),
    protein: z.enum(PROTEIN_PRESETS),
    fatPercent: z
      .number()
      .int()
      .min(FAT_PERCENT.min)
      .max(FAT_PERCENT.max)
      .refine((n) => n % FAT_PERCENT.step === 0, `in steps of ${FAT_PERCENT.step}`),
  })
  .strict();

/**
 * `POST /api/goals/guided`: the profile, the choices and (optionally) a weight to log first.
 * The server takes the weight from the log (`goalWeight`), runs `calculateGoal`, saves the
 * profile and adds a goal from `effectiveFrom` (default today in the server's zone; the web app
 * sends the phone's today) with its derivation. A refusal (under 18, pregnancy, a cut when
 * underweight) is a 422 with the reason.
 */
export const GuidedGoalBody = z
  .object({
    profile: ProfileBody,
    choices: GoalChoicesBody,
    pregnantOrBreastfeeding: z.boolean().default(false),
    /** Logged as a weight entry (measured now) before the calculation. */
    weightKg: z.number().min(20).max(500).optional(),
    effectiveFrom: LocalDate.optional(),
  })
  .strict();
export type GuidedGoalBody = z.infer<typeof GuidedGoalBody>;
