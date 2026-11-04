// The weight trend (#12): raw entries and a 7-day moving average over calendar days.
import { dailyWeights } from "@yamt/shared";
import { dateStart, localDate } from "./format";

export interface WeightPoint {
  at: number;
  kg: number;
}

export interface AvgPoint extends WeightPoint {
  /** The calendar day (`YYYY-MM-DD`, the phone's zone). */
  date: string;
}

/**
 * Raw entries (any order) → the raw points, oldest first, and one moving-average point per day
 * with an entry: the mean of the daily means (several weighings on one day count as one) of
 * the `windowDays` days up to and including it. The average sits at noon of its day.
 */
export function weightTrend(
  entries: readonly WeightPoint[],
  windowDays = 7,
): { raw: WeightPoint[]; avg: AvgPoint[] } {
  const raw = [...entries].sort((a, b) => a.at - b.at).map(({ at, kg }) => ({ at, kg }));
  const days = new Map<string, number[]>();
  for (const p of raw) {
    const d = localDate(p.at);
    days.set(d, [...(days.get(d) ?? []), p.kg]);
  }
  const avg = dailyWeights(days, windowDays).map(({ date, avg }) => ({
    date,
    at: dateStart(date) + 12 * 3_600_000,
    kg: avg,
  }));
  return { raw, avg };
}

/** Gridline values for a kg range: a clean step (0.5, 1, 2, 5) giving three or four lines. */
export function kgTicks(min: number, max: number): number[] {
  const span = Math.max(max - min, 0.5);
  const step = [0.5, 1, 2, 5, 10].find((s) => span / s <= 3.5) ?? 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 10) / 10);
  return out;
}
