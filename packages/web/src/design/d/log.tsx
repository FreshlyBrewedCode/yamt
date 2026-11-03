import { Link } from "@tanstack/react-router";
import {
  Camera,
  FileAudio,
  Image as ImageIcon,
  Link2,
  Lock,
  type LucideIcon,
  Mic,
  NotebookPen,
  Paperclip,
  Square,
  X,
  Zap,
} from "lucide-react";
import { type Capture, captures } from "@/design/mock";
import { Band, BlockButton, Label, Strip } from "./ui";

const levels = [4, 8, 14, 20, 12, 24, 30, 18, 26, 32, 22, 10, 16, 24, 14, 8, 15, 21, 12, 6, 10, 18].map(
  (h, i) => ({ id: `l${i}`, h }),
);

export function Log({ state }: { state: "idle" | "recording" }) {
  const recording = state === "recording";
  return (
    <>
      <header className="flex items-end justify-between px-5 pt-5 pb-4">
        <div>
          <Label className="text-muted-foreground">New meal · 19:10</Label>
          <h1 className="display mt-1 text-[36px]">Log meal</h1>
        </div>
        <Link
          to="/design/d"
          className="band-tint flex size-12 items-center justify-center active:opacity-70"
          aria-label="Cancel"
        >
          <X className="size-6" strokeWidth={2.5} />
        </Link>
      </header>

      <main className="flex-1">
        {/* The recorder is the one thing on this screen: an ink slab with the lime button. */}
        <Band tone="ink" className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-5">
            <Link
              to="/design/d/log"
              search={recording ? {} : { state: "recording" }}
              aria-label={recording ? "Stop recording" : "Start recording"}
              className="band-lime flex size-24 shrink-0 items-center justify-center rounded-full active:opacity-80"
            >
              {recording ? (
                <Square className="size-9 fill-current" />
              ) : (
                <Mic className="size-11" strokeWidth={2.5} />
              )}
            </Link>
            <div className="min-w-0 flex-1">
              {recording ? (
                <>
                  <Label className="flex items-center gap-2 text-(--lime)">
                    <span className="size-2.5 animate-pulse rounded-full bg-current" /> Recording
                  </Label>
                  <div className="display mt-1 text-[60px]">0:42</div>
                </>
              ) : (
                <>
                  <Label className="text-(--ink-muted)">Voice memo</Label>
                  <div className="display mt-1 text-[26px]">Tap, talk, done.</div>
                  <p className="mt-1.5 font-medium text-(--ink-muted) text-sm">
                    German works. Say what and how much.
                  </p>
                </>
              )}
            </div>
          </div>
          {recording && (
            <div className="mt-5 flex h-9 items-end gap-1" role="img" aria-label="input level">
              {levels.map(({ id, h }, i) => (
                <span
                  key={id}
                  className={i < 16 ? "flex-1 bg-(--lime)" : "flex-1 bg-(--ink-line)"}
                  style={{ height: h }}
                />
              ))}
            </div>
          )}
          <div className="mt-4 flex items-start gap-2 border-(--ink-line) border-t pt-3 font-medium text-(--ink-muted) text-sm">
            <Lock className="mt-0.5 size-4 shrink-0" strokeWidth={2.5} />
            Locking the phone stops the recording. Long cooking memo? Record in Voice Memos, attach the file.
          </div>
        </Band>

        {/* Add more: a tinted strip of four equal targets. */}
        <div className="grid grid-cols-4 divide-x divide-border border-border border-b">
          {(
            [
              ["Photo", Camera],
              ["Note", NotebookPen],
              ["Link", Link2],
              ["File", Paperclip],
            ] as const
          ).map(([label, Icon]) => (
            <button
              key={label}
              type="button"
              className="flex h-[68px] flex-col items-center justify-center gap-1 font-bold text-xs uppercase tracking-[0.08em] active:bg-(--lime)"
            >
              <Icon className="size-6" strokeWidth={2.5} />
              {label}
            </button>
          ))}
        </div>

        <Strip title="Captures" meta={`${captures.length} · 2 uploading`} />
        <ul className="divide-y divide-border">
          {captures.map((c) => (
            <CaptureRow key={c.id} capture={c} />
          ))}
        </ul>
      </main>

      <footer className="sticky bottom-0">
        <BlockButton className="h-[76px] text-2xl" tone="ink" disabled={recording}>
          <Zap className="size-7 fill-current" strokeWidth={2.5} /> Analyse
        </BlockButton>
      </footer>
    </>
  );
}

const icons: Record<Capture["kind"], LucideIcon> = {
  recording: Mic,
  audio: FileAudio,
  note: NotebookPen,
  link: Link2,
  photo: ImageIcon,
};

function CaptureRow({ capture }: { capture: Capture }) {
  const uploading = capture.state === "uploading";
  const progress = "progress" in capture ? (capture.progress ?? 0) : 0;
  const Icon = icons[capture.kind];
  return (
    <li className="relative flex min-h-[68px] items-center gap-4 overflow-hidden px-5 py-2.5">
      {uploading && (
        <div className="absolute inset-y-0 left-0 bg-(--lime-soft)" style={{ width: `${progress}%` }} />
      )}
      <div className="relative shrink-0">
        {capture.kind === "photo" ? (
          <div
            className="size-12"
            style={{
              background: `linear-gradient(135deg, oklch(0.85 0.1 ${capture.hue}), oklch(0.55 0.12 ${capture.hue + 30}))`,
            }}
          />
        ) : (
          <div className="band-tint flex size-12 items-center justify-center">
            <Icon className="size-6" strokeWidth={2.5} />
          </div>
        )}
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="truncate font-bold">{title(capture)}</div>
        <Label className="mt-0.5 truncate text-muted-foreground">{subtitle(capture)}</Label>
      </div>
      <button
        type="button"
        className="relative -mr-2 flex size-11 items-center justify-center text-muted-foreground"
        aria-label="Remove"
      >
        <X className="size-5" strokeWidth={2.5} />
      </button>
    </li>
  );
}

function title(c: Capture) {
  switch (c.kind) {
    case "recording":
      return `Voice memo ${c.duration}`;
    case "photo":
      return c.label;
    case "note":
      return c.text;
    case "link":
      return c.title;
    case "audio":
      return c.name;
  }
}

function subtitle(c: Capture) {
  switch (c.kind) {
    case "recording":
      return "Uploaded";
    case "photo":
      return c.state === "uploading" ? `Uploading ${c.progress}%` : "Uploaded";
    case "note":
      return "Note";
    case "link":
      return c.url;
    case "audio":
      return c.state === "uploading" ? `${c.duration} · uploading ${c.progress}%` : c.duration;
  }
}
