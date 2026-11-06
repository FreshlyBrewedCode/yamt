import {
  addDays,
  type MealSlot,
  type PlanDay,
  type PlanningPreferences,
  type PlanningSuggestionView,
} from "@yamt/shared";
import { isVoiceInput } from "../db/repos/planning-inputs.ts";
import { HttpError } from "../domain/errors.ts";
import { planningSettings } from "../domain/planning-settings.ts";
import { dayRange, isoLocal, localDate } from "../domain/time.ts";
import type { Services } from "../services.ts";
import { slotBudget } from "./budget.ts";

/** How far back the context lists meals, for variety. */
export const RECENT_DAYS = 14;
/** Main items listed per recent meal or earlier suggestion (the biggest by kcal). */
const MAIN_ITEMS = 4;

/** A leftover to use up (#49's list); until then the list is empty. */
export interface PlanningLeftover {
  leftoverId: string;
  description: string;
  grams: number | null;
  note: string | null;
}

/** The user's planning preferences (#36's Settings → Planning, #46): the saved setting's, or its defaults. */
export function planningPreferences(s: Services): PlanningPreferences {
  return planningSettings(s.repos.settings).preferences;
}

/** Until #49: none. */
export function planningLeftovers(_s: Services): PlanningLeftover[] {
  return [];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]!;

const kcalOf = (grams: number, per100g: { energyKcal: number | null }) =>
  ((per100g.energyKcal ?? 0) * grams) / 100;

/** The ids of a round's run principal, for the error when it asks for another one. */
export function roundOf(s: Services, roundId: string) {
  const round = s.repos.planningRounds.get(roundId);
  if (!round) throw new HttpError(404, `no planning round ${roundId}`);
  const request = s.repos.planningRequests.get(round.requestId)!;
  return { round, request };
}

/**
 * Everything a planning round needs in one read (`get_planning_context`, #45): the request (its
 * filters and every live input, with transcripts and the local paths of photos and files), this
 * round (its kind, count and an outline an earlier attempt left), the earlier rounds with their
 * suggestions and the user's verdicts, each target day (eaten, planned, open slots) with a budget
 * per requested slot computed in code (`slotBudget`), the goal, the meals of the last
 * `RECENT_DAYS` days with their main items, leftovers and preferences.
 */
