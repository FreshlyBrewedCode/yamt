import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { decode } from "jpeg-js";
import { parseRange } from "../src/http/file-response.ts";
import { detectMediaType, kindForMime, mimeFitsKind, normaliseMime, sniffMime } from "../src/media/detect.ts";
import { exifTakenAt, parseExifDate } from "../src/media/exif.ts";
import { heicToJpeg } from "../src/media/heic.ts";
import { MediaStore } from "../src/media/store.ts";
import { fixture, tempDir } from "./helpers.ts";

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((ch) => ch.charCodeAt(0)) : p)));
/** An ISO-BMFF `ftyp` box with a major brand and compatible brands. */
const ftyp = (major: string, ...compatible: string[]) =>
  bytes([0, 0, 0, 16 + 4 * compatible.length], "ftyp", major, [0, 0, 0, 0], ...compatible);

describe("detectMediaType", () => {
  test("sniffs the formats an iPhone sends, whatever the declared type", () => {
    expect(sniffMime(fixture("gradient.jpg"), false)).toBe("image/jpeg");
    expect(sniffMime(fixture("gradient.heic"), false)).toBe("image/heic");
    expect(sniffMime(ftyp("mif1", "mif1", "heic"), false)).toBe("image/heic");
    expect(sniffMime(ftyp("mif1", "mif1", "miaf"), false)).toBe("image/heif");
    // Voice Memos .m4a, and Safari's MediaRecorder audio/mp4 (generic brands, needs the hint)
    expect(sniffMime(ftyp("M4A ", "M4A ", "isom"), false)).toBe("audio/mp4");
    expect(sniffMime(ftyp("iso5", "iso5", "mp41"), true)).toBe("audio/mp4");
    expect(sniffMime(ftyp("iso5", "iso5", "mp41"), false)).toBe("video/mp4");
    expect(sniffMime(bytes("%PDF-1.7"), false)).toBe("application/pdf");
    expect(sniffMime(bytes("<html>"), false)).toBeNull();
  });

  test("falls back to the declared type, then the file name; picks the storage extension", () => {
    const m4a = ftyp("M4A ", "M4A ");
    expect(detectMediaType(m4a, "video/mp4", "Memo.m4a")).toEqual({ mimeType: "audio/mp4", ext: "m4a" });
    expect(detectMediaType(ftyp("iso5"), "audio/mp4;codecs=mp4a.40.2", null)).toEqual({
      mimeType: "audio/mp4",
      ext: "m4a",
    });
    expect(detectMediaType(ftyp("iso5"), "application/octet-stream", "Memo.M4A")).toMatchObject({
      mimeType: "audio/mp4",
    });
    expect(detectMediaType(bytes("plain"), "text/plain", "notes.txt")).toEqual({
      mimeType: "text/plain",
      ext: "txt",
    });
    expect(detectMediaType(bytes("??"), "", "recipe.XYZ")).toEqual({
      mimeType: "application/octet-stream",
      ext: "xyz",
    });
    expect(detectMediaType(bytes("??"), null, null)).toEqual({
      mimeType: "application/octet-stream",
      ext: "bin",
    });
    expect(normaliseMime("Audio/X-M4A")).toBe("audio/mp4");
  });

  test("kinds", () => {
    expect(kindForMime("image/heic")).toBe("image");
    expect(kindForMime("audio/mp4")).toBe("audio");
    expect(kindForMime("application/pdf")).toBe("file");
    expect(mimeFitsKind("image/jpeg", "audio")).toBe(false);
    expect(mimeFitsKind("video/mp4", "audio")).toBe(true);
    expect(mimeFitsKind("application/pdf", "image")).toBe(false);
    expect(mimeFitsKind("application/pdf", "file")).toBe(true);
  });
});

describe("EXIF capture time", () => {
  const taken = Date.UTC(2026, 9, 30, 11, 34, 56); // 12:34:56 at +01:00

  test("JPEG and HEIC with an offset", async () => {
    expect(await exifTakenAt(fixture("gradient.jpg"))).toBe(taken);
    expect(await exifTakenAt(fixture("gradient.heic"))).toBe(taken);
  });

  test("without an offset: the server's local time", async () => {
    expect(await exifTakenAt(fixture("gradient-no-offset.jpg"))).toBe(
      new Date(2026, 9, 30, 12, 34, 56).getTime(),
    );
  });

  test("no EXIF or not an image: null", async () => {
    expect(await exifTakenAt(bytes("not an image at all"))).toBeNull();
  });

  test("parseExifDate", () => {
    expect(parseExifDate("2026:10:30 12:34:56", "-05:00")).toBe(Date.UTC(2026, 9, 30, 17, 34, 56));
    expect(parseExifDate("0000:00:00 00:00:00", null)).toBeNull();
    expect(parseExifDate("garbage", null)).toBeNull();
  });
});

describe("heicToJpeg", () => {
  test("decodes the fixture to a JPEG of the same size", async () => {
    const jpeg = await heicToJpeg(fixture("gradient.heic"));
    expect([...jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    const img = decode(jpeg, { useTArray: true });
    expect([img.width, img.height]).toEqual([64, 48]);
  });

  test("rejects what is not HEIC", async () => {
    await expect(heicToJpeg(fixture("gradient.jpg"))).rejects.toThrow();
  });
});

describe("MediaStore", () => {
  test("media/<yyyy>/<mm>/<id>.<ext> by UTC month, 0600 files in 0700 dirs, size and sha256", async () => {
    const dir = tempDir();
    const store = new MediaStore(dir);
    const path = store.pathFor("abc", "m4a", Date.UTC(2026, 10, 30, 23, 30));
    expect(path).toBe("media/2026/11/abc.m4a");
    const written = await store.write(path, bytes("made-up audio"));
    expect(written).toEqual({
      byteSize: 13,
      sha256: new Bun.CryptoHasher("sha256").update("made-up audio").digest("hex"),
    });
    expect(statSync(join(dir, path)).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "media/2026/11")).mode & 0o777).toBe(0o700);
  });

  test("never overwrites an original and refuses paths outside media/", async () => {
    const store = new MediaStore(tempDir());
    await store.write("media/2026/11/x.jpg", bytes("one"));
    await expect(store.write("media/2026/11/x.jpg", bytes("two"))).rejects.toThrow("exists");
    expect(() => store.absolute("media/../yamt.db")).toThrow("outside");
    expect(() => store.absolute("/etc/passwd")).toThrow("outside");
  });
});

describe("parseRange", () => {
  test("single byte ranges; anything else serves the whole file", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=990-2000", 1000)).toEqual({ start: 990, end: 999 });
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-1,5-9", 1000)).toBeNull();
    expect(parseRange("bytes=9-5", 1000)).toBeNull();
    expect(parseRange("items=0-1", 1000)).toBeNull();
  });
});
