import { singleUrl } from "@yamt/shared";
import type { PendingCapture } from "./outbox/types";

/**
 * Paste (#26): what the clipboard holds → captures. Two ways in, both feature-detected by the
 * caller: `navigator.clipboard.read()` from the Paste button (iOS shows its own "Paste" callout
 * first; Safari offers only some types, e.g. text/plain, text/uri-list, text/html, image/png),
 * and a `paste` event on the fallback sheet's target, whose `clipboardData` can carry files the
 * first doesn't (maybe a copied voice memo: unconfirmed on iOS, hence `offered`).
 */

/** One representation of a copied thing: the type it is offered as and its data. */
export interface ClipData {
  type: string;
  data: Blob | string;
  /** A file's name (paste events), which can tell what a file without a type is. */
  name?: string;
}

/** One copied thing (a ClipboardItem, a pasted file) in every type it is offered as. */
export type ClipItem = ClipData[];

export interface PasteResult {
  captures: PendingCapture[];
  /** Every type the clipboard offered, so "nothing usable" can say what was there. */
  offered: string[];
}

/** Apple's type identifiers, in case Safari passes them through instead of MIME types. */
const UTI_MIME: Record<string, string> = {
  "com.apple.m4a-audio": "audio/mp4",
  "public.mpeg-4-audio": "audio/mp4",
  "public.mp3": "audio/mpeg",
  "public.aac-audio": "audio/aac",
  "com.microsoft.waveform-audio": "audio/wav",
  "public.aiff-audio": "audio/aiff",
  "com.apple.coreaudio-format": "audio/x-caf",
  "public.png": "image/png",
  "public.jpeg": "image/jpeg",
  "public.heic": "image/heic",
  "public.heif": "image/heif",
  "com.compuserve.gif": "image/gif",
  "org.webmproject.webp": "image/webp",
};

const EXT_MIME: Record<string, string> = {
  m4a: "audio/mp4",
  mp4a: "audio/mp4",
  aac: "audio/aac",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  caf: "audio/x-caf",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  webm: "audio/webm",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  gif: "image/gif",
  webp: "image/webp",
};

const MIME_EXT: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-caf": "caf",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/gif": "gif",
  "image/webp": "webp",
};

const MAX_NOTE = 20_000;
const extOf = (name?: string) => name?.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1];

/** The media type a representation stands for: its MIME type, an Apple UTI, or its file name. */
function mediaMime(d: ClipData): string | null {
  const t = d.type.split(";")[0]!.trim().toLowerCase();
  if (t.startsWith("image/") || t.startsWith("audio/")) return t;
  if (UTI_MIME[t]) return UTI_MIME[t]!;
  const byName = EXT_MIME[extOf(d.name) ?? ""];
  return byName ?? null;
}

/** What the first bytes prove (for files that come without a usable type), else null. */
export async function sniffMime(blob: Blob): Promise<string | null> {
  const b = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (ascii(0, 3) === "ID3") return "audio/mpeg";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 4) === "fLaC") return "audio/flac";
  if (ascii(0, 4) === "caff") return "audio/x-caf";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["heic", "heix", "mif1", "msf1", "hevc"].includes(brand)) return "image/heic";
    if (brand === "M4A " || brand === "M4B ") return "audio/mp4";
  }
  return null;
}

