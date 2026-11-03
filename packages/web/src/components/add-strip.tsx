import { Camera, ClipboardPaste, FileAudio, Link2, type LucideIcon, NotebookPen, X } from "lucide-react";
import { useRef, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { capturesFromPaste, type PasteFallback, pasteFromClipboard, readDataTransfer } from "@/lib/clipboard";
import type { PendingCapture } from "@/lib/outbox";
import { Label, SlabButton } from "./slab";

export interface AddHandlers {
  onFiles: (kind: "image" | "audio", files: File[]) => void;
  onNote: (text: string) => void;
  onLink: (url: string, note: string) => void;
  /** What Paste found: images, audio, links and notes, each a capture of its own. */
  onCaptures: (captures: PendingCapture[]) => void;
}

/**
 * Add more: five equal targets under the recorder. Photo opens iOS's camera-or-library choice
 * (several at once), Audio the Files picker (long Voice Memos recordings), Note and Link a sheet,
 * Paste reads the clipboard (iOS asks with its own "Paste" callout) and falls back to a sheet
 * to paste into when it can't, or found nothing it could use.
 */
export function AddStrip({
  onFiles,
  onNote,
  onLink,
  onCaptures,
  disabled,
}: AddHandlers & { disabled?: boolean }) {
  const photos = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<"note" | "link" | "paste" | null>(null);
  const [fallback, setFallback] = useState<PasteFallback | null>(null);

  const paste = async () => {
    // first thing in the tap: iOS only lets a gesture read the clipboard
    const res = await pasteFromClipboard();
    if ("captures" in res) {
      onCaptures(res.captures);
      return;
    }
    setFallback(res);
    setSheet("paste");
  };

  const pick = (kind: "image" | "audio") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = ""; // picking the same file again still fires
    if (files.length) onFiles(kind, files);
  };

  const targets: [string, LucideIcon, () => void][] = [
    ["Photo", Camera, () => photos.current?.click()],
    ["Note", NotebookPen, () => setSheet("note")],
    ["Link", Link2, () => setSheet("link")],
    ["Audio", FileAudio, () => audio.current?.click()],
    ["Paste", ClipboardPaste, () => void paste()],
  ];

  return (
    <>
      <div className="grid grid-cols-5 divide-x divide-border border-border border-b">
        {targets.map(([label, Icon, onClick]) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={
              label === "Audio"
                ? "Attach audio file"
                : label === "Paste"
                  ? "Paste from the clipboard"
                  : `Add ${label.toLowerCase()}`
            }
            className="flex h-[68px] flex-col items-center justify-center gap-1 font-bold text-xs uppercase tracking-[0.08em] outline-none focus-visible:bg-lime-soft active:bg-lime active:text-lime-foreground disabled:text-muted-foreground"
          >
            <Icon className="size-6" strokeWidth={2.5} />
            {label}
          </button>
        ))}
      </div>
      <input
        ref={photos}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={pick("image")}
        data-testid="photo-input"
      />
      <input
        ref={audio}
        type="file"
        accept="audio/*"
        hidden
        onChange={pick("audio")}
        data-testid="audio-input"
      />
      <NoteSheet
        open={sheet === "note"}
        onClose={() => setSheet(null)}
        onAdd={(text) => {
          onNote(text);
          setSheet(null);
        }}
      />
      <LinkSheet
        open={sheet === "link"}
        onClose={() => setSheet(null)}
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
          onCaptures(captures);
          setSheet(null);
        }}
      />
    </>
  );
}

/**
 * Sheets slide in from the top: on iOS the keyboard covers the bottom half of the screen, and a
 * bottom sheet would sit behind it.
 */
function CaptureSheet({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="top"
        showCloseButton={false}
        className="mx-auto max-w-md gap-0 pt-[env(safe-area-inset-top)]"
        onOpenAutoFocus={(e) => {
          // focus the field, not the close button, so the keyboard comes up at once
          e.preventDefault();
          (e.currentTarget as HTMLElement)
            .querySelector<HTMLElement>("textarea, input, [contenteditable]")
            ?.focus();
        }}
      >
        <div className="flex items-end justify-between px-5 pt-5 pb-4">
          <div>
            <SheetDescription asChild>
              <Label className="text-muted-foreground">{description}</Label>
            </SheetDescription>
            <SheetTitle className="display mt-1 font-bold text-[32px]">{title}</SheetTitle>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-12 items-center justify-center bg-tint active:opacity-70"
          >
            <X className="size-6" strokeWidth={2.5} />
          </button>
        </div>
        {children}
      </SheetContent>
    </Sheet>
  );
}

const fieldClass =
  "w-full bg-tint px-5 py-4 font-medium text-base text-foreground outline-none placeholder:text-muted-foreground focus:bg-lime-soft";

