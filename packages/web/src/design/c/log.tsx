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
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Capture, captures } from "@/design/mock";
import { Card, SectionTitle } from "./ui";

const levels = [6, 10, 16, 22, 14, 26, 30, 18, 24, 28, 20, 12, 16, 22, 14, 8, 13, 19, 11, 6].map((h, i) => ({
  id: `l${i}`,
  h,
}));

export function Log({ state }: { state: "idle" | "recording" }) {
  const recording = state === "recording";
  return (
    <>
      <header className="flex items-center justify-between px-5 pt-6">
        <div>
          <p className="font-semibold text-muted-foreground text-sm">New meal · 19:10</p>
          <h1 className="display mt-0.5 text-[30px]">Log meal</h1>
        </div>
        <Link
          to="/design/c"
          className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground"
          aria-label="Cancel"
        >
          <X className="size-5" strokeWidth={2.5} />
        </Link>
      </header>

      <main className="flex flex-1 flex-col gap-6 px-4 pt-4 pb-36">
        <Card className={recording ? "bg-(--coral-soft) p-5" : "p-5"}>
          <div className="flex flex-col items-center">
            <Link
              to="/design/c/log"
              search={recording ? {} : { state: "recording" }}
              aria-label={recording ? "Stop recording" : "Start recording"}
              className={
                recording
                  ? "flex size-28 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_0_14px_var(--coral-soft),0_0_0_28px_oklch(0.68_0.16_35/0.12)] active:scale-95"
                  : "flex size-28 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_12px_30px_-8px_var(--primary)] active:scale-95"
              }
            >
              {recording ? (
                <Square className="size-10 fill-current" />
              ) : (
                <Mic className="size-12" strokeWidth={2.25} />
              )}
            </Link>
            {recording ? (
              <>
                <div className="display mt-6 text-[44px] leading-none">0:42</div>
                <div className="mt-4 flex h-8 items-center gap-1" role="img" aria-label="input level">
                  {levels.map(({ id, h }, i) => (
                    <span
                      key={id}
                      className={
                        i < 15 ? "w-1.5 rounded-full bg-primary" : "w-1.5 rounded-full bg-primary/25"
                      }
                      style={{ height: h }}
                    />
                  ))}
                </div>
                <p className="mt-3 font-semibold text-muted-foreground text-sm">Listening… tap to stop</p>
              </>
            ) : (
              <>
                <p className="display mt-5 text-lg">Tap and tell me what you ate</p>
                <p className="mt-1 text-center font-semibold text-muted-foreground text-sm">
                  German is fine. Rough amounts help.
                </p>
              </>
            )}
          </div>
          <div className="mt-5 flex items-start gap-2.5 rounded-2xl bg-muted/70 px-3.5 py-3 font-semibold text-muted-foreground text-xs">
            <Lock className="mt-px size-4 shrink-0" strokeWidth={2.5} />
            Locking the phone stops the recording. For long cooking memos, record in Voice Memos and attach
            the file.
          </div>
        </Card>

        <section>
          <SectionTitle aside="2 uploading">Captures · {captures.length}</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            {captures.map((c) => (
              <CaptureTile key={c.id} capture={c} />
            ))}
          </div>
          <div className="mt-4 flex justify-around">
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
                className="flex flex-col items-center gap-1.5 font-bold text-xs"
              >
                <span className="flex size-14 items-center justify-center rounded-full bg-card shadow-[0_2px_10px_-4px_oklch(0.3_0.03_160/0.3)] active:bg-muted">
                  <Icon className="size-6" strokeWidth={2.25} />
                </span>
                {label}
              </button>
            ))}
          </div>
        </section>
      </main>

      <footer className="fixed inset-x-0 bottom-0 mx-auto max-w-md bg-linear-to-t from-background from-60% to-transparent px-4 pt-8 pb-6">
        <Button
          size="lg"
          className="h-16 w-full rounded-full font-bold text-lg shadow-[0_10px_24px_-6px_var(--primary)]"
          disabled={recording}
        >
          <Sparkles className="size-5" strokeWidth={2.5} /> Analyse
        </Button>
        <p className="mt-2 text-center font-semibold text-muted-foreground text-xs">
          {recording
            ? "Stop the recording first."
            : "Waits for the two uploads, then runs in the background."}
        </p>
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
  const photo = capture.kind === "photo";
  return (
    <Card className="relative flex min-h-[96px] flex-col justify-between overflow-hidden p-3">
      {photo && (
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, oklch(0.85 0.08 ${capture.hue}), oklch(0.55 0.1 ${capture.hue + 30}))`,
          }}
        />
      )}
      <div className="relative flex items-start justify-between">
        <span
          className={
            photo
              ? "flex size-8 items-center justify-center rounded-full bg-white/75 text-neutral-900"
              : "flex size-8 items-center justify-center rounded-full bg-(--sage-soft) text-accent"
          }
        >
          <Icon className="size-4" strokeWidth={2.5} />
        </span>
        {uploading ? (
          <MiniRing progress={progress} />
        ) : (
          <button type="button" className="-m-1 p-1 text-muted-foreground" aria-label="Remove">
            <X className="size-4" strokeWidth={2.5} />
          </button>
        )}
      </div>
      <div
        className={
          photo
            ? "relative mt-6 rounded-xl bg-white/85 px-2 py-1 text-neutral-900 [&_div:last-child]:text-neutral-600"
            : "relative mt-3"
        }
      >
        <div className="truncate font-bold text-sm">{title(capture)}</div>
        <div className="truncate font-semibold text-muted-foreground text-xs">{subtitle(capture)}</div>
      </div>
    </Card>
  );
}

function MiniRing({ progress }: { progress: number }) {
  const r = 11;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative flex size-8 items-center justify-center rounded-full bg-white/85 text-neutral-900">
      <svg width={28} height={28} className="-rotate-90" role="img" aria-label={`${progress}%`}>
        <circle cx={14} cy={14} r={r} fill="none" stroke="var(--muted)" strokeWidth={3} />
        <circle
          cx={14}
          cy={14}
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={`${(c * progress) / 100} ${c}`}
        />
      </svg>
      <span className="absolute font-bold text-[9px]">{progress}</span>
    </span>
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
      return "Uploaded";
    case "photo":
      return c.state === "uploading" ? "Uploading…" : "Uploaded";
    case "note":
      return "Note";
    case "link":
      return c.url;
    case "audio":
      return c.state === "uploading" ? `${c.duration} · uploading…` : c.duration;
  }
}
