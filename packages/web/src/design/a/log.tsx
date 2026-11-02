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
  Trash2,
  Waves,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Capture, captures } from "@/design/mock";
import { Eyebrow, Rule } from "./ui";

const levels = [3, 6, 10, 14, 9, 16, 20, 12, 18, 22, 15, 8, 12, 17, 10, 6, 11, 15, 9, 4, 7, 12, 8, 5].map(
  (h, i) => ({ id: `l${i}`, h }),
);

export function Log({ state }: { state: "idle" | "recording" }) {
  const recording = state === "recording";
  return (
    <>
      <header className="flex items-end justify-between px-5 pt-5 pb-3">
        <div>
          <Eyebrow>New meal · 19:10</Eyebrow>
          <h1 className="display mt-1 text-[32px] leading-none">Log meal</h1>
        </div>
        <Link to="/design/a" className="-m-2 p-2 text-muted-foreground text-sm">
          Cancel
        </Link>
      </header>

      <main className="flex-1 pb-28">
        <section className="px-5 pt-4">
          <div className="flex flex-col items-center py-4">
            <Link
              to="/design/a/log"
              search={recording ? {} : { state: "recording" }}
              aria-label={recording ? "Stop recording" : "Start recording"}
              className={
                recording
                  ? "flex size-24 items-center justify-center rounded-full bg-destructive text-white"
                  : "flex size-24 items-center justify-center rounded-full border-2 border-foreground text-foreground active:bg-muted"
              }
            >
              {recording ? <Square className="size-8 fill-current" /> : <Mic className="size-9" />}
            </Link>
            {recording ? (
              <>
                <div className="display mt-4 text-[40px] leading-none">0:42</div>
                <div className="mt-3 flex h-6 items-end gap-[3px]" role="img" aria-label="input level">
                  {levels.map(({ id, h }, i) => (
                    <span
                      key={id}
                      className={i < 18 ? "w-[3px] bg-destructive" : "w-[3px] bg-border"}
                      style={{ height: h }}
                    />
                  ))}
                </div>
                <p className="mt-3 text-muted-foreground text-sm">Recording · tap to stop</p>
              </>
            ) : (
              <>
                <p className="mt-4 text-sm">Tap to record a voice memo</p>
                <p className="mt-1 text-muted-foreground text-sm">
                  German is fine. Say what you ate and roughly how much.
                </p>
              </>
            )}
          </div>
          <div className="flex items-start gap-2 border-border border-t border-b py-3 text-muted-foreground text-xs">
            <Lock className="mt-px size-3.5 shrink-0" />
            <p>
              Locking the phone stops the recording. For a long cooking memo, record in Voice Memos and attach
              the file below.
            </p>
          </div>
        </section>

        <section className="mt-6">
          <div className="flex items-baseline justify-between px-5 pb-2">
            <Eyebrow>Captures · {captures.length}</Eyebrow>
          </div>
          <Rule />
          {captures.map((c) => (
            <CaptureRow key={c.id} capture={c} />
          ))}
          <div className="grid grid-cols-4 gap-2 px-5 pt-4">
            {(
              [
                ["Photo", Camera],
                ["Note", NotebookPen],
                ["Link", Link2],
                ["File", Paperclip],
              ] as const
            ).map(([label, Icon]) => (
              <Button key={label} variant="outline" className="h-12 flex-col gap-0.5 rounded-sm text-xs">
                <Icon className="size-4" />
                {label}
              </Button>
            ))}
          </div>
        </section>
      </main>

      <footer className="fixed inset-x-0 bottom-0 mx-auto max-w-md bg-background/90 px-5 pt-3 pb-6 backdrop-blur">
        <Button size="lg" className="h-14 w-full rounded-sm text-base" disabled={recording}>
          <Waves className="size-5" /> Analyse
        </Button>
        <p className="mt-2 text-center text-muted-foreground text-xs">
          {recording ? "Stop the recording to analyse." : "2 uploads still running; analysis waits for them."}
        </p>
      </footer>
    </>
  );
}

function CaptureRow({ capture }: { capture: Capture }) {
  const uploading = "state" in capture && capture.state === "uploading";
  const progress = "progress" in capture ? capture.progress : undefined;
  return (
    <div className="flex min-h-14 items-center gap-3 border-border border-b px-5 py-2.5">
      <Thumb capture={capture} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{title(capture)}</div>
        <div className="mt-0.5 flex items-center gap-2 text-muted-foreground text-xs">
          <span className="truncate">{subtitle(capture)}</span>
        </div>
        {uploading && (
          <div className="mt-1.5 h-[3px] w-full bg-border">
            <div className="h-full bg-accent" style={{ width: `${progress ?? 0}%` }} />
          </div>
        )}
      </div>
      <button type="button" className="-m-2 p-2 text-muted-foreground" aria-label="Remove">
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

function Thumb({ capture }: { capture: Capture }) {
  if (capture.kind === "photo") {
    return (
      <div
        className="size-10 shrink-0 rounded-xs"
        style={{
          background: `linear-gradient(135deg, oklch(0.8 0.08 ${capture.hue}), oklch(0.55 0.1 ${capture.hue + 30}))`,
        }}
      />
    );
  }
  const icons: Record<Capture["kind"], LucideIcon> = {
    recording: Mic,
    audio: FileAudio,
    note: NotebookPen,
    link: Link2,
    photo: ImageIcon,
  };
  const Icon = icons[capture.kind];
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-xs border border-border text-muted-foreground">
      <Icon className="size-4" />
    </div>
  );
}

function title(c: Capture) {
  switch (c.kind) {
    case "recording":
      return `Voice memo · ${c.duration}`;
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
      return "Recorded here · uploaded";
    case "photo":
      return c.state === "uploading" ? `Uploading · ${c.progress}%` : "Uploaded";
    case "note":
      return "Text note";
    case "link":
      return c.url;
    case "audio":
      return c.state === "uploading"
        ? `${c.duration} · uploading · ${c.progress}%`
        : `${c.duration} · uploaded`;
  }
}
