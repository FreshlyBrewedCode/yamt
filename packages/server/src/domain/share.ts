import {
  type Capture,
  type CaptureKind,
  captureCounts,
  JsonCaptureBody,
  MAX_UPLOAD_BYTES,
  type Meal,
  SHARE_DRAFT_WINDOW_MS,
  singleUrl,
} from "@yamt/shared";
import type { Repos } from "../db/repos/index.ts";
import { detectMediaType, normaliseMime } from "../media/detect.ts";
import { HttpError } from "./errors.ts";
import { checkCapturedAt, type MealService } from "./meals.ts";

/** What a share request carries: `file` parts (a Shortcut may send text there too), `text`, `url`. */
export interface ShareInput {
  files: (File | string)[];
  texts: string[];
  urls: string[];
  capturedAt?: number;
}

export interface ShareResult {
  meal: Meal;
  newMeal: boolean;
  captures: Capture[];
  summary: string;
}

/** One item to store: an upload as it is, or text that became a note or a link. */
type Planned = { kind: "upload"; file: File } | JsonCaptureBody;

/** Text files larger than this are kept as files rather than read into a note. */
const MAX_TEXT_FILE_BYTES = 64 * 1024;
const TEXT_EXTS = new Set(["txt", "text", "url", "webloc", "html", "htm"]);
const TEXT_MIMES = new Set(["application/x-url", "application/xml", "application/x-plist"]);

/**
 * The share target (#26): what an iOS Shortcut sends from another app's share sheet goes into
 * the **current draft meal** (the most recently updated `draft`, if it was created or changed in
 * the last `SHARE_DRAFT_WINDOW_MS`), else into a new draft. The new draft is not pinned: its
 * `eatenAt` follows its captures like any other's, so it lands at the items' time.
 *
 * Every item becomes an ordinary capture through `MealService` (type sniffing, HEIC → JPEG,
 * EXIF time, a pending transcript and a `transcribe` job for audio); nothing is analysed.
 */
export class ShareService {
  constructor(
    private readonly repos: Repos,
    private readonly meals: MealService,
    private readonly timeZone: string,
    /** Seam for tests: the per-file limit (the same as for uploads). */
    private readonly maxBytes = MAX_UPLOAD_BYTES,
  ) {}

  async share(input: ShareInput, now = Date.now()): Promise<ShareResult> {
    // check everything before a meal is picked or made, so a refused share changes nothing
    checkCapturedAt(input.capturedAt, now);
    const planned: Planned[] = [];
    for (const f of input.files) {
      if (typeof f === "string") planned.push(...fromText(f));
      else planned.push(await this.fromFile(f));
    }
    for (const t of input.texts) planned.push(...fromText(t));
    for (const u of input.urls) planned.push(JsonCaptureBody.parse({ kind: "link", url: u.trim() }));
    if (planned.length === 0) {
      throw new HttpError(400, "nothing to add", "send one or more file, text or url fields");
    }

    const draft = this.repos.meals.latestDraftSince(now - SHARE_DRAFT_WINDOW_MS);
    const meal = draft ?? this.repos.meals.insert({ now });
    const capturedAt = input.capturedAt;
    const captures: Capture[] = [];
    for (const p of planned) {
      const res =
        p.kind === "upload"
          ? await this.meals.addUpload(meal.id, p.file, { capturedAt }, now)
          : this.meals.addJson(meal.id, { ...p, capturedAt }, now);
      captures.push(res.capture);
    }
    const after = this.repos.meals.get(meal.id)!;
    return {
      meal: after,
      newMeal: !draft,
      captures,
      summary: this.summary(after, !draft, captures),
    };
  }

  /** "Added 2 photos and 1 link to Untitled meal, 19:10" (a draft has no title yet). */
  private summary(meal: Meal, newMeal: boolean, captures: Capture[]): string {
    const kinds: Partial<Record<CaptureKind, number>> = {};
    for (const c of captures) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
    const time = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: this.timeZone,
    }).format(meal.eatenAt);
    return `Added ${andList(captureCounts(kinds))} to ${newMeal ? "a new meal" : "Untitled meal"}, ${time}`;
  }

  /**
   * A shared file: media stays an upload; a small text file (a Shortcut turns shared text, a URL
   * or a Safari page into one) becomes a link or a note when it can be read as one.
   */
  private async fromFile(file: File): Promise<Planned> {
    if (file.size === 0) throw new HttpError(400, `${file.name || "a file"} is empty`);
    if (file.size > this.maxBytes) {
      throw new HttpError(413, `${file.name || "a file"} is larger than ${this.maxBytes / 1024 / 1024} MB`);
    }
    const asText = await readText(file);
    if (asText !== null) {
      const items = asText.html ? fromHtml(asText.text) : fromText(asText.text, asText.webShortcut);
      if (items.length === 1) return items[0]!;
    }
    return { kind: "upload", file };
  }
}

/** "a", "a and b", "a, b and c". */
function andList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * Text as a capture: a single URL is a link, a `.url` / `.webloc` shortcut's URL too, anything
 * else (non-empty) a note. Too long for a note: nothing (the caller keeps the file).
 */
function fromText(raw: string, webShortcut = false): Planned[] {
  const text = raw.trim();
  if (!text) return [];
  if (webShortcut) {
    const url =
      text.match(/<key>URL<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? text.match(/^URL=(.+)$/m)?.[1];
    const link = url ? singleUrl(url.replaceAll("&amp;", "&")) : null;
    return link ? [{ kind: "link", url: link }] : [];
  }
  const url = singleUrl(text);
  if (url) return [{ kind: "link", url }];
  const note = JsonCaptureBody.safeParse({ kind: "text", text });
  return note.success ? [note.data] : [];
}

/** A web page (Safari's share as a file): its canonical or og:url address as a link, if it names one. */
function fromHtml(html: string): Planned[] {
  for (const tag of html.match(/<(?:link|meta)\b[^>]*>/gi) ?? []) {
    const attr = (name: string) =>
      tag
        .match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))
        ?.slice(2)
        .find(Boolean);
    const rel = attr("rel")?.toLowerCase();
    const property = attr("property")?.toLowerCase();
    const href = rel === "canonical" ? attr("href") : property === "og:url" ? attr("content") : undefined;
    const url = href ? singleUrl(href.replaceAll("&amp;", "&")) : null;
    if (url) return [{ kind: "link", url }];
  }
  return [];
}

/** The file as UTF-8 text when it is text-like and small, else null (media, binary, large). */
async function readText(file: File): Promise<{ text: string; html: boolean; webShortcut: boolean } | null> {
  if (file.size > MAX_TEXT_FILE_BYTES) return null;
  const bytes = await file.bytes();
  const name = file.name ?? null;
  const ext = name?.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? null;
  const declared = normaliseMime(file.type);
  const sniffed = detectMediaType(bytes.subarray(0, 64), file.type, name).mimeType;
  if (/^(image|audio|video)\//.test(sniffed) || sniffed === "application/pdf") return null;
  const textual =
    (declared !== null && (declared.startsWith("text/") || TEXT_MIMES.has(declared))) ||
    (ext !== null && TEXT_EXTS.has(ext)) ||
    declared === null;
  if (!textual) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (text.includes("\0")) return null;
  const html =
    declared === "text/html" || ext === "html" || ext === "htm" || /^\s*<(!doctype html|html)/i.test(text);
  const webShortcut = ext === "url" || ext === "webloc" || declared === "application/x-url";
  return { text, html, webShortcut };
}
