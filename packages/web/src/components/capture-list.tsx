import { type Capture, isVoice, type MealDetailResponse, mealPaths, type Transcript } from "@yamt/shared";
import { cn } from "cn";
import {
  FileAudio,
  File as FileIcon,
  Link2,
  type LucideIcon,
  MessageCircleReply,
  Mic,
  NotebookPen,
  Pause,
  PencilLine,
  Play,
  RotateCw,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { shortUrl } from "@/lib/format";
import { type CaptureEntry, type OutboxSnapshot, outbox } from "@/lib/outbox";
import { useRetract, useRetranscribe } from "@/lib/queries";
import { formatDuration } from "@/lib/recorder";
import { Label } from "./slab";

/** One line of the capture list: a capture the server has, or one still on this phone. */
export interface CaptureRow {
  key: string;
  kind: Capture["kind"];
  /** Speech with playback: a voice memo, or a spoken answer or correction. */
  voice: boolean;
  title: string;
  subtitle: string;
  /** Image thumbnail or audio source. */
  src: string | null;
  durationMs: number | null;
  /** On this phone: `queued` (waiting its turn or the network), `sending`, `refused` by the server. */
  upload: "done" | "queued" | "sending" | "refused";
  progress: number;
  onRemove?: () => void;
  onRetry?: () => void;
  /** What `onRetry` does, for its label: the upload (default) or the transcription. */
  retry?: "upload" | "transcription";
}

const icons: Record<Capture["kind"], LucideIcon> = {
  audio: Mic,
  image: FileIcon,
  text: NotebookPen,
  link: Link2,
  file: FileIcon,
  correction: PencilLine,
  answer: MessageCircleReply,
};

const kindName: Record<"answer" | "correction", string> = { answer: "Answer", correction: "Correction" };

/** Rows for the server's live captures, oldest first. */
export function serverRows(
  captures: Capture[],
  transcripts: Transcript[],
): (Omit<CaptureRow, "onRemove"> & { transcriptFailed?: boolean })[] {
  const tOf = new Map(transcripts.map((t) => [t.captureId, t]));
  return captures
    .filter((c) => c.retractedAt === null)
    .map((c) => {
      const t = tOf.get(c.id);
      const base = {
        key: c.id,
        kind: c.kind,
        voice: false,
        upload: "done" as const,
        progress: 1,
        durationMs: null,
        src: null,
      };
      if (isVoice(c)) {
        const durationMs = t?.durationMs ?? null;
        const spoken = c.kind === "answer" || c.kind === "correction" ? kindName[c.kind] : null;
        const heard =
          t?.status === "done"
            ? t.text?.trim()
              ? `“${t.text.trim()}”`
              : "Transcribed: no speech"
            : t?.status === "failed"
              ? "Transcription failed"
              : "Uploaded · transcribing…";
        return {
          ...base,
          voice: true,
          title: spoken
            ? `Spoken ${spoken.toLowerCase()}${durationMs !== null ? ` ${formatDuration(durationMs)}` : ""}`
            : audioTitle(c.fileName, durationMs),
          subtitle: heard,
          src: mealPaths.media(c.id),
          durationMs,
          transcriptFailed: t?.status === "failed",
        };
      }
      switch (c.kind) {
        case "image":
          return {
            ...base,
            title: c.fileName ?? "Photo",
            subtitle: "Photo",
            src:
              c.jpegDerivative === "ok"
                ? mealPaths.mediaJpeg(c.id)
                : c.jpegDerivative === "missing"
                  ? null
                  : mealPaths.media(c.id),
          };
        case "link":
          return { ...base, title: c.text ?? shortUrl(c.url ?? ""), subtitle: shortUrl(c.url ?? "") };
        case "file":
          return { ...base, title: c.fileName ?? "File", subtitle: "File" };
        default:
          return {
            ...base,
            title: c.text ?? "",
            subtitle: c.kind === "text" ? "Note" : c.kind === "correction" ? "Correction" : "Answer",
          };
      }
    });
}

/** Rows for captures still on this phone. `urls` holds object URLs for their blobs. */
export function pendingRows(
  entries: CaptureEntry[],
  state: { progress: Readonly<Record<string, number>>; sending: string | null; online: boolean },
  urls: Map<string, string>,
): Omit<CaptureRow, "onRemove" | "onRetry">[] {
  return entries.map((e) => {
    const c = e.capture;
    const sending = state.sending === e.id;
    const progress = state.progress[e.id] ?? 0;
    const upload = e.failed ? "refused" : sending ? "sending" : "queued";
    const status = e.failed
      ? `Refused: ${e.error ?? "unknown error"}`
      : sending
        ? "blob" in c
          ? `Uploading ${Math.round(progress * 100)}%`
          : "Sending…"
        : !state.online
          ? "Waiting for network"
          : e.attempts > 0
            ? "Waiting to retry"
            : "Queued";
    const base = {
      key: e.id,
      kind: c.kind,
      voice: false,
      upload,
      progress,
      src: null,
      durationMs: null,
    } as const;
    if ("blob" in c) {
      if (c.kind === "image")
        return { ...base, title: c.fileName, subtitle: status, src: urls.get(e.id) ?? null };
      if (c.kind === "file") return { ...base, title: c.fileName, subtitle: status };
      const durationMs = c.durationMs ?? null;
      return {
        ...base,
        voice: true,
        title:
          c.kind === "audio"
            ? audioTitle(c.fileName, durationMs)
            : `Spoken ${kindName[c.kind].toLowerCase()}${durationMs !== null ? ` ${formatDuration(durationMs)}` : ""}`,
        subtitle: status,
        src: urls.get(e.id) ?? null,
        durationMs,
      };
    }
    if (c.kind === "link") return { ...base, title: c.text || shortUrl(c.url), subtitle: status };
    return { ...base, title: c.text, subtitle: status };
  });
}

const audioTitle = (fileName: string | null, durationMs: number | null) => {
  const recorded = !fileName || fileName.startsWith("voice-memo-");
  const name = recorded ? "Voice memo" : fileName;
  return durationMs !== null ? `${name} ${formatDuration(durationMs)}` : name;
};

/**
 * The rows of a meal's captures: the server's live ones (remove = retract; a failed transcript
 * can be run again) and those still in the upload queue (discard, retry a refused one), merged
 * by id so nothing blinks while an upload lands.
 */
export function useCaptureRows(
  mealId: string,
  detail: MealDetailResponse | null,
  captureEntries: CaptureEntry[],
  snapshot: OutboxSnapshot,
  onProblem: (message: string) => void,
): CaptureRow[] {
  const retract = useRetract(mealId);
  const retranscribe = useRetranscribe(mealId);
  const urls = useBlobUrls(captureEntries);
  const serverIds = new Set(detail?.captures.map((c) => c.id));
  return [
    ...serverRows(detail?.captures ?? [], detail?.transcripts ?? []).map(({ transcriptFailed, ...r }) => ({
      ...r,
      onRemove: () =>
        retract.mutate(r.key, { onError: (e) => onProblem(`Couldn't remove it: ${e.message}`) }),
      ...(transcriptFailed
        ? {
            retry: "transcription" as const,
            onRetry: () =>
              retranscribe.mutate(r.key, {
                onError: (e) => onProblem(`Couldn't transcribe it again: ${e.message}`),
              }),
          }
        : {}),
    })),
    ...pendingRows(
      captureEntries.filter((e) => !serverIds.has(e.id)),
      snapshot,
      urls,
    ).map((r) => ({
      ...r,
      onRemove: () => void outbox.discard(r.key),
      onRetry: r.upload === "refused" ? () => void outbox.retry(r.key) : undefined,
    })),
  ];
}

/** Object URLs for the blobs of pending image and audio captures, revoked when they go. */
export function useBlobUrls(entries: CaptureEntry[]): Map<string, string> {
  const cache = useRef(new Map<string, string>());
  const urls = useMemo(() => {
    const next = new Map<string, string>();
    for (const e of entries) {
      const c = e.capture;
      if (!("blob" in c) || c.kind === "file") continue;
      next.set(e.id, cache.current.get(e.id) ?? URL.createObjectURL(c.blob));
    }
    for (const [id, url] of cache.current) if (!next.has(id)) URL.revokeObjectURL(url);
    cache.current = next;
    return next;
  }, [entries]);
  useEffect(
    () => () => {
      for (const url of cache.current.values()) URL.revokeObjectURL(url);
      cache.current = new Map();
    },
    [],
  );
  return urls;
}

/** The capture list (plain, with dividers): thumbnail or icon, title, status, remove. */
export function CaptureList({ rows }: { rows: CaptureRow[] }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);

  const toggle = (row: CaptureRow) => {
    const el = audio.current;
    if (!el || !row.src) return;
    if (playing === row.key) {
      el.pause();
      setPlaying(null);
      return;
    }
    el.src = row.src;
    void el.play().then(
      () => setPlaying(row.key),
      () => setPlaying(null),
    );
  };

  return (
    <>
      {/* biome-ignore lint/a11y/useMediaCaption: voice memos of meals; the transcript is the caption */}
      <audio ref={audio} onEnded={() => setPlaying(null)} onPause={() => setPlaying(null)} hidden />
      <ul className="divide-y divide-border" data-testid="capture-list">
        {rows.map((row) => (
          <Row key={row.key} row={row} playing={playing === row.key} onPlay={() => toggle(row)} />
        ))}
      </ul>
    </>
  );
}

