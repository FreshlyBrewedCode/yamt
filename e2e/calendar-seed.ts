import { addDays } from "../packages/shared/src/api-goals.ts";
import type { MealDetailResponse, MealResponse } from "../packages/shared/src/api-meals.ts";
import { mealPaths } from "../packages/shared/src/api-meals.ts";
import { profilePaths } from "../packages/shared/src/api-profile.ts";
import { weightPaths } from "../packages/shared/src/api-weight.ts";

/**
 * Made-up months for the calendar (#33), relative to the current month M: M−3 without a goal
 * (kcal only), M−2 without one until the 6th and a guided maintain goal from the 7th, M−1 with a
 * guided cut from the 14th (mid-week, mid-month), and M so far. A few untracked days, meals not
 * analysed yet, days pinned to show every state of the plan encoding, a weight on most days.
 *
 * Meals are copies ("log again", #30) of one analysed meal (the fake agent's `fake:save`: 500 kcal,
 * 25 g protein, 20 g fat, 55 g carbs), scaled to the day's kcal: one analysis, then plain requests.
 * Takes a minimal client, so a spec (Playwright's request) and a scratch script (fetch) can use it.
 */
export interface SeedClient {
  post<T>(path: string, body: unknown): Promise<T>;
  get<T>(path: string): Promise<T>;
}

const SOURCE_KCAL = 500;

/** `YYYY-MM-DD` and local times in the browser's (and the seeding process's) zone. */
export const ymd = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const at = (date: string, hour: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!, hour).getTime();
};
/** `YYYY-MM` plus `n` months. */
export const monthPlus = (month: string, n: number): string => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y!, m! - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// mulberry32: a tiny seeded PRNG, so the data is the same on every run
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CalendarSeed {
  today: string;
  /** M−3, M−2, M−1, M. */
  months: [string, string, string, string];
  /** The cut's kcal target and its first day. */
  cut: { from: string; kcal: number };
  maintain: { from: string; kcal: number };
  /** Days pinned to a kcal share of the target in force (for assertions). */
  pinned: Record<string, number>;
}

