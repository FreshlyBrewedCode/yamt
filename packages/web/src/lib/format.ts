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

/** Grams and per-100 g values: whole above 100, one decimal below ("1.6", "18", "220"). */
export function formatGrams(n: number): string {
  if (n >= 100) return formatNumber(n);
  if (n > 0 && n < 0.1) return n.toFixed(2).replace(/0$/, "");
  return String(Math.round(n * 10) / 10);
}

/** A signed difference: "+120", "−54", "±0". */
export const formatDelta = (n: number): string => {
  const r = Math.round(n);
  return r === 0 ? "±0" : r > 0 ? `+${formatNumber(r)}` : `−${formatNumber(-r)}`;
};

/** A run's length: "850 ms", "7.7 s", "2 min 05 s". */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

/** `datetime-local` value (local time, minutes) for an epoch ms, and back. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (value: string): number | null => {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/** Local midnight of a `YYYY-MM-DD` date (the browser's zone). */
export function dateStart(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!).getTime();
}

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const dayMonthYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "14 Oct" (this year) or "14 Oct 2025" for a `YYYY-MM-DD` date. */
export function formatShortDate(date: string, now = Date.now()): string {
  const ms = dateStart(date);
  return new Date(ms).getFullYear() === new Date(now).getFullYear()
    ? dayMonth.format(ms)
    : dayMonthYear.format(ms);
}

/** Kilograms with one decimal: "81.2". */
export const formatKg = (kg: number): string => kg.toFixed(1);
