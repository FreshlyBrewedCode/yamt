import { MAX_UPLOAD_BYTES, type UploadCaptureKind } from "@yamt/shared";
import { HttpError } from "../domain/errors.ts";
import { detectMediaType, isHeif, kindForMime, mimeFitsKind } from "./detect.ts";
import { exifTakenAt } from "./exif.ts";
import type { MediaStore } from "./store.ts";

/** A stored upload, as the capture (or planning input) row records it. */
export interface StoredUpload {
  /** What the bytes are: the kind asked for, else by type. */
  mediaKind: UploadCaptureKind;
  /** A photo's EXIF time. */
  takenAt: number | null;
  media: {
    mimeType: string;
    path: string;
    byteSize: number;
    sha256: string;
    fileName: string | null;
    jpeg: { status: "ok"; path: string } | { status: "missing" } | null;
  };
  /** Removes the files again: for when the row can't be recorded (nothing may point at them). */
  discard: () => Promise<void>;
}

/**
 * An upload's bytes into the media store under `id` (meals' captures and planning inputs, #44):
 * the type from the first bytes, then the declared type and the name; refused when empty, too
 * large or not the `mediaKind` asked for. The original is stored byte for byte; photos get their
 * EXIF time, HEIC/HEIF photos a JPEG derivative next to the original (or `missing` if that fails).
 */
export async function storeUpload(
  store: MediaStore,
  toJpeg: (heic: Uint8Array) => Promise<Uint8Array>,
  id: string,
  file: File,
  mediaKind: UploadCaptureKind | undefined,
  now: number,
): Promise<StoredUpload> {
  if (file.size === 0) throw new HttpError(400, "the file is empty");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, `the file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  }
  const bytes = await file.bytes();
  const fileName = file.name ? file.name.slice(0, 255) : null;
  const type = detectMediaType(bytes.subarray(0, 64), file.type, fileName, mediaKind);
  if (mediaKind && !mimeFitsKind(type.mimeType, mediaKind)) {
    throw new HttpError(
      400,
      `a ${type.mimeType} file is not ${mediaKind === "image" ? "an image" : "audio"}`,
    );
  }
  const kind = mediaKind ?? kindForMime(type.mimeType);

  const path = store.pathFor(id, type.ext, now);
  const written: string[] = [];
  const discard = async () => {
    for (const p of written) await store.remove(p).catch(() => {});
  };
  try {
    const { byteSize, sha256 } = await store.write(path, bytes);
    written.push(path);
    let takenAt: number | null = null;
    let jpeg: StoredUpload["media"]["jpeg"] = null;
    if (kind === "image") {
      takenAt = await exifTakenAt(bytes);
      if (isHeif(type.mimeType)) {
        const jpegPath = store.pathFor(id, "jpg", now);
        try {
          await store.write(jpegPath, await toJpeg(bytes));
          written.push(jpegPath);
          jpeg = { status: "ok", path: jpegPath };
        } catch (e) {
          console.warn(`upload ${id}: no JPEG derivative (${(e as Error).message}); the original is kept`);
          jpeg = { status: "missing" };
        }
      }
    }
    return {
      mediaKind: kind,
      takenAt,
      media: { mimeType: type.mimeType, path, byteSize, sha256, fileName, jpeg },
      discard,
    };
  } catch (e) {
    await discard();
    throw e;
  }
}

export interface MediaFile {
  /** Absolute. */
  path: string;
  mimeType: string;
  byteSize: number;
  /** Strong validator for caching and range requests. */
  etag: string;
}

/**
 * The stored file of a media capture or input: the original, or the JPEG derivative of a HEIC
 * photo. `what` names the record in the 404s ("capture", "input").
 */
export function storedFile(
  store: MediaStore,
  r: {
    mediaPath: string | null;
    jpegPath: string | null;
    mimeType: string | null;
    byteSize: number | null;
    sha256: string | null;
  },
  variant: "original" | "jpeg",
  what: string,
): MediaFile {
  if (variant === "jpeg") {
    if (!r.jpegPath) throw new HttpError(404, `this ${what} has no JPEG derivative`);
    const path = store.absolute(r.jpegPath);
    return { path, mimeType: "image/jpeg", byteSize: Bun.file(path).size, etag: `"${r.sha256}-jpeg"` };
  }
  if (!r.mediaPath || !r.mimeType || r.byteSize === null)
    throw new HttpError(404, `this ${what} has no media`);
  return {
    path: store.absolute(r.mediaPath),
    mimeType: r.mimeType,
    byteSize: r.byteSize,
    etag: `"${r.sha256}"`,
  };
}
