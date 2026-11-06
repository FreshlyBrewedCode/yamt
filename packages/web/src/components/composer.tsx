// The planning composer (#47, G's dock): plus (photo, file, audio file, link, paste), a text field,
// the mic (records into a voice chip, transcribed later on the server) and a lime send square once
// there is something to send, docked at the bottom of the entry screen and the request thread.
// What it holds is a draft (`lib/plan-draft`); sending hands it to the upload queue.
import { cn } from "cn";
import {
  Camera,
  ClipboardPaste,
  FileAudio,
  FileText,
  Link2,
  type LucideIcon,
  Mic,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import type * as React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Recording, useRecorder } from "@/hooks/use-recorder";
import { type PasteFallback, pasteFromClipboard } from "@/lib/clipboard";
import { shortUrl } from "@/lib/format";
import { uuidv7 } from "@/lib/ids";
import { CaptureRejected, checkCapture, type PendingCapture, type PendingPlanningInput } from "@/lib/outbox";
import { type Attachment, type ComposerDraft, hasContent, useDraft } from "@/lib/plan-draft";
import { formatDuration, recordingName } from "@/lib/recorder";
import { CaptureSheet, LinkSheet, PasteSheet } from "./add-strip";
import { Label } from "./slab";

/**
 * How far the on-screen keyboard reaches into the layout viewport (0 without one): iOS keeps the
 * layout viewport and shrinks the visual one, so a sticky footer would sit behind the keyboard.
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

/**
 * The dock: the sticky footer on the page colour with what sits above the composer (the filter
 * summary) and the composer, clear of the home indicator, and above the keyboard while it is up.
 */
export function Dock({ above, children }: { above?: React.ReactNode; children: React.ReactNode }) {
  const keyboard = useKeyboardInset();
  return (
    <footer
      className="sticky bottom-0 z-10 bg-background"
      style={keyboard > 0 ? { bottom: keyboard } : undefined}
      data-testid="dock"
    >
      {above}
      <div className={cn("pt-2", keyboard > 0 ? "pb-2" : "pb-[max(8px,env(safe-area-inset-bottom))]")}>
        {children}
      </div>
    </footer>
  );
}

/** What a file is as a planning input. */
const kindOf = (f: File): "image" | "audio" | "file" =>
  f.type.startsWith("image/") ? "image" : f.type.startsWith("audio/") ? "audio" : "file";

/** A capture the paste found, as a planning input (answers and corrections don't exist here). */
function asInput(c: PendingCapture): PendingPlanningInput | null {
  if (c.kind === "text" || c.kind === "link") return c;
  if ("blob" in c && (c.kind === "audio" || c.kind === "image" || c.kind === "file")) {
    const { kind, blob, fileName, mimeType, durationMs } = c;
    return { kind, blob, fileName, mimeType, ...(durationMs ? { durationMs } : {}) };
  }
  return null;
}

/**
 * The composer: attachments above the row, then plus, the field (growing to five lines), the mic
 * and the lime send square. `sendLabel` names what sending does ("Suggest", "Send"); `onSend`
 * gets the draft (and is expected to clear it). `blocked` keeps send disabled with a reason
 * shown by the caller.
 */
