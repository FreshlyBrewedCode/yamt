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
import { BigButton, Label } from "./ui";

const levels = [4, 8, 14, 20, 12, 24, 30, 18, 26, 32, 22, 10, 16, 24, 14, 8, 15, 21, 12, 6].map((h, i) => ({
  id: `l${i}`,
  h,
}));

export function Log({ state }: { state: "idle" | "recording" }) {
  const recording = state === "recording";
  return (
    <>
      <header className="flex items-start justify-between px-4 pt-5">
        <div>
          <Label>New meal · 19:10</Label>
          <h1 className="display mt-1 text-[40px]">Log meal</h1>
        </div>
        <Link
          to="/design/b"
          className="brick-flat flex size-12 items-center justify-center"
          aria-label="Cancel"
        >
          <X className="size-6" strokeWidth={2.5} />
        </Link>
      </header>

      <main className="flex-1 px-4 pb-32">
        <section
          className={
            recording ? "brick mt-5 bg-foreground p-4 text-background" : "brick mt-5 bg-background p-4"
          }
        >
          <div className="flex items-center gap-4">
            <Link
              to="/design/b/log"
              search={recording ? {} : { state: "recording" }}
              aria-label={recording ? "Stop recording" : "Start recording"}
              className={
                recording
                  ? "flex size-24 shrink-0 items-center justify-center rounded-full bg-(--lime) text-foreground"
                  : "flex size-24 shrink-0 items-center justify-center rounded-full border-[3px] border-foreground bg-(--lime) text-foreground"
              }
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
                  <Label className="text-(--lime)">● Recording</Label>
                  <div className="display mt-1 text-[56px]">0:42</div>
                </>
              ) : (
                <>
                  <Label>Voice memo</Label>
                  <div className="display mt-1 text-2xl">Tap, talk, done.</div>
                  <p className="mt-1 font-medium text-muted-foreground text-sm">
                    German works. Say what and how much.
                  </p>
                </>
              )}
            </div>
          </div>
          {recording && (
            <div className="mt-4 flex h-9 items-end gap-1" role="img" aria-label="input level">
              {levels.map(({ id, h }, i) => (
                <span
                  key={id}
                  className={i < 15 ? "flex-1 bg-(--lime)" : "flex-1 bg-background/30"}
                  style={{ height: h }}
                />
              ))}
            </div>
          )}
          <div
            className={
              recording
                ? "mt-4 flex items-start gap-2 border-t-[3px] border-background/30 pt-3 font-medium text-sm"
                : "mt-4 flex items-start gap-2 border-t-[3px] border-foreground pt-3 font-medium text-muted-foreground text-sm"
            }
          >
            <Lock className="mt-0.5 size-4 shrink-0" strokeWidth={2.5} />
            Locking the phone stops the recording. Long cooking memo? Record in Voice Memos, attach the file.
          </div>
        </section>

        <section className="mt-7">
          <div className="flex items-end justify-between border-foreground border-b-[3px] pb-2">
            <h2 className="display text-[26px]">Captures</h2>
            <Label className="text-muted-foreground">{captures.length} · 2 uploading</Label>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {captures.map((c) => (
              <CaptureTile key={c.id} capture={c} />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-4 gap-3">
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
                className="brick-flat flex h-16 flex-col items-center justify-center gap-1 bg-background font-bold text-xs uppercase active:bg-muted"
              >
                <Icon className="size-5" strokeWidth={2.5} />
                {label}
              </button>
            ))}
          </div>
        </section>
      </main>

      <footer className="fixed inset-x-0 bottom-0 mx-auto max-w-md bg-linear-to-t from-background from-55% to-transparent px-4 pt-8 pb-6">
        <BigButton className="brick h-[72px]" tone="ink" disabled={recording}>
          <Zap className="size-7 fill-current" strokeWidth={2.5} /> Analyse
        </BigButton>
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

function CaptureTile({ capture }: { capture: Capture }) {
  const uploading = capture.state === "uploading";
  const progress = "progress" in capture ? (capture.progress ?? 0) : 0;
  const Icon = icons[capture.kind];
  return (
    <div className="brick-flat relative flex min-h-16 items-center gap-3 overflow-hidden bg-background p-3">
      {uploading && (
        <div className="absolute inset-y-0 left-0 bg-(--lime)/40" style={{ width: `${progress}%` }} />
      )}
      <div className="relative">
        {capture.kind === "photo" ? (
          <div
            className="size-12 border-[3px] border-foreground"
            style={{
              background: `linear-gradient(135deg, oklch(0.85 0.1 ${capture.hue}), oklch(0.55 0.12 ${capture.hue + 30}))`,
            }}
          />
        ) : (
          <div className="flex size-12 items-center justify-center border-[3px] border-foreground">
            <Icon className="size-6" strokeWidth={2.5} />
          </div>
        )}
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="truncate font-bold">{title(capture)}</div>
        <Label className="mt-0.5 text-muted-foreground">{subtitle(capture)}</Label>
      </div>
      <button type="button" className="relative flex size-10 items-center justify-center" aria-label="Remove">
        <X className="size-5" strokeWidth={2.5} />
      </button>
    </div>
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
