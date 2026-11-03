/**
 * The in-app voice recorder's logic, free of the DOM so it can be tested: the state machine,
 * the container choice, the level computation and the duration format. `hooks/use-recorder.ts`
 * wires it to MediaRecorder, Web Audio and the wake lock.
 */

export type RecorderState =
  | { phase: "idle" }
  /** Waiting for the microphone permission / device. */
  | { phase: "requesting" }
  | { phase: "recording"; startedAt: number }
  /** Stop was pressed; the last chunk is being collected. */
  | { phase: "stopping"; startedAt: number }
  | { phase: "error"; error: string };

export type RecorderEvent =
  | { type: "start" }
  | { type: "granted"; at: number }
  | { type: "denied"; error: string }
  | { type: "stop" }
  | { type: "finished" }
  | { type: "failed"; error: string }
  | { type: "dismiss" };

/** Events that don't fit the current phase are ignored (a double tap, a late callback). */
export function recorderReducer(state: RecorderState, event: RecorderEvent): RecorderState {
  switch (event.type) {
    case "start":
      return state.phase === "idle" || state.phase === "error" ? { phase: "requesting" } : state;
    case "granted":
      return state.phase === "requesting" ? { phase: "recording", startedAt: event.at } : state;
    case "denied":
      return state.phase === "requesting" ? { phase: "error", error: event.error } : state;
    case "stop":
      return state.phase === "recording" ? { phase: "stopping", startedAt: state.startedAt } : state;
    case "finished":
      return state.phase === "stopping" || state.phase === "recording" ? { phase: "idle" } : state;
    case "failed":
      return state.phase === "idle" ? state : { phase: "error", error: event.error };
    case "dismiss":
      return state.phase === "error" ? { phase: "idle" } : state;
  }
}

export const isBusy = (s: RecorderState): boolean =>
  s.phase === "requesting" || s.phase === "recording" || s.phase === "stopping";

/**
 * The container to ask MediaRecorder for. iOS Safari records `audio/mp4` (AAC), which is what
 * Voice Memos produce too; Chromium and Firefox fall back to WebM/Ogg Opus. Null: let the
 * browser pick.
 */
export const MIME_CANDIDATES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

export function pickMimeType(isTypeSupported: (type: string) => boolean): string | null {
  return MIME_CANDIDATES.find((t) => isTypeSupported(t)) ?? null;
}

/** A file extension the server's type sniffing agrees with. */
export function extensionFor(mimeType: string): string {
  const base = mimeType.split(";")[0]!.trim().toLowerCase();
  if (base === "audio/mp4" || base === "audio/x-m4a" || base === "audio/aac") return "m4a";
  if (base === "audio/webm" || base === "video/webm") return "webm";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/wav" || base === "audio/x-wav") return "wav";
  return "audio";
}

/**
 * Loudness of one analyser frame (unsigned 8-bit time-domain samples around 128) as 0–1: the RMS,
 * scaled so speech fills most of the meter.
 */
export function levelOf(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) {
    const v = (s - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}

/** `0:42`, `12:05`, `1:02:03`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** The recording's file name: `voice-memo-2026-11-03-1910.m4a` (local time). */
export function recordingName(startedAt: number, mimeType: string): string {
  const d = new Date(startedAt);
  const p = (n: number) => String(n).padStart(2, "0");
  return `voice-memo-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${extensionFor(mimeType)}`;
}

/** Why the microphone couldn't start, in words the user can act on. */
export function micError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is off. Allow it for this app in Settings, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone found.";
  if (name === "NotReadableError") return "The microphone is busy in another app.";
  if (typeof MediaRecorder === "undefined") return "This browser can't record audio.";
  return `Recording failed: ${(e as Error)?.message ?? String(e)}`;
}
