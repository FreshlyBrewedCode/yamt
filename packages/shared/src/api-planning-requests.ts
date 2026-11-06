import { z } from "zod";
import type { PlanGoal } from "./api-calendar.ts";
import type { DayProgress } from "./api-goals.ts";
import type { Transcript } from "./api-meals.ts";
import type { NutrientTotals } from "./api-nutrition.ts";
import {
  type MealSlot,
  MealSlot as MealSlotEnum,
  type PlannedMealView,
  type Recipe,
  RecipeSourceMode,
} from "./api-planning.ts";

/**
 * Planning requests (#36, #44): what the user asks for (filters plus inputs made like captures:
 * text, links, voice memos, photos, files), the rounds a `plan` job fills with suggestions (an
 * outline first, then each suggestion as it is ready: an insert-only recipe), and the verdicts
 * on them (pick → a planned meal, reject). The agent job that fills a round is #45's.
 */

export const planningRequestPaths = {
  /** GET the open requests (`PlanningRequestsResponse`); POST one (`CreatePlanningRequestBody`). */
  requests: "/api/planning/requests",
  /** GET the thread (`PlanningRequestDetail`): the request, its inputs, rounds and suggestions. */
  request: (id: string) => `/api/planning/requests/${id}`,
  /** POST: out of the open list (a queued or running round is stopped); idempotent. */
  archive: (id: string) => `/api/planning/requests/${id}/archive`,
  /** POST: back in the open list; idempotent. */
  unarchive: (id: string) => `/api/planning/requests/${id}/unarchive`,
  /** POST an input: multipart (audio, image, file) or JSON (`PlanningInputJsonBody`: text, link). */
  inputs: (requestId: string) => `/api/planning/requests/${requestId}/inputs`,
  /** POST (`StartRoundBody`): the first round, or a steering round over the inputs since the last. */
  suggest: (requestId: string) => `/api/planning/requests/${requestId}/suggest`,
  /** POST (`StartRoundBody`): another round with the same input (`kind: more`). */
  more: (requestId: string) => `/api/planning/requests/${requestId}/more`,
  /** POST: soft retraction of an input; idempotent. */
  retractInput: (inputId: string) => `/api/planning/inputs/${inputId}/retract`,
  /** POST (`PickSuggestionBody`): a planned meal from the suggestion's recipe. */
  pick: (suggestionId: string) => `/api/planning/suggestions/${suggestionId}/pick`,
  /** POST: "No"; idempotent. */
  reject: (suggestionId: string) => `/api/planning/suggestions/${suggestionId}/reject`,
  /** POST: undoes a rejection; idempotent. */
  unreject: (suggestionId: string) => `/api/planning/suggestions/${suggestionId}/unreject`,
  /** The original bytes of a media input (range requests, as `mealPaths.media`). */
  media: (inputId: string) => `/api/planning/media/${inputId}`,
  /** The JPEG derivative of a HEIC/HEIF photo input (404 when there is none). */
  mediaJpeg: (inputId: string) => `/api/planning/media/${inputId}/jpeg`,
} as const;

/** `user`: asked for in the app; `nightly`: made by the nightly run (#48). */
export const PlanningOrigin = z.enum(["user", "nightly"]);
export type PlanningOrigin = z.infer<typeof PlanningOrigin>;

/** The constraints the filter page offers; `constraints` also takes free strings ("ohne Pilze"). */
export const PLANNING_CONSTRAINTS = [
  "no_oven",
  "one_pot",
  "vegetarian",
  "vegan",
  "high_protein",
  "low_carb",
] as const;
export type PlanningConstraint = (typeof PLANNING_CONSTRAINTS)[number];

/** Most days one request plans for, and most suggestions per round (spike #38: ~40 s each). */
export const MAX_PLANNING_DAYS = 14;
export const MAX_SUGGESTIONS = 6;

/** A leftover to use up: one from the leftovers list (#49), or a short text ("½ Hokkaido"). */
export const UseUp = z.union([
  z.object({ leftoverId: z.uuid() }).strict(),
  z.object({ text: z.string().trim().min(1).max(120) }).strict(),
]);
export type UseUp = z.infer<typeof UseUp>;

/**
 * The structured half of a request: never flattened into the text. Every field is optional on
 * the way in; what is missing comes from `PLANNING_DEFAULTS` when the request is made, and the
 * request stores the complete filters (`ResolvedPlanningFilters`).
 */
