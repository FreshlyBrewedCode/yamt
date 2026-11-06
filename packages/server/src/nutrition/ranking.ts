import type { Nutrients } from "@yamt/shared";

/**
 * Where a search candidate came from: the user's own history, yamt's food cache (anything looked
 * up before, no network), Open Food Facts, USDA FDC.
 */
export type CandidateOrigin = "history" | "cache" | "off" | "fdc";

export interface RankInput {
  origin: CandidateOrigin;
  name: string;
  brand: string | null;
  per100g: Nutrients;
  /** Position in its source's own result list (0 = the source's best). */
  sourceRank: number;
  /** History only: distinct meals it was used in. */
  meals?: number;
}

/** Lower-case, umlauts and accents folded (ä → a, ß → ss), split into words. */
export function words(s: string): string[] {
  return (
    s
      .toLowerCase()
      .replace(/ß/g, "ss")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/** Personal history outranks Open Food Facts outranks FDC at equal match quality. */
const ORIGIN_BONUS: Record<CandidateOrigin, number> = { history: 0.4, cache: 0.1, off: 0.1, fdc: 0 };

/**
 * A candidate's score (higher is better), from:
 * - match: the share of query words that start a word of the name or brand (0..1), +0.1 when all
 *   of them are in the name itself, and up to +0.1 for a short name (generic beats "… mit Erdbeer");
 * - origin: history +0.4 (+0.05 per meal it was used in, up to 4), the cache and OFF +0.1, FDC 0;
 * - the source's own order: −0.02 per place;
 * - completeness: −0.5 without energy, −0.05 per missing protein, fat or carbohydrate.
 */
export function scoreCandidate(query: string, c: RankInput): number {
  const q = words(query);
  const name = words(c.name);
  const all = [...name, ...words(c.brand ?? "")];
  const hits = (list: string[]) => q.filter((w) => list.some((t) => t.startsWith(w))).length;
  let score = 0;
  if (q.length > 0) {
    score += hits(all) / q.length;
    if (hits(name) === q.length) score += 0.1;
    score += 0.1 * Math.min(1, q.length / Math.max(1, name.length));
  }
  score += ORIGIN_BONUS[c.origin];
  if (c.origin === "history") score += 0.05 * Math.min(4, c.meals ?? 0);
  score -= 0.02 * c.sourceRank;
  if (c.per100g.energyKcal === null) score -= 0.5;
  for (const k of ["protein", "fat", "carbohydrate"] as const) if (c.per100g[k] === null) score -= 0.05;
  return Math.round(score * 1000) / 1000;
}

/** Scores and sorts candidates, best first; ties keep their order (history, OFF, FDC). */
export function rankCandidates<T extends RankInput>(
  query: string,
  list: readonly T[],
): (T & { score: number })[] {
  return list
    .map((c, i) => ({ ...c, score: scoreCandidate(query, c), i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ i: _i, ...c }) => c as unknown as T & { score: number });
}