function Row({ row, playing, onPlay }: { row: CaptureRow; playing: boolean; onPlay: () => void }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);
  const refused = row.upload === "refused";
  const Icon =
    row.kind === "audio" && row.upload === "done" ? Mic : row.kind === "audio" ? FileAudio : icons[row.kind];
  const retryLabel = row.retry === "transcription" ? "Transcribe again" : "Retry upload";

  return (
    <li
      className={cn(
        "relative flex min-h-[68px] items-center gap-4 overflow-hidden px-5 py-2.5",
        refused && "bg-orange text-orange-foreground",
      )}
      data-testid="capture-row"
      data-upload={row.upload}
      data-kind={row.kind}
    >
      {row.upload === "sending" && (
        <div
          className="absolute inset-y-0 left-0 bg-lime-soft transition-[width]"
          style={{ width: `${row.progress * 100}%` }}
        />
      )}
      <div className="relative shrink-0">
        {row.kind === "image" && row.src ? (
          <img src={row.src} alt="" className="size-12 object-cover" loading="lazy" />
        ) : row.voice && row.src ? (
          <button
            type="button"
            onClick={onPlay}
            aria-label={playing ? "Pause" : "Play"}
            className={cn(
              "flex size-12 items-center justify-center active:opacity-70",
              playing ? "bg-lime text-lime-foreground" : "bg-tint",
            )}
          >
            {playing ? (
              <Pause className="size-6 fill-current" />
            ) : (
              <Play className="size-6" strokeWidth={2.5} />
            )}
          </button>
        ) : (
          <div
            className={cn(
              "flex size-12 items-center justify-center",
              refused ? "bg-orange-foreground/10" : "bg-tint",
            )}
          >
            <Icon className="size-6" strokeWidth={2.5} />
          </div>
        )}
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="truncate font-bold">{row.title}</div>
        <Label
          className={cn("mt-0.5 truncate", refused ? "normal-case tracking-normal" : "text-muted-foreground")}
          data-testid="capture-status"
        >
          {row.subtitle}
        </Label>
      </div>
      {row.onRetry && (
        <button
          type="button"
          onClick={row.onRetry}
          aria-label={retryLabel}
          className="relative flex size-11 items-center justify-center active:opacity-70"
        >
          <RotateCw className="size-5" strokeWidth={2.5} />
        </button>
      )}
      {row.onRemove &&
        (confirming ? (
          <button
            type="button"
            onClick={row.onRemove}
            className="relative -mr-2 h-11 bg-foreground px-3 font-bold text-background text-xs uppercase tracking-[0.08em]"
          >
            {row.upload === "done" ? "Remove" : "Discard"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={row.upload === "sending"}
            aria-label={row.upload === "done" ? "Remove capture" : "Discard upload"}
            className={cn(
              "relative -mr-2 flex size-11 items-center justify-center disabled:opacity-30",
              !refused && "text-muted-foreground",
            )}
          >
            <X className="size-5" strokeWidth={2.5} />
          </button>
        ))}
    </li>
  );
}
