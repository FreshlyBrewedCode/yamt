// The nightly run on the phone (#48): which of today's nightly requests the entry screen's
// "Tonight" section shows (a regenerated one only once it has a ready suggestion: the earlier ones
// stay until then), what it says, where Pick puts a suggestion, and the overview's quiet row. Pure,
// so it is tested without a screen.
import type {
  MealSlot,
  PlanningRequestDetail,
  PlanningRoundView,
  PlanningSuggestionView,
} from "@yamt/shared";
import { formatTime, plural } from "./format";
import { slotWords } from "./plan-request";
import { SLOT_NAME } from "./planning";

/**
 * - `ready`: the shown request has ready suggestions (its round may still complete more)
 * - `regenerating`: a newer request runs; the shown one is the earlier, quiet until it's done
 * - `suggesting`: the only request runs, nothing ready yet
 * - `failed`: the only request's round failed with nothing ready
 */
export type NightlyMode = "ready" | "regenerating" | "suggesting" | "failed";

export interface NightlyState {
  mode: NightlyMode;
  /** Whose suggestions the section shows. */
  shown: PlanningRequestDetail;
  /** A newer nightly request that isn't shown: still running (regenerating) or failed. */
  newer: PlanningRequestDetail | null;
}

const suggestionsOf = (d: PlanningRequestDetail) => d.rounds.flatMap((r) => r.suggestions);
const hasReady = (d: PlanningRequestDetail) => suggestionsOf(d).some((s) => s.status === "ready");
const openRound = (d: PlanningRequestDetail): PlanningRoundView | undefined =>
  d.rounds.find((r) => r.status === "queued" || r.status === "running");

/** The section's state from today's nightly requests (newest first); null without any. */
export function nightlyState(requests: readonly PlanningRequestDetail[]): NightlyState | null {
  const newest = requests[0];
  if (!newest) return null;
  if (hasReady(newest)) return { mode: "ready", shown: newest, newer: null };
  const earlier = requests.slice(1).find(hasReady);
  const running = openRound(newest) !== undefined;
  if (earlier) return { mode: running ? "regenerating" : "ready", shown: earlier, newer: newest };
  return { mode: running ? "suggesting" : "failed", shown: newest, newer: null };
}

/**
 * The rows the section lists: every suggestion that is ready (rejected ones fold), then, while a
 * round of it runs, its ideas still outlined as placeholders.
 */
export function nightlyRows(d: PlanningRequestDetail): PlanningSuggestionView[] {
  const open = openRound(d);
  return suggestionsOf(d).filter(
    (s) => s.status === "ready" || (s.status === "outlined" && s.roundId === open?.id),
  );
}

/** "Tonight" while every suggestion (or else the request) is for today's dinner, else "Today". */
export function nightlyTitle(d: PlanningRequestDetail): string {
  const slots = suggestionsOf(d).flatMap((s) => (s.proposedSlot ? [s.proposedSlot] : []));
  const all = slots.length ? slots : d.request.filters.slots;
  return all.every((s) => s === "dinner") ? "Tonight" : "Today";
}

/** The strip's meta: "3 suggestions · made 03:00", "Suggesting · 1 of 3 ready", … */
export function nightlyMeta(state: NightlyState): string {
  const ready = suggestionsOf(state.shown).filter((s) => s.status === "ready").length;
  const made = `made ${formatTime(state.shown.request.createdAt)}`;
  switch (state.mode) {
    case "ready":
      return `${plural(ready, "suggestion")} · ${made}`;
    case "regenerating":
      return "Regenerating";
    case "suggesting": {
      const round = openRound(state.shown);
      return round && round.suggestions.length > 0
        ? `Suggesting · ${ready} of ${round.count} ready`
        : "Suggesting";
    }
    case "failed":
      return "Didn't work";
  }
}

/** Pick's words for a nightly suggestion: "tonight", "lunch", or a day and slot not today's. */
export function nightlyPickWords(at: { date: string; slot: MealSlot }, today: string): string {
  if (at.date !== today) return slotWords(at, today);
  return at.slot === "dinner" ? "tonight" : SLOT_NAME[at.slot].toLowerCase();
}

/**
 * The overview's quiet row (G: nobody asked, so not lime): the shown request's suggestions still
 * waiting for a verdict, their titles and when they were made; null when none wait.
 */
export function nightlyStripRow(
  requests: readonly PlanningRequestDetail[],
): { requestId: string; title: string; waiting: number; titles: string[]; madeAt: number } | null {
  const state = nightlyState(requests);
  if (!state || state.mode === "suggesting" || state.mode === "failed") return null;
  const waiting = suggestionsOf(state.shown).filter((s) => s.status === "ready" && s.verdict === null);
  if (waiting.length === 0) return null;
  return {
    requestId: state.shown.request.id,
    title: nightlyTitle(state.shown),
    waiting: waiting.length,
    titles: waiting.map((s) => s.title),
    madeAt: state.shown.request.createdAt,
  };
}
