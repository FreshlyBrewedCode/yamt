import type { Transcript, TranscriptSegment } from "@yamt/shared";

/**
 * The speech-to-text backend: one call per batch of normalised files (16 kHz mono WAV). The only
 * implementation is `LocalWhisperBackend` (faster-whisper on this VM's CPU, spike #4); an HTTP
 * backend for the GPU host's OpenAI-style `/v1/audio/transcriptions` would be a second one.
 */
export interface SttBackend {
  /** For the startup line, e.g. `faster-whisper large-v3-turbo int8, 4 threads, VAD`. */
  describe(): string;
  /** Resolves when the batch is over; results arrive through `onResult` as they finish. */
  transcribe(items: SttItem[], opts: SttBatchOptions): Promise<SttBatchEnd>;
}

export interface SttItem {
  /** The capture id. */
  id: string;
  /** The normalised WAV. */
  path: string;
}

export interface SttBatchOptions {
  /** Server stop: end the batch now; unfinished items are run again later. */
  signal: AbortSignal;
  onResult(id: string, result: SttResult): void;
}

export type SttResult =
  | {
      ok: true;
      text: string;
      language: string | null;
      durationMs: number | null;
      segments: TranscriptSegment[];
      model: string;
      elapsedMs: number | null;
      settings: Transcript["settings"];
    }
  | { ok: false; error: string };

/** How the batch ended; items without a result take this error (or are run again when aborted). */
export type SttBatchEnd =
  | { status: "ok" }
  | { status: "aborted" }
  | { status: "error"; error: string; retryable: boolean };