export function Composer({
  draftKey,
  placeholder,
  sendLabel,
  onSend,
  blocked = false,
}: {
  draftKey: string;
  placeholder: string;
  sendLabel: string;
  onSend: (draft: ComposerDraft) => void;
  blocked?: boolean;
}) {
  const [draft, setDraft] = useDraft(draftKey);
  const [attach, setAttach] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const add = (input: PendingPlanningInput, capturedAt = Date.now(), durationMs?: number) => {
    try {
      checkCapture(input);
    } catch (e) {
      setProblem(e instanceof CaptureRejected ? e.message : String(e));
      return;
    }
    setProblem(null);
    const a: Attachment = { id: uuidv7(), input, capturedAt, ...(durationMs ? { durationMs } : {}) };
    setDraft((d) => ({ ...d, attachments: [...d.attachments, a] }));
  };

  const recorder = useRecorder((r: Recording) =>
    add(
      {
        kind: "audio",
        blob: r.blob,
        fileName: recordingName(r.startedAt, r.mimeType),
        mimeType: r.mimeType,
        durationMs: r.durationMs,
      },
      r.startedAt,
      r.durationMs,
    ),
  );
  const recording = recorder.state.phase === "recording" || recorder.state.phase === "stopping";

  // the field grows with its text, up to five lines
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measured whenever the text changes
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 136)}px`;
  }, [draft.text]);

  const can = hasContent(draft) && !recording && !blocked;
  const square =
    "flex size-12 shrink-0 items-center justify-center bg-tint outline-none active:opacity-70 focus-visible:ring-4 focus-visible:ring-foreground/30";

  return (
    <div data-testid="composer">
      {(problem || recorder.state.phase === "error") && (
        <div
          className="mx-5 mb-2 flex items-center gap-3 bg-orange px-4 py-2 text-orange-foreground"
          role="alert"
        >
          <p className="flex-1 font-bold text-sm">
            {problem ?? (recorder.state.phase === "error" ? recorder.state.error : "")}
          </p>
          <button
            type="button"
            onClick={() => {
              setProblem(null);
              recorder.dismiss();
            }}
            aria-label="Dismiss"
            className="flex size-11 items-center justify-center"
          >
            <X className="size-5" strokeWidth={2.5} />
          </button>
        </div>
      )}
      {draft.attachments.length > 0 && (
        <ul
          className="flex gap-0.5 overflow-x-auto px-5 pb-2 [scrollbar-width:none]"
          data-testid="attachments"
          aria-label="Attached"
        >
          {draft.attachments.map((a) => (
            <AttachmentChip
              key={a.id}
              a={a}
              onRemove={() =>
                setDraft((d) => ({ ...d, attachments: d.attachments.filter((x) => x.id !== a.id) }))
              }
            />
          ))}
        </ul>
      )}
      <div className="flex items-end gap-0.5 px-5">
        <button
          type="button"
          onClick={() => setAttach(true)}
          aria-label="Attach"
          className={square}
          disabled={recording}
        >
          <Plus className="size-6" strokeWidth={2.5} />
        </button>
        {recording ? (
          <div
            className="flex min-h-12 min-w-0 flex-1 items-center gap-2 bg-lime-soft px-4 font-bold"
            role="timer"
            data-testid="composer-recording"
          >
            <span className="size-2.5 animate-pulse rounded-full bg-current" />
            {recorder.state.phase === "stopping" ? "Saving…" : "Recording"}
            <span className="ml-auto tabular-nums">{formatDuration(recorder.elapsedMs)}</span>
          </div>
        ) : (
          <textarea
            ref={field}
            value={draft.text}
            onChange={(e) => {
              const text = e.target.value;
              setDraft((d) => ({ ...d, text }));
            }}
            placeholder={placeholder}
            aria-label="What you fancy"
            rows={1}
            enterKeyHint="send"
            className="min-h-12 min-w-0 flex-1 resize-none bg-tint px-4 py-3 font-medium text-base leading-snug outline-none placeholder:text-muted-foreground focus:bg-lime-soft"
            data-testid="composer-field"
          />
        )}
        <button
          type="button"
          onClick={recording ? recorder.stop : () => void recorder.start()}
          disabled={recorder.state.phase === "requesting" || recorder.state.phase === "stopping"}
          aria-label={recording ? "Stop recording" : "Record a voice memo"}
          className={cn(square, recording && "bg-lime text-lime-foreground")}
          data-testid="composer-mic"
        >
          {recording ? <span className="size-5 bg-current" /> : <Mic className="size-6" strokeWidth={2.5} />}
        </button>
        <button
          type="button"
          onClick={() => can && onSend(draft)}
          disabled={!can}
          aria-label={sendLabel}
          className="flex size-12 shrink-0 items-center justify-center bg-lime text-lime-foreground outline-none active:opacity-80 focus-visible:ring-4 focus-visible:ring-foreground/30 disabled:bg-tint disabled:text-muted-foreground"
          data-testid="composer-send"
        >
          <Sparkles className="size-6" strokeWidth={2.5} />
        </button>
      </div>
      <AttachSheet
        open={attach}
        onClose={() => setAttach(false)}
        onFiles={(files) => {
          for (const f of files) {
            const kind = kindOf(f);
            add({
              kind,
              blob: f,
              fileName: f.name || (kind === "image" ? "photo.jpg" : kind === "audio" ? "audio.m4a" : "file"),
              mimeType: f.type,
            });
          }
        }}
        onLink={(url, text) => add({ kind: "link", url, ...(text ? { text } : {}) })}
        onPasted={(captures) => {
          for (const c of captures) {
            const input = asInput(c);
            // pasted text joins the field: it is what the request says
            if (input?.kind === "text") {
              setDraft((d) => ({ ...d, text: d.text ? `${d.text}\n${input.text}` : input.text }));
            } else if (input) add(input);
          }
        }}
      />
    </div>
  );
}

/** A voice memo, photo, link or file in the composer, before sending: 44 px, square, removable. */
function AttachmentChip({ a, onRemove }: { a: Attachment; onRemove: () => void }) {
  const input = a.input;
  const blob = "blob" in input ? input.blob : null;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob || input.kind !== "image") return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob, input.kind]);
  const Icon: LucideIcon =
    input.kind === "audio" ? (a.durationMs ? Mic : FileAudio) : input.kind === "link" ? Link2 : FileText;
  const title =
    input.kind === "link"
      ? shortUrl(input.url)
      : input.kind === "audio" && a.durationMs
        ? formatDuration(a.durationMs)
        : "blob" in input
          ? input.fileName
          : input.text;
  const what =
    input.kind === "audio"
      ? a.durationMs
        ? "voice · transcribed later"
        : "audio · transcribed later"
      : input.kind === "image"
        ? "photo"
        : input.kind;
  return (
    <li className="flex h-11 shrink-0 items-center bg-tint" data-testid="attachment" data-kind={input.kind}>
      {url ? (
        <img src={url} alt="" className="size-11 object-cover" />
      ) : (
        <span className="flex size-11 items-center justify-center">
          <Icon className="size-5" strokeWidth={2.5} />
        </span>
      )}
      <span className="flex min-w-0 flex-col pr-1 pl-2">
        <span className="max-w-[128px] truncate font-bold text-sm leading-tight">{title}</span>
        <Label className="text-[10px] text-muted-foreground">{what}</Label>
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${title}`}
        className="flex size-11 shrink-0 items-center justify-center text-muted-foreground"
      >
        <X className="size-4" strokeWidth={2.5} />
      </button>
    </li>
  );
}

