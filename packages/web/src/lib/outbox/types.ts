/** What the upload queue keeps until the server confirms it (see outbox.ts). */

import type { ResolvedPlanningFilters } from "@yamt/shared";

export type PendingCapture =
  | {
      /** `answer` and `correction` uploads are spoken ones (recorded in place on the meal detail). */
      kind: "audio" | "image" | "file" | "answer" | "correction";
      blob: Blob;
      fileName: string;
      mimeType: string;
      /** In-app recordings know their length; files don't until the server transcribes them. */
      durationMs?: number;
      /** For a spoken answer: the question it answers. */
      questionId?: string;
    }
  | { kind: "text"; text: string }
  | { kind: "link"; url: string; text?: string }
  /** The agent asked; this answers (a question of the meal's current revision). */
  | { kind: "answer"; text: string; questionId?: string }
  /** "It was 2 eggs, not 3": the user's word beats the analysis. */
  | { kind: "correction"; text: string };

interface EntryBase {
  /**
   * The capture's or planning input's id (also the server's), the planning request's or round's
   * client id, or the analyse request's own id. A UUIDv7.
   */
  id: string;
  createdAt: number;
  /** Failed attempts so far. */
  attempts: number;
  /** When the next attempt is due (epoch ms). */
  nextAttemptAt: number;
  /** The last error; with `failed` the reason the server refused it. */
  error: string | null;
  /** The server refused it (4xx): no automatic retries; the user retries or discards it. */
  failed: boolean;
}

export interface CaptureEntry extends EntryBase {
  type: "capture";
  mealId: string;
  /** Client time of the capture (recording start, file picked, note added). */
  capturedAt: number;
  capture: PendingCapture;
}

/** "Analyse this meal once its captures are up": pressed while uploads were pending or offline. */
export interface AnalyseEntry extends EntryBase {
  type: "analyse";
  mealId: string;
}

/** What a meal's screens show from the queue. */
export type MealEntry = CaptureEntry | AnalyseEntry;

/** What a planning input can be: a meal capture's kinds without answers and corrections. */
export type PendingPlanningInput =
  | { kind: "audio" | "image" | "file"; blob: Blob; fileName: string; mimeType: string; durationMs?: number }
  | { kind: "text"; text: string }
  | { kind: "link"; url: string; text?: string };

/**
 * A planning request (#47) made on this phone: created with the client's id (`id` is the
 * request's), its filters complete and the phone's zone; a text alone goes along as its first input.
 */
export interface PlanRequestEntry extends EntryBase {
  type: "plan-request";
  requestId: string;
  filters: ResolvedPlanningFilters;
  tz: string;
  text?: string;
}

/** An input of a planning request (sent once the request is up), as a capture is of a meal. */
export interface PlanInputEntry extends EntryBase {
  type: "plan-input";
  requestId: string;
  capturedAt: number;
  input: PendingPlanningInput;
}

/**
 * A new round (`id` is the round's client id): `suggest` (the first, or a steer with the inputs
 * since the last) or `more` (the same input again). It waits for the request and every input queued
 * before it.
 */
export interface PlanRoundEntry extends EntryBase {
  type: "plan-round";
  requestId: string;
  kind: "suggest" | "more";
}

export type PlanningEntry = PlanRequestEntry | PlanInputEntry | PlanRoundEntry;

export type OutboxEntry = MealEntry | PlanningEntry;

/** Where entries persist between visits (IndexedDB in the app, memory in tests). */
export interface OutboxStore {
  all(): Promise<OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  delete(id: string): Promise<void>;
}

/** A transport failure: `status` is the HTTP status, absent when the network failed. */
export class TransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** What the queue sends; every call is idempotent by id. Throws `TransportError`. */
export interface OutboxTransport {
  ensureMeal(mealId: string): Promise<void>;
  sendCapture(entry: CaptureEntry, onProgress: (fraction: number) => void): Promise<void>;
  analyse(mealId: string): Promise<void>;
  createPlanningRequest(entry: PlanRequestEntry): Promise<void>;
  sendPlanningInput(entry: PlanInputEntry, onProgress: (fraction: number) => void): Promise<void>;
  startRound(entry: PlanRoundEntry): Promise<void>;
}
