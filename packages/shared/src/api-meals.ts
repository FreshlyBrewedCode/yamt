import { z } from "zod";
import type { MealRevisionView } from "./api-nutrition.ts";
import type { AnalysisRun } from "./api-runs.ts";

/**
 * Meals and their captures (#6). Times are epoch milliseconds throughout. Captures are immutable
 * apart from `retractedAt`; transcripts are derived from audio captures and replaceable.
 */

export const mealPaths = {
  meals: "/api/meals",
  meal: (id: string) => `/api/meals/${id}`,
  captures: (mealId: string) => `/api/meals/${mealId}/captures`,
  analyse: (mealId: string) => `/api/meals/${mealId}/analyse`,
  retract: (captureId: string) => `/api/captures/${captureId}/retract`,
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

/** Speech-to-text of one audio capture: created `pending` on upload, filled by the worker (#9). */
export interface Transcript {
  captureId: string;
  status: TranscriptStatus;
  text: string | null;
  model: string | null;
  language: string | null;
  durationMs: number | null;
  segments: TranscriptSegment[] | null;
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
}

const epochMs = z.number().int().nonnegative();

/** `POST /api/meals`. `eatenAt` pins the time (source `user`); otherwise the captures set it. */
export const CreateMealBody = z.object({ eatenAt: epochMs.optional() }).strict();
export type CreateMealBody = z.infer<typeof CreateMealBody>;

/** `GET /api/meals?from&to&limit`: meals whose `eatenAt` is in [from, to), newest first. */
export const MealsQuery = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type MealsQuery = z.infer<typeof MealsQuery>;

export interface MealResponse {
  meal: Meal;
}

export interface MealsResponse {
  meals: MealSummary[];
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
}

const captureText = z.string().trim().min(1).max(20_000);
const capturedAt = epochMs.optional();

/** `POST /api/meals/:id/captures` with a JSON body: the text-like kinds. */
export const JsonCaptureBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: captureText, capturedAt }).strict(),
  z
    .object({
      kind: z.literal("link"),
      url: z.url({ protocol: /^https?$/ }).max(4_000),
      /** An optional note about the link. */
      text: captureText.optional(),
      capturedAt,
    })
    .strict(),
  z.object({ kind: z.literal("correction"), text: captureText, capturedAt }).strict(),
  z
    .object({
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
 * fields. Without `kind` it follows the content (image/*, audio/*, else file).
 */
export const UploadCaptureFields = z.object({
  kind: UploadCaptureKind.optional(),
  capturedAt: z.coerce.number().int().nonnegative().optional(),
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

/** `POST /api/captures/:id/retract`: idempotent; the capture keeps its first `retractedAt`. */
export interface RetractResponse {
  capture: Capture;
  meal: Meal;
}
