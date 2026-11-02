import type { UploadCaptureKind } from "@yamt/shared";

/**
 * What an upload really is. Browsers' declared types are unreliable (a Voice Memos `.m4a` can
 * arrive as `audio/x-m4a`, `audio/mp4`, `video/mp4` or `application/octet-stream`), so the first
 * bytes win for the formats we care about; the declared type and the file name are fallbacks.
 */
export interface MediaType {
  mimeType: string;
  /** File extension for storage, without the dot. */
  ext: string;
}

const EXT_BY_MIME: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/flac": "flac",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "application/pdf": "pdf",
  "text/plain": "txt",
};

/** Aliases browsers and iOS use for the same thing. */
const MIME_ALIASES: Record<string, string> = {
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/mp3": "audio/mpeg",
  "audio/x-flac": "audio/flac",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
};

const MIME_BY_EXT: Record<string, string> = {
  ...Object.fromEntries(Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime])),
  jpeg: "image/jpeg",
  m4a: "audio/mp4",
  webm: "audio/webm",
};

const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx"]);

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));
const startsWith = (b: Uint8Array, bytes: number[]) => bytes.every((x, i) => b[i] === x);

/** The type the leading bytes prove, or null. `audioHint` decides ambiguous containers (MP4, WebM). */
export function sniffMime(head: Uint8Array, audioHint: boolean): string | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (ascii(head, 0, 4) === "GIF8") return "image/gif";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "image/webp";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WAVE") return "audio/wav";
  if (ascii(head, 0, 5) === "%PDF-") return "application/pdf";
  if (ascii(head, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(head, 0, 4) === "fLaC") return "audio/flac";
  if (ascii(head, 0, 3) === "ID3") return "audio/mpeg";
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return audioHint ? "audio/webm" : "video/webm";
  if (ascii(head, 4, 8) === "ftyp") {
    const boxSize = ((head[0] ?? 0) << 24) | ((head[1] ?? 0) << 16) | ((head[2] ?? 0) << 8) | (head[3] ?? 0);
    const brands = [ascii(head, 8, 12)];
    for (let o = 16; o + 4 <= Math.min(boxSize, head.length); o += 4) brands.push(ascii(head, o, o + 4));
    if (brands.some((b) => HEIC_BRANDS.has(b))) return "image/heic";
    if (brands.includes("avif")) return "image/avif";
    if (brands[0] === "mif1" || brands[0] === "msf1") return "image/heif";
    if (brands[0] === "M4A " || brands[0] === "M4B ") return "audio/mp4";
    if (brands[0] === "qt  ") return audioHint ? "audio/mp4" : "video/quicktime";
    return audioHint ? "audio/mp4" : "video/mp4";
  }
  return null;
}

/** `audio/mp4;codecs=mp4a.40.2` → `audio/mp4`, aliases resolved; null for nothing useful. */
export function normaliseMime(declared: string | null | undefined): string | null {
  const base = declared?.split(";")[0]?.trim().toLowerCase();
  if (!base || base === "application/octet-stream" || !base.includes("/")) return null;
  return MIME_ALIASES[base] ?? base;
}

const extOf = (fileName: string | null) => {
  const m = fileName?.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return m?.[1] ?? null;
};

export function detectMediaType(
  head: Uint8Array,
  declared: string | null,
  fileName: string | null,
  kind?: UploadCaptureKind,
): MediaType {
  const declaredMime = normaliseMime(declared);
  const nameExt = extOf(fileName);
  const fromName = nameExt ? (MIME_BY_EXT[nameExt] ?? null) : null;
  const audioHint =
    kind === "audio" || (kind === undefined && (declaredMime ?? fromName ?? "").startsWith("audio/"));
  const mimeType = sniffMime(head, audioHint) ?? declaredMime ?? fromName ?? "application/octet-stream";
  const ext = EXT_BY_MIME[mimeType] ?? nameExt ?? "bin";
  return { mimeType, ext };
}

/** The capture kind for an upload without an explicit one. */
export function kindForMime(mimeType: string): UploadCaptureKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

/** Whether `mimeType` fits the requested kind (videos carry sound, so they pass as audio). */
export function mimeFitsKind(mimeType: string, kind: UploadCaptureKind): boolean {
  if (kind === "image") return mimeType.startsWith("image/");
  if (kind === "audio") return mimeType.startsWith("audio/") || mimeType.startsWith("video/");
  return true;
}

export const isHeif = (mimeType: string): boolean => mimeType === "image/heic" || mimeType === "image/heif";
