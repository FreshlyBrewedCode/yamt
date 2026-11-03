import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A fresh temp dir; tests never touch the real ~/.yamt. */
export const tempDir = (prefix = "yamt-test-"): string => mkdtempSync(join(tmpdir(), prefix));

/**
 * Test fixtures are made up: a 64×48 orange-to-teal gradient (ImageMagick), encoded as JPEG and
 * HEIC (libheif's heif-enc), carrying only an EXIF DateTimeOriginal of 2026:10:30 12:34:56
 * (exiftool) and an OffsetTimeOriginal of +01:00, except gradient-no-offset.jpg.
 * memo-de.m4a is synthetic speech: espeak-ng (`-v de -s 140`) reading the made-up sentence "Zum
 * Mittagessen hatte ich zweihundert Gramm Spaghetti mit Tomatensoße, dazu einen Esslöffel
 * Olivenöl und etwas Parmesan.", 8.9 s, encoded by ffmpeg as mono AAC in M4A like Voice Memos.
 */
export const fixture = (name: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(readFileSync(join(import.meta.dir, "fixtures", name)));