export function planningContext(s: Services, roundId: string) {
  const { round, request } = roundOf(s, roundId);
  const tz = request.timeZone;
  const today = localDate(Date.now(), tz);
  const at = (ms: number) => isoLocal(ms, tz);
  const detail = s.planningRequests.detail(request.id);
  const transcripts = new Map(detail.transcripts.map((t) => [t.inputId, t]));
  const rounds = new Map(detail.rounds.map((r) => [r.id, r]));

  const inputs = s.repos.planningInputs
    .listForRequest(request.id)
    .filter((i) => i.retractedAt === null)
    .map((i) => {
      const out: Record<string, unknown> = {
        inputId: i.id,
        kind: i.kind,
        at: at(i.takenAt ?? i.capturedAt ?? i.createdAt),
        // the round it came with; null: none yet (it arrived during this round and waits for the next)
        round: i.roundId ? (rounds.get(i.roundId)?.number ?? null) : null,
        newThisRound: i.roundId === round.id,
      };
      if (i.text) out.text = i.text;
      if (i.url) out.url = i.url;
      if (isVoiceInput(i)) {
        const t = transcripts.get(i.id);
        out.transcript = t ? { status: t.status, text: t.text } : null;
      } else if (i.mediaPath) {
        const path = i.kind === "image" ? (i.jpegPath ?? i.mediaPath) : i.mediaPath;
        out.media = {
          mimeType: i.kind === "image" && i.jpegPath ? "image/jpeg" : i.mimeType,
          fileName: i.fileName,
          path: s.media.absolute(path),
        };
      }
      return out;
    });

  const allSuggestions = detail.rounds.flatMap((r) => r.suggestions);
  const recipeIds = allSuggestions.flatMap((x) => (x.recipeId ? [x.recipeId] : []));
  const items = s.repos.recipes.itemsOf(recipeIds);
  const suggestionOut = (x: PlanningSuggestionView) => ({
    position: x.position,
    status: x.status,
    title: x.title,
    approach: x.approach,
    sourceMode: x.sourceMode,
    ...(x.sourceUrl ? { sourceUrl: x.sourceUrl } : {}),
    ...(x.proposedDate ? { proposedDate: x.proposedDate, proposedSlot: x.proposedSlot } : {}),
    ...(x.why.length ? { why: x.why } : {}),
    ...(x.failure ? { failure: x.failure } : {}),
    // the user's: picked (planned), rejected ("no"), or none yet
    verdict: x.verdict,
    ...(x.perPortion
      ? { perPortion: { kcal: x.perPortion.nutrients.energyKcal, protein: x.perPortion.nutrients.protein } }
      : {}),
    ...(x.recipe
      ? {
          timeTotalMin: x.recipe.timeTotalMin,
          mainIngredients: [...(items.get(x.recipe.id) ?? [])]
            .sort((a, b) => kcalOf(b.grams, b.per100g) - kcalOf(a.grams, a.per100g))
            .slice(0, MAIN_ITEMS)
            .map((i) => i.description),
        }
      : {}),
  });
  const earlierRounds = detail.rounds
    .filter((r) => r.number < round.number)
    .map((r) => ({
      number: r.number,
      kind: r.kind,
      status: r.status,
      ...(r.error ? { error: r.error } : {}),
      suggestions: r.suggestions.map(suggestionOut),
    }));
  const own = rounds.get(round.id);

  const { days: wanted, slots } = request.filters;
  const plan = s.planning.plan({ from: wanted[0]!, to: wanted.at(-1)!, tz });
  const byDate = new Map(plan.days.map((d) => [d.date, d]));
  const days = wanted.flatMap((date) => {
    const d = byDate.get(date);
    return d ? [dayOut(d, slots, at)] : [];
  });

  const goal = s.repos.goals.inForce(today);
  return {
    today,
    timeZone: tz,
    request: {
      requestId: request.id,
      title: request.title,
      origin: request.origin,
      filters: request.filters,
    },
    inputs,
    round: {
      roundId: round.id,
      number: round.number,
      kind: round.kind,
      count: round.count,
      // what an earlier attempt of this round outlined (a new outline replaces it)
      ...(own?.suggestions.length ? { earlierAttempt: own.suggestions.map(suggestionOut) } : {}),
    },
    earlierRounds,
    days,
    goal: goal ? { effectiveFrom: goal.effectiveFrom, targets: goal.targets, note: goal.note || null } : null,
    recentMeals: recentMeals(s, today, tz),
    leftovers: planningLeftovers(s),
    preferences: planningPreferences(s),
  };
}

function dayOut(d: PlanDay, slots: readonly MealSlot[], at: (ms: number) => string) {
  const core = (n: { energyKcal: number; protein: number } | undefined) =>
    n ? { kcal: n.energyKcal, protein: n.protein } : null;
  return {
    date: d.date,
    weekday: weekday(d.date),
    meals: d.meals.map((m) => ({
      at: at(m.eatenAt).slice(11, 16),
      slot: m.slot,
      title: m.title ?? "(not analysed yet)",
      ...(m.totals ? core(m.totals.nutrients) : {}),
    })),
    planned: d.plannedMeals
      .filter((p) => p.status === "planned")
      .map((p) => ({ slot: p.slot, title: p.title, ...core(p.eaten.nutrients) })),
    eaten: core(d.eaten?.nutrients),
    projected: core(d.projected?.nutrients),
    openSlots: d.openSlots,
    // computed by yamt: what one portion should stay within in each requested slot
    slots: slots.map((slot) => slotBudget(d, slot)),
  };
}

/** The analysed meals of the last `RECENT_DAYS` days, newest first, with their main items. */
function recentMeals(s: Services, today: string, tz: string) {
  const from = addDays(today, -RECENT_DAYS);
  const plan = s.planning.plan({ from, to: today, tz });
  const items = new Map<string, { description: string; kcal: number }[]>();
  for (const { mealId, item } of s.repos.revisions.currentItemsBetween(
    dayRange(from, tz).from,
    dayRange(today, tz).to,
  )) {
    items.set(mealId, [
      ...(items.get(mealId) ?? []),
      { description: item.description, kcal: kcalOf(item.grams, item.per100g) },
    ]);
  }
  return plan.days
    .flatMap((d) =>
      d.meals
        .filter((m) => m.totals !== null)
        .map((m) => ({
          date: d.date,
          slot: m.slot,
          title: m.title,
          kcal: m.totals!.nutrients.energyKcal,
          protein: m.totals!.nutrients.protein,
          mainItems: [...(items.get(m.mealId) ?? [])]
            .sort((a, b) => b.kcal - a.kcal)
            .slice(0, MAIN_ITEMS)
            .map((i) => i.description),
        })),
    )
    .reverse();
}
