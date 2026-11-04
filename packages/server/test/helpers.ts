import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A fresh temp dir; tests never touch the real ~/.yamt. */
export const tempDir = (prefix = "yamt-test-"): string => mkdtempSync(join(tmpdir(), prefix));

/**
 * Test fixtures are made up: a 64×48 orange-to-teal gradient (ImageMagick), encoded as JPEG and
 * HEIC (libheif's heif-enc), carrying only an EXIF DateTimeOriginal of 2026:10:30 12:34:56
 * (exiftool) and an OffsetTimeOriginal of +01:00, except gradient-no-offset.jpg.
 */
export const fixture = (name: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(readFileSync(join(import.meta.dir, "fixtures", name)));
