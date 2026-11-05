import { z } from "zod";
import type { MealRevisionView, NutrientTotals } from "./api-nutrition.ts";
import type { AnalysisRun } from "./api-runs.ts";

/**
 * Meals and their captures (#6). Times are epoch milliseconds throughout. Captures are immutable
 * apart from `retractedAt`; transcripts are derived from audio captures and replaceable.
 */

export const mealPaths = {
  meals: "/api/meals",
  /** GET the detail; PATCH `eatenAt` (`UpdateMealBody`). */
  meal: (id: string) => `/api/meals/${id}`,
  /** Every analysis revision of the meal with its computed totals, newest first. */
  revisions: (mealId: string) => `/api/meals/${mealId}/revisions`,
  captures: (mealId: string) => `/api/meals/${mealId}/captures`,
  analyse: (mealId: string) => `/api/meals/${mealId}/analyse`,
  /** Log the meal again (#30): a new meal with a copy of its current revision, no analysis. */
  repeat: (mealId: string) => `/api/meals/${mealId}/repeat`,
  /** Soft removal (`RemoveMealResponse`): out of every list, day and total; idempotent. */
  remove: (mealId: string) => `/api/meals/${mealId}/remove`,
  /** Undoes a removal (`RestoreMealResponse`); idempotent. */
  restore: (mealId: string) => `/api/meals/${mealId}/restore`,
  /** Recent analysed meals to log again (`RepeatableQuery`): one per title, most often first. */
  repeatable: "/api/meals/repeatable",
  retract: (captureId: string) => `/api/captures/${captureId}/retract`,
  /** Re-run an audio capture's transcript (e.g. after a model change); the audio stays as it is. */
  transcribe: (captureId: string) => `/api/captures/${captureId}/transcribe`,
  /** The original bytes, as uploaded. Supports range requests (audio playback). */
  media: (captureId: string) => `/api/media/${captureId}`,
  /** The JPEG derivative of a HEIC/HEIF photo (404 when there is none). */
  mediaJpeg: (captureId: string) => `/api/media/${captureId}/jpeg`,
} as const;

/** Largest accepted upload: a long Voice Memos recording is ~1 MB/min, so this is generous. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** `draft` → `queued` → `analysing` → `analysed` | `needs_input` | `failed`; analyse again re-queues. */
export const MealStatus = z.enum(["draft", "queued", "analysing", "analysed", "needs_input", "failed"]);
export type MealStatus = z.infer<typeof MealStatus>;

/**
 * Where `eatenAt` comes from: `created` (no capture yet, the meal's creation time), `capture`
 * (the earliest live capture), `user` (given explicitly), `agent` (refined by the analysis, #8).
 * Only `created` and `capture` follow the captures.
 */
export const EatenAtSource = z.enum(["created", "capture", "user", "agent"]);
export type EatenAtSource = z.infer<typeof EatenAtSource>;

export const CaptureKind = z.enum(["audio", "image", "text", "link", "file", "correction", "answer"]);
export type CaptureKind = z.infer<typeof CaptureKind>;

/** Kinds that arrive as a multipart upload; the rest are JSON. */
export const UploadCaptureKind = z.enum(["audio", "image", "file"]);
export type UploadCaptureKind = z.infer<typeof UploadCaptureKind>;

/**
 * Answers and corrections can be spoken too: uploaded as audio with this kind, they are stored
 * as `answer` / `correction` captures with the recording as their media and get a transcript.
 */
export const VoiceCaptureKind = z.enum(["answer", "correction"]);
export type VoiceCaptureKind = z.infer<typeof VoiceCaptureKind>;

/**
 * Whether a capture carries speech that gets a transcript: audio captures, and answers and
 * corrections that were recorded rather than typed.
 */
export const isVoice = (c: { kind: CaptureKind; mimeType: string | null }): boolean =>
  c.kind === "audio" || ((c.kind === "answer" || c.kind === "correction") && c.mimeType !== null);

