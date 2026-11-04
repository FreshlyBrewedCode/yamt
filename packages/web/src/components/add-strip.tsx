import { Camera, FileAudio, Link2, type LucideIcon, NotebookPen, X } from "lucide-react";
import { useRef, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Label, SlabButton } from "./slab";

export interface AddHandlers {
  onFiles: (kind: "image" | "audio", files: File[]) => void;
  onNote: (text: string) => void;
  onLink: (url: string, note: string) => void;
}

/**
 * Add more: four equal targets under the recorder. Photo opens iOS's camera-or-library choice
 * (several at once), Audio the Files picker (long Voice Memos recordings), Note and Link a sheet.
 */
export function AddStrip({ onFiles, onNote, onLink, disabled }: AddHandlers & { disabled?: boolean }) {
  const photos = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<"note" | "link" | null>(null);

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
  ];

  return (
    <>
      <div className="grid grid-cols-4 divide-x divide-border border-border border-b">
        {targets.map(([label, Icon, onClick]) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label === "Audio" ? "Attach audio file" : `Add ${label.toLowerCase()}`}
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
          (e.currentTarget as HTMLElement).querySelector<HTMLElement>("textarea, input")?.focus();
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
