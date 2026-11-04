import { z } from "zod";

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