export const PlanningFilters = z
  .object({
    /** Local dates (`YYYY-MM-DD`, the request's zone), today or later; default: today. */
    days: z.array(z.iso.date()).min(1).max(MAX_PLANNING_DAYS).optional(),
    slots: z.array(MealSlotEnum).min(1).max(4).optional(),
    /** Most minutes of total time; null: no cap. */
    timeCapMin: z.number().int().min(5).max(600).nullable().optional(),
    /** `PLANNING_CONSTRAINTS` ids or free strings. */
    constraints: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    useUp: z.array(UseUp).max(12).optional(),
    sourceMode: RecipeSourceMode.optional(),
    /** Portions to cook (one is eaten; the rest becomes a leftover). */
    portionsCooked: z.number().int().min(1).max(20).optional(),
    /** Suggestions per round. */
    count: z.number().int().min(1).max(MAX_SUGGESTIONS).optional(),
  })
  .strict();
export type PlanningFilters = z.infer<typeof PlanningFilters>;

export interface ResolvedPlanningFilters {
  /** Sorted, distinct. */
  days: string[];
  /** In slot order, distinct. */
  slots: MealSlot[];
  timeCapMin: number | null;
  constraints: string[];
  useUp: UseUp[];
  sourceMode: RecipeSourceMode;
  portionsCooked: number;
  count: number;
}

/**
 * Filters a request leaves out: tonight's dinner, based on a real recipe, one portion, three
 * suggestions (spike #38). Planning settings (#46) will provide their own.
 */
export const PLANNING_DEFAULTS: Omit<ResolvedPlanningFilters, "days"> = {
  slots: ["dinner"],
  timeCapMin: null,
  constraints: [],
  useUp: [],
  sourceMode: "adapted",
  portionsCooked: 1,
  count: 3,
};

const SLOT_WORDS: Record<MealSlot, [string, string]> = {
  breakfast: ["breakfast", "breakfasts"],
  lunch: ["lunch", "lunches"],
  dinner: ["dinner", "dinners"],
  snack: ["snack", "snacks"],
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const utc = (date: string) => new Date(`${date}T12:00:00Z`);
const weekday = (date: string) => WEEKDAYS[(utc(date).getUTCDay() + 6) % 7]!;
const dayMonth = (date: string) => `${utc(date).getUTCDate()} ${MONTHS[utc(date).getUTCMonth()]}`;
const daysApart = (a: string, b: string) => Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000);

/**
 * The title code gives a request ("Dinners Tue–Thu", "Lunch and dinner Fri"); the round's outline
 * may replace it. Weekdays rather than "tonight", so the title stays true the next day; dates once
 * the days span more than a week.
 */