function NoteSheet({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const add = () => {
    if (!text.trim()) return;
    onAdd(text.trim());
    setText("");
  };
  return (
    <CaptureSheet open={open} onClose={onClose} title="Note" description="Type or dictate">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. 2 slices of rye bread with butter, about 10 g"
        aria-label="Note"
        rows={4}
        className={`${fieldClass} min-h-32 resize-none`}
      />
      <SlabButton onClick={add} disabled={!text.trim()}>
        Add note
      </SlabButton>
    </CaptureSheet>
  );
}

/** Accepts what people paste: a bare host gets https://. Null if it isn't an http(s) URL. */
export function normaliseUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".")
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

function LinkSheet({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (url: string, note: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const valid = normaliseUrl(url);
  const add = () => {
    if (!valid) return;
    onAdd(valid, note.trim());
    setUrl("");
    setNote("");
  };
  return (
    <CaptureSheet open={open} onClose={onClose} title="Link" description="A recipe or product page">
      <input
        type="url"
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste a link"
        aria-label="Link"
        className={`${fieldClass} h-16`}
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional: what of it you ate (e.g. half the recipe)"
        aria-label="Note about the link"
        rows={2}
        className={`${fieldClass} resize-none border-border border-t`}
      />
      {url.trim() && !valid && (
        <Label className="bg-orange px-5 py-2.5 text-orange-foreground normal-case tracking-normal">
          That doesn't look like a web link.
        </Label>
      )}
      <SlabButton onClick={add} disabled={!valid}>
        Add link
      </SlabButton>
    </CaptureSheet>
  );
}

/** Why the sheet is open, in one quiet line: what the Paste button ran into. */
const FALLBACK_TEXT: Record<PasteFallback["reason"], string> = {
  unsupported: "This browser doesn't let the Paste button read the clipboard.",
  denied: "Reading the clipboard wasn't allowed.",
  failed: "The clipboard couldn't be read.",
  nothing: "The Paste button found nothing yamt can use.",
};

const typeList = (types: string[]) => (types.length ? types.join(", ") : "nothing at all");

/**
 * The paste fallback: a target to touch and hold (iOS's callout then offers Paste), whose
 * `paste` event can carry files the clipboard API doesn't, maybe a copied voice memo. What
 * arrives is added at once; if nothing usable does, the sheet says so and lists the types the
 * clipboard offered, so it's clear what the other app put there.
 */
function PasteSheet({
  open,
  fallback,
  onClose,
  onAdd,
}: {
  open: boolean;
  fallback: PasteFallback | null;
  onClose: () => void;
  onAdd: (captures: PendingCapture[]) => void;
}) {
  const [offered, setOffered] = useState<string[] | null>(null);
  const close = () => {
    setOffered(null);
    onClose();
  };
  const onPaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const { files, strings } = readDataTransfer(e.clipboardData);
    const res = await capturesFromPaste(files, strings);
    if (res.captures.length > 0) {
      setOffered(null);
      onAdd(res.captures);
    } else {
      setOffered(res.offered);
    }
  };
  const before = fallback?.reason === "nothing" ? fallback.offered : null;
  return (
    <CaptureSheet open={open} onClose={close} title="Paste" description="From the clipboard">
      {/* contenteditable, not a textarea: iOS offers Paste on a long press only on something
          editable, and only rich editing takes images and files */}
      {/* biome-ignore lint/a11y/useSemanticElements: a textarea would take only text (see above) */}
      <div
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Paste here"
        tabIndex={0}
        onPaste={(e) => void onPaste(e)}
        // nothing is typed here: only what is pasted counts
        onBeforeInput={(e) => e.preventDefault()}
        onInput={(e) => {
          e.currentTarget.textContent = "";
        }}
        onDrop={(e) => e.preventDefault()}
        className="relative flex min-h-36 w-full items-center justify-center bg-lime px-5 py-6 text-lime-foreground caret-transparent outline-none focus-visible:ring-4 focus-visible:ring-foreground/40 focus-visible:ring-inset"
        data-testid="paste-target"
      >
        <span
          className="pointer-events-none flex select-none flex-col items-center gap-2 text-center"
          aria-hidden
        >
          <ClipboardPaste className="size-8" strokeWidth={2.5} />
          <span className="font-bold text-lg">Touch and hold here, then Paste</span>
        </span>
      </div>
      {offered !== null ? (
        <div className="bg-orange px-5 py-3 text-orange-foreground" role="alert" data-testid="paste-nothing">
          <p className="font-bold">Nothing usable on the clipboard.</p>
          <p className="mt-1 break-words font-medium text-sm">It had: {typeList(offered)}</p>
        </div>
      ) : (
        fallback && (
          <div className="bg-tint px-5 py-3" role="status" data-testid="paste-why">
            <p className="font-medium text-muted-foreground text-sm">
              {FALLBACK_TEXT[fallback.reason]}
              {before && <> It had: {typeList(before)}.</>} Pasting here can bring more along, like audio.
            </p>
          </div>
        )
      )}
    </CaptureSheet>
  );
}