/**
 * The plus button's top sheet: what can be attached, as rows. Photo opens iOS's camera-or-library
 * choice, File and Audio file the Files picker, Link a sheet, Paste the clipboard (the paste sheet
 * when the button can't read it or found nothing usable).
 */
function AttachSheet({
  open,
  onClose,
  onFiles,
  onLink,
  onPasted,
}: {
  open: boolean;
  onClose: () => void;
  onFiles: (files: File[]) => void;
  onLink: (url: string, note: string) => void;
  onPasted: (captures: PendingCapture[]) => void;
}) {
  const photos = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<"link" | "paste" | null>(null);
  const [fallback, setFallback] = useState<PasteFallback | null>(null);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = [...(e.target.files ?? [])];
    e.target.value = ""; // picking the same file again still fires
    if (list.length) onFiles(list);
    onClose();
  };
  const paste = async () => {
    // first thing in the tap: iOS only lets a gesture read the clipboard
    const res = await pasteFromClipboard();
    onClose();
    if ("captures" in res) {
      onPasted(res.captures);
      return;
    }
    setFallback(res);
    setSheet("paste");
  };

  const rows: [string, string, LucideIcon, () => void][] = [
    ["Photo", "The camera, or a photo of the fridge", Camera, () => photos.current?.click()],
    [
      "Link",
      "A recipe page",
      Link2,
      () => {
        onClose();
        setSheet("link");
      },
    ],
    ["File", "A screenshot, a PDF, a shopping list", FileText, () => files.current?.click()],
    ["Audio file", "A voice message from elsewhere", FileAudio, () => audio.current?.click()],
    ["Paste", "Text, a link or an image from the clipboard", ClipboardPaste, () => void paste()],
  ];

  return (
    <>
      <CaptureSheet open={open} onClose={onClose} title="Attach" description="To this request">
        <ul className="divide-y divide-border border-border border-t" data-testid="attach-sheet">
          {rows.map(([name, detail, Icon, onClick]) => (
            <li key={name}>
              <button
                type="button"
                onClick={onClick}
                className="flex min-h-[68px] w-full items-center gap-4 px-5 py-3 text-left outline-none active:bg-tint focus-visible:bg-tint"
              >
                <span className="flex size-12 shrink-0 items-center justify-center bg-tint">
                  <Icon className="size-6" strokeWidth={2.5} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{name}</span>
                  <span className="block font-medium text-muted-foreground text-sm">{detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </CaptureSheet>
      <input
        ref={photos}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={pick}
        data-testid="plan-photo-input"
      />
      <input ref={files} type="file" multiple hidden onChange={pick} data-testid="plan-file-input" />
      <input ref={audio} type="file" accept="audio/*" hidden onChange={pick} data-testid="plan-audio-input" />
      <LinkSheet
        open={sheet === "link"}
        onClose={() => setSheet(null)}
        notePlaceholder="Optional: what of it you like (e.g. without the cream)"
        onAdd={(url, note) => {
          onLink(url, note);
          setSheet(null);
        }}
      />
      <PasteSheet
        open={sheet === "paste"}
        fallback={fallback}
        onClose={() => setSheet(null)}
        onAdd={(captures) => {
          onPasted(captures);
          setSheet(null);
        }}
      />
    </>
  );
}
