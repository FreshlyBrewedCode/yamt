import { cn } from "cn";
import { Lock, Mic, Square } from "lucide-react";
import { LEVEL_BARS, type useRecorder } from "@/hooks/use-recorder";
import { formatDuration } from "@/lib/recorder";
import { Band, Label, SlabButton } from "./slab";

/**
 * The recorder (design: the ink slab of the capture screen, or tint when the meal's numbers are
 * the one thing): the lime record button, the timer, a level meter, and the note that locking
 * the phone stops a recording, always visible.
 */
export function RecorderBand({
  recorder,
  tone = "ink",
}: {
  recorder: ReturnType<typeof useRecorder>;
  tone?: "ink" | "tint";
}) {
  const { state, levels, elapsedMs, start, stop, dismiss } = recorder;
  const recording = state.phase === "recording" || state.phase === "stopping";
  const muted = tone === "ink" ? "text-ink-muted" : "text-muted-foreground";
  const line = tone === "ink" ? "border-ink-line" : "border-border";
  const bars = Array.from({ length: LEVEL_BARS }, (_, i) => levels[i - (LEVEL_BARS - levels.length)] ?? null);

  return (
    <Band tone={tone} className="px-5 pt-5 pb-4" aria-label="Voice memo">
      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={recording ? stop : () => void start()}
          disabled={state.phase === "requesting" || state.phase === "stopping"}
          aria-label={recording ? "Stop recording" : "Start recording"}
          className="flex size-24 shrink-0 items-center justify-center rounded-full bg-lime text-lime-foreground outline-none focus-visible:ring-4 focus-visible:ring-lime/50 active:opacity-80 disabled:opacity-60"
        >
          {recording ? (
            <Square className="size-9 fill-current" />
          ) : (
            <Mic className="size-11" strokeWidth={2.5} />
          )}
        </button>
        <div className="min-w-0 flex-1">
          {recording ? (
            <>
              <Label
                className={cn("flex items-center gap-2", tone === "ink" ? "text-lime" : "text-foreground")}
              >
                <span className="size-2.5 animate-pulse rounded-full bg-current" />
                {state.phase === "stopping" ? "Saving" : "Recording"}
              </Label>
              <div className="display mt-1 text-[60px]" data-testid="recording-time" role="timer">
                {formatDuration(elapsedMs)}
              </div>
            </>
          ) : (
            <>
              <Label className={muted}>Voice memo</Label>
              <div className="display mt-1 text-[26px]">
                {state.phase === "requesting" ? "Starting…" : "Tap, talk, done."}
              </div>
              <p className={cn("mt-1.5 font-medium text-sm", muted)}>German works. Say what and how much.</p>
            </>
          )}
        </div>
      </div>

      {recording && (
        <div className="mt-5 flex h-9 items-end gap-1" role="img" aria-label="Input level">
          {bars.map((level, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed slots of the meter
              key={i}
              className={cn(
                "flex-1",
                level === null
                  ? tone === "ink"
                    ? "bg-ink-line"
                    : "bg-border"
                  : tone === "ink"
                    ? "bg-lime"
                    : "bg-foreground",
              )}
              style={{ height: `${level === null ? 6 : Math.max(4, Math.round(level * 36))}px` }}
            />
          ))}
        </div>
      )}

      {state.phase === "error" && (
        <div
          className="-mx-5 mt-4 flex items-center gap-3 bg-orange px-5 py-3 text-orange-foreground"
          role="alert"
        >
          <p className="flex-1 font-bold text-sm">{state.error}</p>
          <SlabButton
            tone="ghost"
            className="h-11 w-auto px-2 text-sm underline underline-offset-4"
            onClick={dismiss}
          >
            OK
          </SlabButton>
        </div>
      )}

      <p className={cn("mt-4 flex items-start gap-2 border-t pt-3 font-medium text-sm", line, muted)}>
        <Lock className="mt-0.5 size-4 shrink-0" strokeWidth={2.5} />
        Locking the phone or leaving the app stops the recording. Long cooking memo? Record in Voice Memos and
        attach the file.
      </p>
    </Band>
  );
}