export async function seedCalendar(api: SeedClient, now = Date.now()): Promise<CalendarSeed> {
  const today = ymd(now);
  const m0 = today.slice(0, 7);
  const months: CalendarSeed["months"] = [monthPlus(m0, -3), monthPlus(m0, -2), monthPlus(m0, -1), m0];
  const first = `${months[0]}-01`;
  const random = rng(33);
  // today's times, never ahead of now (but on today even just after midnight)
  const earlier = (hour: number, minute: number) =>
    Math.max(at(today, 0) + minute * 60_000, Math.min(at(today, hour), now));

  // weight: a slow loss, faster once the cut starts; most mornings
  const cutFrom = `${months[2]}-14`;
  const maintainFrom = `${months[1]}-07`;
  let kg = 83.4;
  for (let d = first; d <= today; d = addDays(d, 1)) {
    kg -= d >= cutFrom ? 0.06 : 0.02;
    if (random() < 0.85) {
      const measuredAt = d === today ? earlier(7, 1) : at(d, 7);
      await api.post(weightPaths.weight, {
        kg: Math.round((kg + (random() - 0.5) * 0.6) * 10) / 10,
        measuredAt,
      });
    }
  }

  // two guided goals: maintain from the 7th of M−2, a cut from the 14th of M−1
  const profile = {
    sex: "male",
    birthYear: Number(today.slice(0, 4)) - 34,
    heightCm: 181,
    bodyFatPct: null,
    dailyLife: "some_walking",
    training: { sessionsPerWeek: 3, minutes: 60, type: "strength", intensity: "moderate" },
  };
  const guided = async (goal: "maintain" | "cut", effectiveFrom: string) =>
    (
      await api.post<{ goal: { targets: { energyKcal: number } } }>(profilePaths.guidedGoal, {
        profile,
        choices: { goal, pace: "standard", protein: "high", fatPercent: 30 },
        pregnantOrBreastfeeding: false,
        effectiveFrom,
      })
    ).goal.targets.energyKcal;
  const maintainKcal = await guided("maintain", maintainFrom);
  const cutKcal = await guided("cut", cutFrom);

  // the source meal: analysed once by the fake agent, eaten this morning
  const source = (await api.post<MealResponse>(mealPaths.meals, { eatenAt: earlier(8, 2) })).meal.id;
  await api.post(mealPaths.captures(source), { kind: "text", text: "Haferbrei mit Beeren, fake:save" });
  await api.post(mealPaths.analyse(source), {});
  for (let i = 0; ; i++) {
    const status = (await api.get<MealDetailResponse>(mealPaths.meal(source))).meal.status;
    if (status === "analysed") break;
    if (status === "failed" || i > 200) throw new Error(`the source meal didn't analyse: ${status}`);
    await new Promise((r) => setTimeout(r, 100));
  }

  const untracked = new Set([
    `${months[0]}-09`,
    `${months[0]}-17`,
    `${months[0]}-23`,
    `${months[1]}-04`,
    `${months[1]}-13`,
    `${months[1]}-20`,
    `${months[2]}-03`,
    `${months[2]}-04`,
    `${months[2]}-05`,
  ]);
  const pending = new Set([`${months[1]}-24`, `${months[2]}-29`, `${m0}-02`]);
  const pinned: Record<string, number> = {
    // maintain (±10 % on plan): slightly under and over, far under, just off both ways, far over
    [`${months[1]}-08`]: 0.93,
    [`${months[1]}-10`]: 1.07,
    [`${months[1]}-14`]: 0.42,
    [`${months[1]}-17`]: 1.14,
    [`${months[1]}-22`]: 0.86,
    [`${months[1]}-26`]: 1.52,
    [`${months[2]}-10`]: 1.38,
    [`${months[2]}-12`]: 0.95,
    [`${months[2]}-13`]: 1.08,
    // the cut (−15 % … +5 % on plan): under on plan, weekends over, one day too low
    [`${months[2]}-14`]: 0.9,
    [`${months[2]}-15`]: 0.87,
    [`${months[2]}-16`]: 0.97,
    [`${months[2]}-17`]: 1.14,
    [`${months[2]}-18`]: 1.22,
    [`${months[2]}-19`]: 0.92,
    [`${months[2]}-20`]: 0.83,
    [`${months[2]}-21`]: 0.6,
    [`${months[2]}-22`]: 0.95,
    [`${months[2]}-23`]: 1.03,
    [`${months[2]}-24`]: 1.09,
    [`${months[2]}-25`]: 1.31,
    [`${months[2]}-26`]: 0.88,
    [`${months[2]}-27`]: 0.94,
    [`${months[2]}-28`]: 0.79,
    [`${months[2]}-30`]: 1.0,
    [`${months[2]}-31`]: 1.61,
    [`${m0}-01`]: 1.12,
  };

  for (let d = first; d < today; d = addDays(d, 1)) {
    if (untracked.has(d)) continue;
    const target = d >= cutFrom ? cutKcal : d >= maintainFrom ? maintainKcal : 2600;
    const share = pinned[d] ?? 0.82 + random() * 0.3;
    const kcal = target * share;
    // two or three meals; a day with a meal not analysed yet keeps one back
    const meals = pending.has(d) ? 2 : random() < 0.5 ? 2 : 3;
    for (let i = 0; i < meals; i++) {
      const factor = Math.round((kcal / meals / SOURCE_KCAL) * 100) / 100;
      await api.post(mealPaths.repeat(source), { factor, eatenAt: at(d, 8 + i * 5) });
    }
    if (pending.has(d)) {
      const m = (await api.post<MealResponse>(mealPaths.meals, { eatenAt: at(d, 20) })).meal.id;
      await api.post(mealPaths.captures(m), { kind: "text", text: "Abendessen, noch nicht analysiert" });
    }
  }
  // today: breakfast analysed (the source), lunch not yet
  const lunch = (await api.post<MealResponse>(mealPaths.meals, { eatenAt: earlier(12, 3) })).meal.id;
  await api.post(mealPaths.captures(lunch), { kind: "text", text: "Mittagessen, noch nicht analysiert" });

  return {
    today,
    months,
    cut: { from: cutFrom, kcal: cutKcal },
    maintain: { from: maintainFrom, kcal: maintainKcal },
    pinned: Object.fromEntries(Object.entries(pinned).filter(([d]) => d < today)),
  };
}
