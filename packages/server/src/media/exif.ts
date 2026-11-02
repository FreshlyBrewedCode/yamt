import exifr from "exifr";

/**
 * When a photo was taken, from its EXIF `DateTimeOriginal` (or `CreateDate`), as epoch ms. iPhone
 * photos carry `OffsetTimeOriginal`; without an offset the time is read in the server's time zone.
 * Null when the image has no usable date or no EXIF at all.
 */
export async function exifTakenAt(bytes: Uint8Array): Promise<number | null> {
  let tags: Record<string, unknown> | undefined;
  try {
    tags = await exifr.parse(bytes, {
      pick: ["DateTimeOriginal", "OffsetTimeOriginal", "CreateDate", "OffsetTimeDigitized", "OffsetTime"],
      reviveValues: false,
    });
  } catch {
    return null;
  }
  if (!tags) return null;
  const str = (k: string) => (typeof tags[k] === "string" ? (tags[k] as string).trim() : null);
  if (str("DateTimeOriginal")) {
    return parseExifDate(str("DateTimeOriginal")!, str("OffsetTimeOriginal") ?? str("OffsetTime"));
  }
  if (str("CreateDate"))
    return parseExifDate(str("CreateDate")!, str("OffsetTimeDigitized") ?? str("OffsetTime"));
  return null;
}

/** `2026:10:30 12:34:56` (+ `+01:00`) → epoch ms; null for malformed or placeholder dates. */
export function parseExifDate(value: string, offset: string | null): number | null {
  const m = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  if (y < 1990 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  const off = offset?.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (off) {
    const sign = off[1] === "-" ? -1 : 1;
    const offsetMs = sign * (Number(off[2]) * 60 + Number(off[3])) * 60_000;
    return Date.UTC(y, mo - 1, d, h, mi, s) - offsetMs;
  }
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}