const kindWords: Record<CaptureKind, [string, string]> = {
  audio: ["voice memo", "voice memos"],
  image: ["photo", "photos"],
  text: ["note", "notes"],
  link: ["link", "links"],
  file: ["file", "files"],
  correction: ["correction", "corrections"],
  answer: ["answer", "answers"],
};
const kindOrder: CaptureKind[] = ["image", "audio", "text", "link", "file", "correction", "answer"];

/** "2 photos", "1 voice memo" for each kind present, in a fixed order. */
export function captureCounts(kinds: Partial<Record<CaptureKind, number>>): string[] {
  return kindOrder
    .filter((k) => (kinds[k] ?? 0) > 0)
    .map((k) => {
      const n = kinds[k]!;
      return `${n} ${kindWords[k][n === 1 ? 0 : 1]}`;
    });
}

export const TranscriptStatus = z.enum(["pending", "done", "failed"]);
export type TranscriptStatus = z.infer<typeof TranscriptStatus>;

export interface Meal {
  id: string;
  status: MealStatus;
  eatenAt: number;
  eatenAtSource: EatenAtSource;
  /** The latest analysis revision (#7); null until the first analysis. */
  currentRevisionId: string | null;
  /** Why the analysis failed for good (status `failed`); null otherwise. */
  analysisError: string | null;
  /** The meal this one was logged again from (#30); null for a meal of its own. */
  sourceMealId: string | null;
  /**
   * When the meal was removed (soft: nothing of it is deleted); null for a meal in use. A removed
   * meal is left out of every list, day, month, total and history, and takes no writes but a
   * restore; `GET /api/meals/:id` still answers it.
   */
  removedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Capture {
  id: string;
  mealId: string;
  kind: CaptureKind;
  /** When the server stored it. */
  createdAt: number;
  /** When the client says it was captured (recording start, photo taken in the app). */
  capturedAt: number | null;
  /** When the photo was taken according to its EXIF data (library photos can be older). */
  takenAt: number | null;
  /** Media captures (audio, image, file); null for text-like ones. */
  mimeType: string | null;
  byteSize: number | null;
  sha256: string | null;
  /** The file name the client sent, if any. */
  fileName: string | null;
  /**
   * `ok`: a JPEG derivative exists (HEIC/HEIF photos), `missing`: one was needed but could not be
   * made (the original is still stored), null: not needed.
   */
  jpegDerivative: "ok" | "missing" | null;
  text: string | null;
  url: string | null;
  /** For `answer` captures: the agent question it answers (a question of the then current revision). */
  questionId: string | null;
  retractedAt: number | null;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * Speech-to-text of one audio capture: created `pending` on upload, filled by the transcribe job
 * (#9), reset to `pending` by a re-run (`POST /api/captures/:id/transcribe`).
 */
export interface Transcript {
  captureId: string;
  status: TranscriptStatus;
  text: string | null;
  /** What transcribed it, e.g. `faster-whisper large-v3-turbo int8`. */
  model: string | null;
  language: string | null;
  /** Length of the audio. */
  durationMs: number | null;
  segments: TranscriptSegment[] | null;
  /** Wall time of the transcription itself (model loading and ffmpeg not counted). */
  elapsedMs: number | null;
  /** The STT settings it ran with (compute type, threads, beam size, VAD, prompt…). */
  settings: Record<string, string | number | boolean | null> | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

/** A meal in the overview: the meal plus what it holds (retracted captures are not counted). */
export interface MealSummary extends Meal {
  captureCount: number;
  captureKinds: Partial<Record<CaptureKind, number>>;
  /** The first live photo, for a thumbnail. */
  coverCaptureId: string | null;
  /** Live audio captures whose transcript is still `pending`. */
  pendingTranscripts: number;
  /** The current revision's title; null until the first analysis. */
  title: string | null;
  /** The current revision's totals (computed, like every total); null until the first analysis. */
  totals: NutrientTotals | null;
  /** Questions of the current revision without an answer yet. */
  openQuestions: number;
}

/**
 * A calendar day's totals over the meals of a `GET /api/meals` answer that were eaten that day
 * (in the requested zone): every item of their current revisions, computed in code.
 */
export interface DayTotals {
  /** `YYYY-MM-DD` in the zone. */
  date: string;
  meals: number;
  /** Meals of the day without an analysis yet (they count nothing). */
  unanalysed: number;
  totals: NutrientTotals;
}

const epochMs = z.number().int().nonnegative();

/**
 * A client-chosen id (a UUID, v7 by convention) makes a create idempotent: sending it again
 * answers what the first request stored instead of storing it twice. The web app's upload queue
 * relies on it to retry after a lost response.
 */
const clientId = z.uuid().optional();

/**
 * `POST /api/meals`. `eatenAt` pins the time (source `user`); otherwise the captures set it.
 * With an `id` the create is idempotent (201 the first time, 200 with the stored meal after).
 */
export const CreateMealBody = z.object({ id: clientId, eatenAt: epochMs.optional() }).strict();
export type CreateMealBody = z.infer<typeof CreateMealBody>;

/**
 * `PATCH /api/meals/:id`: when it was eaten. A time pins it (source `user`: neither captures
 * nor the analysis move it again); `null` unpins it, so it follows the captures again.
 */
export const UpdateMealBody = z.object({ eatenAt: epochMs.nullable() }).strict();
export type UpdateMealBody = z.infer<typeof UpdateMealBody>;

/**
 * `GET /api/meals?from&to&limit&tz`: meals whose `eatenAt` is in [from, to), newest first, and
 * the totals of each day they fall on, reckoned in `tz` (an IANA zone; the server's by default).
 */
export const MealsQuery = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  tz: z.string().min(1).max(64).optional(),
});
export type MealsQuery = z.infer<typeof MealsQuery>;

export interface MealResponse {
  meal: Meal;
}

export interface MealsResponse {
  meals: MealSummary[];
  /** One entry per day with meals in `meals`, newest first. */
  days: DayTotals[];
  /** The zone the days are reckoned in. */
  timeZone: string;
}

/**
 * `GET /api/meals/:id`: every capture (retracted ones included, flagged), the transcripts, the
 * current analysis revision with its items, questions and computed totals, and the analysis runs
 * (newest first; a revision's `runId` names its run).
 */
export interface MealDetailResponse {
  meal: Meal;
  captures: Capture[];
  transcripts: Transcript[];
  revision: MealRevisionView | null;
  runs: AnalysisRun[];
  /** The meal it was logged again from (#30), as it is now; null for a meal of its own. */
  source: MealSource | null;
}

/** The meal another one was logged again from: its current title (null without one) and time. */
export interface MealSource {
  mealId: string;
  title: string | null;
  eatenAt: number;
}

/**
 * `GET /api/meals/:id/revisions`: every revision of the meal, newest first, each with its items,
 * questions (and answers) and totals computed from its items, so a correction's effect shows.
 */
export interface MealRevisionsResponse {
  revisions: MealRevisionView[];
}

const captureText = z.string().trim().min(1).max(20_000);
const capturedAt = epochMs.optional();

/**
 * `POST /api/meals/:id/captures` with a JSON body: the text-like kinds. An `id` makes it
 * idempotent (see `CreateMealBody`): the same id again answers the stored capture with 200.
 */
export const JsonCaptureBody = z.discriminatedUnion("kind", [
  z.object({ id: clientId, kind: z.literal("text"), text: captureText, capturedAt }).strict(),
  z
    .object({
      id: clientId,
      kind: z.literal("link"),
      url: z.url({ protocol: /^https?$/ }).max(4_000),
      /** An optional note about the link. */
      text: captureText.optional(),
      capturedAt,
    })
    .strict(),
  z.object({ id: clientId, kind: z.literal("correction"), text: captureText, capturedAt }).strict(),
  z
    .object({
      id: clientId,
      kind: z.literal("answer"),
      text: captureText,
      /** The question answered; it must belong to the meal's current revision. */
      questionId: z.uuid().optional(),
      capturedAt,
    })
    .strict(),
]);
export type JsonCaptureBody = z.infer<typeof JsonCaptureBody>;

/**
 * `POST /api/meals/:id/captures` as `multipart/form-data`: the bytes in `file`, plus these text
 * fields. Without `kind` it follows the content (image/*, audio/*, else file). `answer` and
 * `correction` take a recording (audio only); an answer may name its `questionId` as in JSON.
 */
export const UploadCaptureFields = z.object({
  /** Idempotency, as for JSON captures. */
  id: clientId,
  kind: z.enum([...UploadCaptureKind.options, ...VoiceCaptureKind.options]).optional(),
  capturedAt: z.coerce.number().int().nonnegative().optional(),
  questionId: z.uuid().optional(),
});
export type UploadCaptureFields = z.infer<typeof UploadCaptureFields>;

export interface CaptureResponse {
  capture: Capture;
  /** Set for audio captures: the pending transcript. */
  transcript: Transcript | null;
  meal: Meal;
}

/**
 * `POST /api/meals/:id/analyse`: the meal (now `queued`) and the analyse job. Also the retry of a
 * `failed` meal.
 */
export interface AnalyseResponse {
  meal: Meal;
  jobId: string;
}

/**
 * `POST /api/captures/:id/transcribe`: the transcript, reset to `pending`, and its job. Idempotent
 * while the job is queued. Doesn't analyse the meal again: press analyse for that.
 */
export interface TranscribeResponse {
  capture: Capture;
  transcript: Transcript;
  jobId: string;
}

/** The portions the app offers for logging a meal again (#30); the server takes any factor in range. */
export const REPEAT_FACTORS = [0.5, 1, 1.5, 2] as const;

/**
 * `POST /api/meals/:id/repeat` (#30): log the meal again at `eatenAt` (pinned, source `user`),
 * every item's grams × `factor`. With an `id` it is idempotent like `CreateMealBody`: 201 the
 * first time, 200 with the stored copy after (a meal with that id that isn't a copy of this one
 * is a 409). `tz` (the phone's zone) dates the source in the copy's assumption line.
 */
export const RepeatMealBody = z
  .object({
    id: clientId,
    factor: z.number().min(0.1).max(10),
    eatenAt: epochMs,
    tz: z.string().min(1).max(64).optional(),
  })
  .strict();
export type RepeatMealBody = z.infer<typeof RepeatMealBody>;

/** `POST /api/meals/:id/repeat`: the new meal and its one revision, the copy. */
export interface RepeatMealResponse {
  meal: Meal;
  revision: MealRevisionView;
}

/**
 * `GET /api/meals/repeatable?days&limit` (#30): analysed meals eaten in the last `days` days,
 * one per title (case and spacing aside), the most often logged first, then the most recent.
 */
export const RepeatableQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});
export type RepeatableQuery = z.infer<typeof RepeatableQuery>;

export interface RepeatableMeal {
  /** The latest meal with this title: the one a tap logs again. */
  mealId: string;
  title: string;
  eatenAt: number;
  /** How many meals in the window had this title (copies included). */
  times: number;
  /** The latest meal's totals (computed, like every total). */
  totals: NutrientTotals;
}

export interface RepeatableResponse {
  meals: RepeatableMeal[];
}

/**
 * `POST /api/meals/:id/remove` (no body): the meal with its `removedAt` (a second call answers it
 * as it is). A queued or running analysis is cancelled (`stoppedAnalysis`); the meal then stands
 * where that analysis started from: its current revision's status, or `draft` without one.
 */
export interface RemoveMealResponse {
  meal: Meal;
  /** An analysis of the meal was queued or running and has been cancelled. */
  stoppedAnalysis: boolean;
}

/**
 * `POST /api/meals/:id/restore` (no body): the meal back in use, as it was when it was removed
 * (status, revision, time); idempotent. A stopped analysis isn't started again: press analyse.
 */
export interface RestoreMealResponse {
  meal: Meal;
}

/** `POST /api/captures/:id/retract`: idempotent; the capture keeps its first `retractedAt`. */
export interface RetractResponse {
  capture: Capture;
  meal: Meal;
}