export function requestTitle(f: Pick<ResolvedPlanningFilters, "days" | "slots">): string {
  const days = [...new Set(f.days)].sort();
  const plural = days.length > 1 ? 1 : 0;
  const slots = MealSlotEnum.options.filter((s) => f.slots.includes(s)).map((s) => SLOT_WORDS[s][plural]);
  const what = slots.length <= 1 ? (slots[0] ?? "") : `${slots.slice(0, -1).join(", ")} and ${slots.at(-1)}`;
  const first = days[0];
  const last = days.at(-1);
  let when = "";
  if (first && last) {
    const span = daysApart(first, last);
    const consecutive = span === days.length - 1;
    if (span >= 7) when = `${dayMonth(first)}–${dayMonth(last)}`;
    else if (days.length === 1) when = weekday(first);
    else if (consecutive && days.length > 2) when = `${weekday(first)}–${weekday(last)}`;
    else when = days.map(weekday).join(", ");
  }
  const title = `${what} ${when}`.trim();
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export const PlanningInputKind = z.enum(["text", "link", "audio", "image", "file"]);
export type PlanningInputKind = z.infer<typeof PlanningInputKind>;

/** `first`: the request's first round; `more`: the same input again; `steer`: with inputs added since. */
export const PlanningRoundKind = z.enum(["first", "more", "steer"]);
export type PlanningRoundKind = z.infer<typeof PlanningRoundKind>;

/** `queued` → `running` → `done` (≥ 1 suggestion ready) | `failed`. */
export const PlanningRoundStatus = z.enum(["queued", "running", "done", "failed"]);
export type PlanningRoundStatus = z.infer<typeof PlanningRoundStatus>;

/** `outlined` (an idea from the outline) → `ready` (its recipe is saved) | `failed` (with the reason). */
export const SuggestionStatus = z.enum(["outlined", "ready", "failed"]);
export type SuggestionStatus = z.infer<typeof SuggestionStatus>;

export const SuggestionVerdict = z.enum(["picked", "rejected"]);
export type SuggestionVerdict = z.infer<typeof SuggestionVerdict>;

export interface PlanningRequest {
  id: string;
  /** From the filters (`requestTitle`), or the outline's. */
  title: string;
  origin: PlanningOrigin;
  filters: ResolvedPlanningFilters;
  /** The zone its days are in (the phone's when it was made). */
  timeZone: string;
  /** Out of the open list; null while open. */
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** What the user added to a request: a capture of its own kind (same media handling as meals'). */
export interface PlanningInput {
  id: string;
  requestId: string;
  kind: PlanningInputKind;
  createdAt: number;
  capturedAt: number | null;
  /** A photo's EXIF time. */
  takenAt: number | null;
  mimeType: string | null;
  byteSize: number | null;
  sha256: string | null;
  fileName: string | null;
  jpegDerivative: "ok" | "missing" | null;
  text: string | null;
  url: string | null;
  /** The round it went into; null until a round starts (it belongs to the next one). */
  roundId: string | null;
  retractedAt: number | null;
}

/** A voice input's transcript, as a voice memo's (`Transcript`), keyed by the input. */
export type PlanningTranscript = Omit<Transcript, "captureId"> & { inputId: string };

export interface PlanningRound {
  id: string;
  requestId: string;
  /** 1, 2, … within the request. */
  number: number;
  kind: PlanningRoundKind;
  status: PlanningRoundStatus;
  /** Suggestions asked for (the request's `count` when the round was made). */
  count: number;
  /** The current (or last) run filling it (#45). */
  runId: string | null;
  /** Why it failed; null otherwise. */
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

export interface PlanningSuggestion {
  id: string;
  roundId: string;
  /** 0, 1, … in the outline's order. */
  position: number;
  status: SuggestionStatus;
  title: string;
  /** One line: "Ofen-Kürbis mit Feta, auf Basis eines chefkoch-Rezepts". */
  approach: string;
  sourceMode: RecipeSourceMode;
  sourceUrl: string | null;
  proposedDate: string | null;
  proposedSlot: MealSlot | null;
  /** Set once `ready`: the suggestion is this (insert-only) recipe. */
  recipeId: string | null;
  /** Up to four short lines: why it fits. */
  why: string[];
  /** Why it didn't complete (`failed`). */
  failure: string | null;
  verdict: SuggestionVerdict | null;
  /** The planned meal a pick made; null again once it is unplanned. */
  plannedMealId: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * How a suggestion fits its day, computed live from the plan (#39's projection): the day with it
 * and what that leaves of the goal. A picked suggestion is already in the projection (unless its
 * planned meal was skipped), so it isn't counted twice.
 */
export interface SuggestionFit {
  /** The proposed day and slot, or its planned meal's once picked. */
  date: string;
  slot: MealSlot;
  /** The day's projection without it (eaten + planned); null when there is nothing. */
  before: NutrientTotals | null;
  /** With one portion (a picked one: its planned portion). */
  with: NutrientTotals;
  goal: PlanGoal | null;
  /** Each target against `with`. Null without a goal. */
  progress: DayProgress | null;
  /** kcal target − `with` (negative: over); null without a kcal target. */
  kcalLeft: number | null;
  /** Protein target − `with`; null without a protein target. */
  proteinOpen: number | null;
}

export interface PlanningSuggestionView extends PlanningSuggestion {
  /** Its recipe once ready (without items: `GET /api/recipes/:id` has them). */
  recipe: Recipe | null;
  /** One portion's totals (`computeTotals`); null until ready. */
  perPortion: NutrientTotals | null;
  /** Null until ready, or without a day. */
  fit: SuggestionFit | null;
}

export interface PlanningRoundView extends PlanningRound {
  /** By position. */
  suggestions: PlanningSuggestionView[];
}

/** `GET /api/planning/requests/:id`: the thread. */
export interface PlanningRequestDetail {
  request: PlanningRequest;
  /** In arrival order, retracted ones included (flagged). */
  inputs: PlanningInput[];
  transcripts: PlanningTranscript[];
  /** Oldest first. */
  rounds: PlanningRoundView[];
  /** Live inputs not in a round yet: Suggest now starts a steering round with them. */
  pendingInputs: number;
}

/** A round's suggestions counted, for the overview strip ("2 of 3 ready"). */
export interface PlanningRoundTally {
  id: string;
  number: number;
  kind: PlanningRoundKind;
  status: PlanningRoundStatus;
  count: number;
  outlined: number;
  ready: number;
  failed: number;
  picked: number;
  rejected: number;
}

export interface PlanningRequestSummary {
  request: PlanningRequest;
  /** The latest round; null before the first. */
  latestRound: PlanningRoundTally | null;
  /** Live inputs. */
  inputs: number;
  /** Live inputs not in a round yet. */
  pendingInputs: number;
}

/** `GET /api/planning/requests`: the open (not archived) requests, newest first. */
export interface PlanningRequestsResponse {
  requests: PlanningRequestSummary[];
}

const clientId = z.uuid().optional();
const inputText = z.string().trim().min(1).max(20_000);
const capturedAt = z.number().int().nonnegative().optional();

/**
 * `POST /api/planning/requests`: idempotent with a client `id` (201 the first time, 200 with the
 * stored request after). `text` becomes its first input. `tz` (the phone's zone; the server's by
 * default) is the zone of its days. Days before today are refused.
 */
export const CreatePlanningRequestBody = z
  .object({
    id: clientId,
    filters: PlanningFilters.default({}),
    text: inputText.optional(),
    tz: z.string().min(1).max(64).optional(),
  })
  .strict();
export type CreatePlanningRequestBody = z.infer<typeof CreatePlanningRequestBody>;

export interface PlanningRequestResponse {
  request: PlanningRequest;
}

/** `POST /api/planning/requests/:id/inputs` with JSON: a text or a link (idempotent with an `id`). */
export const PlanningInputJsonBody = z.discriminatedUnion("kind", [
  z.object({ id: clientId, kind: z.literal("text"), text: inputText, capturedAt }).strict(),
  z
    .object({
      id: clientId,
      kind: z.literal("link"),
      url: z.url({ protocol: /^https?$/ }).max(4_000),
      text: inputText.optional(),
      capturedAt,
    })
    .strict(),
]);
export type PlanningInputJsonBody = z.infer<typeof PlanningInputJsonBody>;

/** `POST /api/planning/requests/:id/inputs` as multipart: `file` plus these fields (as meal uploads). */
export const PlanningUploadFields = z.object({
  id: clientId,
  kind: z.enum(["audio", "image", "file"]).optional(),
  capturedAt: z.coerce.number().int().nonnegative().optional(),
});
export type PlanningUploadFields = z.infer<typeof PlanningUploadFields>;

export interface PlanningInputResponse {
  input: PlanningInput;
  /** A voice input's pending transcript. */
  transcript: PlanningTranscript | null;
  request: PlanningRequest;
}

/** `POST /api/planning/inputs/:id/retract`: idempotent; the input keeps its first `retractedAt`. */
export interface RetractPlanningInputResponse {
  input: PlanningInput;
}

/**
 * `POST …/suggest` and `…/more`: with a client `id` (the round's) a retry answers the round it
 * made (200) instead of a 409 for the round now open.
 */
export const StartRoundBody = z.object({ id: clientId }).strict();
export type StartRoundBody = z.infer<typeof StartRoundBody>;

/** The new round (`queued`) and its `plan` job. */
export interface StartRoundResponse {
  round: PlanningRound;
  jobId: string;
}

/**
 * `POST /api/planning/suggestions/:id/pick`: the planned meal goes on `date` / `slot` (default:
 * the proposed ones, else the request's next open slot), with `portionsCooked` (default: the
 * request's) and `portionEaten` (default 1). With an `id` (the planned meal's) a retry answers it.
 */
export const PickSuggestionBody = z
  .object({
    id: clientId,
    date: z.iso.date().optional(),
    slot: MealSlotEnum.optional(),
    portionsCooked: z.number().int().min(1).max(20).optional(),
    portionEaten: z.number().min(0.1).max(10).optional(),
  })
  .strict();
export type PickSuggestionBody = z.infer<typeof PickSuggestionBody>;

export interface SuggestionResponse {
  suggestion: PlanningSuggestionView;
}

/** A pick: the suggestion (`picked`) and its planned meal. */
export interface PickSuggestionResponse extends SuggestionResponse {
  plannedMeal: PlannedMealView;
}