/** `pasted-2026-11-03-1910.png`: pasted images and audio have no name of their own. */
export function pastedName(mimeType: string, at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  const ext = MIME_EXT[mimeType] ?? "bin";
  return `pasted-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}

const asText = async (d: ClipData) => (typeof d.data === "string" ? d.data : d.data.text());

/** Text without its markup (a rich-text copy that came only as HTML). */
function htmlText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** A text as a capture: one URL alone is a link, anything else a note. */
function textCapture(raw: string): PendingCapture | null {
  const text = raw.trim();
  if (!text) return null;
  const url = singleUrl(text);
  if (url) return { kind: "link", url };
  return { kind: "text", text: text.slice(0, MAX_NOTE) };
}

/**
 * One copied thing → at most one capture, the richest it offers: an image, else audio, else a
 * file whose bytes or name say image or audio, else a link (text/uri-list, or plain text that is
 * one URL), else a note (plain text, else HTML's text).
 */
async function captureOf(item: ClipItem, now: number): Promise<PendingCapture | null> {
  const blobs = item.filter(
    (d): d is ClipData & { data: Blob } => typeof d.data !== "string" && d.data.size > 0,
  );
  for (const want of ["image/", "audio/"]) {
    for (const d of blobs) {
      const mime = mediaMime(d);
      if (mime?.startsWith(want)) return media(want === "image/" ? "image" : "audio", d, mime, now);
    }
  }
  for (const d of blobs) {
    if (mediaMime(d) || isTextType(d.type)) continue;
    const mime = await sniffMime(d.data);
    if (mime) return media(mime.startsWith("image/") ? "image" : "audio", d, mime, now);
  }
  const of = (type: string) => item.find((d) => d.type.split(";")[0]!.trim().toLowerCase() === type);
  const uriList = of("text/uri-list");
  if (uriList) {
    const urls = (await asText(uriList))
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    const url = urls.length === 1 ? singleUrl(urls[0]!) : null;
    if (url) return { kind: "link", url };
  }
  const plain = of("text/plain");
  if (plain) {
    const c = textCapture(await asText(plain));
    if (c) return c;
  }
  const html = of("text/html");
  if (html) return textCapture(htmlText(await asText(html)));
  return null;
}

const isTextType = (type: string) => type.toLowerCase().startsWith("text/");

function media(
  kind: "image" | "audio",
  d: ClipData & { data: Blob },
  mimeType: string,
  now: number,
): PendingCapture {
  return { kind, blob: d.data, mimeType, fileName: d.name || pastedName(mimeType, now) };
}

/** What a list of copied things gives: one capture per usable thing, and every type offered. */
export async function capturesFromItems(items: ClipItem[], now = Date.now()): Promise<PasteResult> {
  const captures: PendingCapture[] = [];
  for (const item of items) {
    const c = await captureOf(item, now);
    if (c) captures.push(c);
  }
  return { captures, offered: offeredTypes(items) };
}

/**
 * A paste event's data: its files, each a thing of its own, and its string types as one more.
 * The strings usually describe the files (a name, a path), so they count only without a usable
 * file.
 */
export async function capturesFromPaste(
  files: ClipItem[],
  strings: ClipItem,
  now = Date.now(),
): Promise<PasteResult> {
  const offered = offeredTypes([...files, strings]);
  const fromFiles = await capturesFromItems(files, now);
  if (fromFiles.captures.length > 0) return { captures: fromFiles.captures, offered };
  return { captures: (await capturesFromItems([strings], now)).captures, offered };
}

function offeredTypes(items: ClipItem[]): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    for (const d of item)
      seen.add(d.type || (d.name ? `a file without a type (${d.name})` : "a file without a type"));
  }
  return [...seen];
}

/** `ClipboardItem`s (from `navigator.clipboard.read()`) with every type read. */
export async function readClipboardItems(items: readonly ClipboardItem[]): Promise<ClipItem[]> {
  return Promise.all(
    items.map(async (item) => {
      const reps: ClipItem = [];
      for (const type of item.types) {
        try {
          reps.push({ type, data: await item.getType(type) });
        } catch {
          // offered but not readable: it still counts as offered
          reps.push({ type, data: "" });
        }
      }
      return reps;
    }),
  );
}

/** A paste event's `clipboardData`: its files, and its string types (with their text) as one item. */
export function readDataTransfer(dt: DataTransfer): { files: ClipItem[]; strings: ClipItem } {
  const files: File[] = [...dt.files];
  if (files.length === 0) {
    for (const item of dt.items) {
      const f = item.kind === "file" ? item.getAsFile() : null;
      if (f) files.push(f);
    }
  }
  const strings: ClipItem = dt.types
    .filter((t) => t !== "Files")
    .map((type) => ({ type, data: safeGetData(dt, type) }));
  return { files: files.map((f) => [{ type: f.type, data: f, name: f.name }]), strings };
}

function safeGetData(dt: DataTransfer, type: string): string {
  try {
    return dt.getData(type);
  } catch {
    return "";
  }
}

/** Why the Paste button couldn't read the clipboard, for the fallback sheet. */
export type PasteFallback =
  | { reason: "unsupported" }
  | { reason: "denied" }
  | { reason: "failed"; message: string }
  | { reason: "nothing"; offered: string[] };

/**
 * The Paste button: reads the clipboard (call it first thing in the tap: iOS only allows it from
 * a gesture, and shows its "Paste" callout). Captures when something was usable, else why not.
 */
export async function pasteFromClipboard(
  clipboard: Pick<Clipboard, "read"> | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.clipboard,
): Promise<{ captures: PendingCapture[] } | PasteFallback> {
  if (!clipboard || typeof clipboard.read !== "function") return { reason: "unsupported" };
  let items: ClipboardItems;
  try {
    items = await clipboard.read();
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "NotAllowedError" || name === "SecurityError") return { reason: "denied" };
    return { reason: "failed", message: (e as Error)?.message ?? String(e) };
  }
  const res = await capturesFromItems(await readClipboardItems(items));
  return res.captures.length > 0 ? { captures: res.captures } : { reason: "nothing", offered: res.offered };
}
