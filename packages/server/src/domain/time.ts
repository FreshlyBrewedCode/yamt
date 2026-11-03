/** The server's time zone (the VM's `TZ`), which days and local times are reckoned in. */
export const localTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Throws a RangeError for an unknown IANA zone. */
export function assertTimeZone(timeZone: string): void {
  formatter(timeZone);
}

/** Wall-clock parts of `ms` in the zone. */
function parts(ms: number, timeZone: string) {
  const p = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(ms)
      .map((x) => [x.type, x.value]),
  );
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour),
    min: Number(p.minute),
    s: Number(p.second),
  };
}

/** The zone's offset from UTC at `ms`, in milliseconds (+1 h → 3 600 000). */
export function offsetMs(ms: number, timeZone: string): number {
  const p = parts(ms, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Local midnight of a calendar date in the zone, as epoch ms (DST-safe). */
function localMidnight(y: number, m: number, d: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(guess, timeZone);
  // the offset at midnight itself can differ from the guess's (a DST change that day)
  t = guess - offsetMs(t, timeZone);
  return t;
}

/** `YYYY-MM-DD` → [start, end) of that day in the zone. */
export function dayRange(date: string, timeZone: string): { from: number; to: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`not a date: ${date} (expected YYYY-MM-DD)`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  return {
    from: localMidnight(y, mo, d, timeZone),
    to: localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone),
  };
}

/** `YYYY-MM-DD` of `ms` in the zone. */
export function localDate(ms: number, timeZone: string): string {
  const p = parts(ms, timeZone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** ISO 8601 with the zone's offset, to the second: `2026-11-02T12:30:00+01:00`. */
export function isoLocal(ms: number, timeZone: string): string {
  const p = parts(ms, timeZone);
  const off = offsetMs(ms, timeZone) / 60_000;
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}:${pad(p.s)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
