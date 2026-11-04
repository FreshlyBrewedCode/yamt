import type { CaptureKind } from "@yamt/shared";

// UI copy is English; numbers use "1,198"; times are 24 h in the browser's zone.

export const formatNumber = (n: number): string => Math.round(n).toLocaleString("en");

const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const formatTime = (ms: number): string => timeFmt.format(ms);

/** `YYYY-MM-DD` of a time in the browser's zone (the overview's days). */
export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local midnight `days` days from the one `ms` falls on. */
export function startOfDay(ms: number, days = 0): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

const longDate = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short" });
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long" });
const shortDate = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** "Tuesday 3 Nov". */
export const formatLongDate = (ms: number): string => longDate.format(ms).replace(",", "");

/** "Today", "Yesterday", a weekday within the week, else "Mon 26 Oct". */
export function dayLabel(dayStart: number, now = Date.now()): string {
  const diff = Math.round((startOfDay(now) - dayStart) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) return weekday.format(dayStart);
  return shortDate.format(dayStart).replace(",", "");
}

/** "Today, 12:30", "Yesterday, 19:10", "Mon 26 Oct, 08:15". */
export const formatDayTime = (ms: number, now = Date.now()): string =>
  `${dayLabel(startOfDay(ms), now)}, ${formatTime(ms)}`;

const kindWords: Record<CaptureKind, [string, string]> = {
  audio: ["voice memo", "voice memos"],
  image: ["photo", "photos"],
  text: ["note", "notes"],
  link: ["link", "links"],
  file: ["file", "files"],
  correction: ["correction", "corrections"],
  answer: ["answer", "answers"],
};
const kindOrder: CaptureKind[] = ["image", "audio", "text", "link", "file", "correction", "answer"];

/** "2 photos · 1 voice memo". */
export function captureSummary(kinds: Partial<Record<CaptureKind, number>>): string {
  return kindOrder
    .filter((k) => (kinds[k] ?? 0) > 0)
    .map((k) => {
      const n = kinds[k]!;
      return `${n} ${kindWords[k][n === 1 ? 0 : 1]}`;
    })
    .join(" · ");
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "eat-this.org/kuerbis-curry" for a link's title line. */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}
