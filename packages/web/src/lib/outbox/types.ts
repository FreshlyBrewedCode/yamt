/** What the upload queue keeps until the server confirms it (see outbox.ts). */

export type PendingCapture =
  | {
      kind: "audio" | "image" | "file";
      blob: Blob;
      fileName: string;
      mimeType: string;
      /** In-app recordings know their length; files don't until the server transcribes them. */
      durationMs?: number;
    }
  | { kind: "text"; text: string }
  | { kind: "link"; url: string; text?: string };

interface EntryBase {
  /** The capture's id (also the server's), or the analyse request's own id. A UUIDv7. */
  id: string;
  mealId: string;
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
  /** Client time of the capture (recording start, file picked, note added). */
  capturedAt: number;
  capture: PendingCapture;
}

/** "Analyse this meal once its captures are up": pressed while uploads were pending or offline. */
export interface AnalyseEntry extends EntryBase {
  type: "analyse";
}

export type OutboxEntry = CaptureEntry | AnalyseEntry;

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
}
