import { z } from "zod";
import { addDays } from "./api-goals.ts";

/** Weight entries (#6). Unlike captures they are plain user data: they can be deleted. */

export const weightPaths = {
  weight: "/api/weight",
  entry: (id: string) => `/api/weight/${id}`,
} as const;

export const WeightSource = z.enum(["manual"]);
export type WeightSource = z.infer<typeof WeightSource>;

export interface WeightEntry {
  id: string;
  measuredAt: number;
  kg: number;
  note: string;
  source: WeightSource;
  createdAt: number;
}

/** `POST /api/weight`. `measuredAt` defaults to now. */
export const WeightBody = z
  .object({
    measuredAt: z.number().int().nonnegative().optional(),
    kg: z.number().positive().max(500),
    note: z.string().trim().max(1_000).default(""),
  })
  .strict();
export type WeightBody = z.infer<typeof WeightBody>;

/** `GET /api/weight?from&to&limit`: entries measured in [from, to), newest first. */
export const WeightQuery = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(5_000).default(1_000),
});
export type WeightQuery = z.infer<typeof WeightQuery>;

export interface WeightResponse {
  entries: WeightEntry[];
}

export interface WeightEntryResponse {
  entry: WeightEntry;
}

/**
 * The weight trend's core (#12, the calendar's too): weighings already grouped by calendar day →
 * one point per day with entries, oldest first: the day's mean (several weighings count as one)
 * and the moving average, the mean of the daily means of the `windowDays` days up to and
 * including it. Rounded to hundredths.
 */
export function dailyWeights(
  byDay: ReadonlyMap<string, readonly number[]>,
  windowDays = 7,
): { date: string; kg: number; avg: number }[] {
  const daily = [...byDay]
    .filter(([, kgs]) => kgs.length > 0)
    .map(([date, kgs]) => ({ date, kg: mean(kgs) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return daily.map(({ date, kg }) => {
    const first = addDays(date, -(windowDays - 1));
    const inWindow = daily.filter((d) => d.date >= first && d.date <= date).map((d) => d.kg);
    return { date, kg: round2(kg), avg: round2(mean(inWindow)) };
  });
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round2 = (n: number) => Math.round(n * 100) / 100;
