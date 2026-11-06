// A planning request on the phone (#47): the filters the entry screen edits (overrides over the
// defaults from Settings → Planning), the summary row and the sentence "how the agent reads it",
// where a pick will go, and how far a round is. Pure: the screens and their tests share it.
import {
  addDays,
  MAX_PLANNING_DAYS,
  type MealSlot,
  PLANNING_DEFAULTS,
  type PlanDay,
  type PlanningRequest,
  type PlanningRequestSummary,
  type PlanningRoundView,
  type PlanningSettingsBody,
  type PlanningSuggestion,
  type RecipeSourceMode,
  type ResolvedPlanningFilters,
  requestTitle,
} from "@yamt/shared";
import { formatWeekday, plural } from "./format";
import { SLOT_NAME, SLOTS } from "./planning";

/** When the request is for: a preset, or days picked by hand. */
export type WhenPreset = "today" | "tomorrow" | "week" | "days";

export const WHEN_LABEL: Record<WhenPreset, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  week: "Rest of the week",
  days: "Pick days",
};

/** The time caps the filter page offers (null: any time). */
export const TIME_CAPS: readonly (number | null)[] = [20, 30, 45, null];
export const timeLabel = (min: number | null): string => (min === null ? "Any time" : `≤ ${min} min`);

/** The filter page's constraints (`PLANNING_CONSTRAINTS`); free strings show as they are. */
export const CONSTRAINT_LABEL: Record<string, string> = {
  no_oven: "No oven",
  one_pot: "One pot",
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  high_protein: "High protein",
  low_carb: "Low carb",
};
export const constraintLabel = (c: string): string => CONSTRAINT_LABEL[c] ?? c;

export const MODE_LABEL: Record<RecipeSourceMode, { title: string; short: string; detail: string }> = {
  published: {
    title: "Real recipes only",
    short: "real recipes only",
    detail: "As published: ingredients and amounts untouched.",
  },
  adapted: {
    title: "Based on a real recipe",
    short: "based on a real recipe",
    detail: "A real recipe, adapted to the goal and what you have; every change listed.",
  },
  composed: {
    title: "Free",
    short: "free recipes",
    detail: "The agent may compose its own dish from what you have.",
  },
};

/**
 * What the user set on the filter page or a starter filled in: every field optional, laid over
 * the defaults (`filterDefaults`) when the request is made. `days` only counts with `when: "days"`;
 * `useUp` are short texts ("½ Hokkaido"), `leftovers` ids of the leftovers list (#49).
 */
export interface FilterDraft {
  when?: WhenPreset;
  days?: string[];
  slots?: MealSlot[];
  timeCapMin?: number | null;
  constraints?: string[];
  useUp?: string[];
  leftovers?: string[];
  sourceMode?: RecipeSourceMode;
  portionsCooked?: number;
  count?: number;
}

/** What a request leaves out: `PLANNING_DEFAULTS` with Settings → Planning's count, source and portions. */
export function filterDefaults(
  settings: Pick<PlanningSettingsBody, "count" | "sourceMode" | "portionsCooked"> | undefined,
): Omit<ResolvedPlanningFilters, "days"> {
  return {
    ...PLANNING_DEFAULTS,
    ...(settings
      ? { count: settings.count, sourceMode: settings.sourceMode, portionsCooked: settings.portionsCooked }
      : {}),
  };
}

/** Today through Sunday (just today on a Sunday). */
export function restOfWeek(today: string): string[] {
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday 0
  return Array.from({ length: 7 - weekday }, (_, i) => addDays(today, i));
}

/** The days a draft means, sorted, today or later (empty: none picked yet). */
export function draftDays(draft: FilterDraft, today: string): string[] {
  switch (draft.when ?? "today") {
    case "today":
      return [today];
    case "tomorrow":
      return [addDays(today, 1)];
    case "week":
      return restOfWeek(today);
    case "days":
      return [...new Set(draft.days ?? [])]
        .filter((d) => d >= today)
        .sort()
        .slice(0, MAX_PLANNING_DAYS);
  }
}

/** The complete filters the request is made with (the server would fill the same gaps). */
export function resolveDraft(
  draft: FilterDraft,
  defaults: Omit<ResolvedPlanningFilters, "days">,
  today: string,
): ResolvedPlanningFilters {
  const slots = SLOTS.filter((s) => (draft.slots ?? defaults.slots).includes(s));
  return {
    days: draftDays(draft, today),
    slots: slots.length ? slots : defaults.slots,
    timeCapMin: draft.timeCapMin === undefined ? defaults.timeCapMin : draft.timeCapMin,
    constraints: draft.constraints ?? defaults.constraints,
    useUp:
      draft.useUp || draft.leftovers
        ? [
            ...(draft.leftovers ?? []).map((leftoverId) => ({ leftoverId })),
            ...(draft.useUp ?? []).map((text) => ({ text })),
          ]
        : defaults.useUp,
    sourceMode: draft.sourceMode ?? defaults.sourceMode,
    portionsCooked: draft.portionsCooked ?? defaults.portionsCooked,
    count: draft.count ?? defaults.count,
  };
}

/** Why a draft can't be sent yet; null when it can. */
export function draftProblem(f: ResolvedPlanningFilters): string | null {
  if (f.days.length === 0) return "Pick a day in the filters.";
  return null;
}

/**
 * The days in words for the summary: "Today", "Tomorrow", "Tue–Thu", "Tue, Thu"; weekdays only
 * without `today` (a request's days are absolute).
 */
function daysWords(days: readonly string[], today: string | null): string {
  const first = days[0];
  if (!first) return "Pick days";
  if (today !== null && days.length === 1 && first === today) return "Today";
  if (today !== null && days.length === 1 && first === addDays(today, 1)) return "Tomorrow";
  const consecutive = days.every((d, i) => i === 0 || d === addDays(days[i - 1]!, 1));
  if (consecutive && days.length > 2) return `${formatWeekday(first)}–${formatWeekday(days.at(-1)!)}`;
  return days.map(formatWeekday).join(", ");
}

/** A leftover's name by its id (the leftovers list), for the words; one not on it is "a leftover". */
export type LeftoverNames = ReadonlyMap<string, string>;

const leftoverTexts = (f: Pick<ResolvedPlanningFilters, "useUp">, names?: LeftoverNames): string[] =>
  f.useUp.map((u) => ("text" in u ? u.text : (names?.get(u.leftoverId) ?? "a leftover")));

/**
 * The filter summary's words ("Tonight · Dinner · ≤ 30 min · use ½ Hokkaido · cook 2"): when,
 * which meals, then only what isn't a default (the source mode and count against the settings').
 */
export function summaryWords(
  f: ResolvedPlanningFilters,
  defaults: Pick<ResolvedPlanningFilters, "sourceMode" | "count">,
  today: string,
  names?: LeftoverNames,
): string[] {
  const dinnerOnly = f.slots.length === 1 && f.slots[0] === "dinner";
  const when = daysWords(f.days, today);
  const out = [when === "Today" && dinnerOnly ? "Tonight" : when];
  out.push(f.slots.map((s) => SLOT_NAME[s]).join(" + "));
  if (f.timeCapMin !== null) out.push(timeLabel(f.timeCapMin));
  for (const c of f.constraints) out.push(constraintLabel(c));
  const useUp = leftoverTexts(f, names);
  if (useUp.length) out.push(`use ${useUp.join(", ")}`);
  if (f.sourceMode !== defaults.sourceMode) out.push(MODE_LABEL[f.sourceMode].short);
  if (f.count !== defaults.count) out.push(`${f.count} ideas`);
  if (f.portionsCooked !== 1) out.push(`cook ${f.portionsCooked}`);
  return out;
}

/** A request's filters as chips in the thread ("You asked"): the summary plus the source mode. */
export function askedWords(f: ResolvedPlanningFilters, today: string, names?: LeftoverNames): string[] {
  const words = summaryWords(f, { sourceMode: f.sourceMode, count: f.count }, today, names);
  // a request's days are absolute: past "Today" reads wrong, so the thread names weekdays
  words[0] = daysWords(f.days, null);
  return [...words, MODE_LABEL[f.sourceMode].short, `${f.count} per round`];
}

const listWords = (xs: readonly string[]): string =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

/**
 * The request as the agent will read it, in one sentence pair: "Dinner tonight, ≤ 30 min total,
 * no oven, using ½ Hokkaido. 3 suggestions, based on a real recipe, 2 portions each (eat one,
 * keep the rest)."
 */
export function requestSentence(f: ResolvedPlanningFilters, today: string, names?: LeftoverNames): string {
  const slots = listWords(f.slots.map((s) => SLOT_NAME[s].toLowerCase()));
  const first = f.days[0];
  let what: string;
  if (!first) what = `${slots.charAt(0).toUpperCase()}${slots.slice(1)}, days not picked yet`;
  else if (f.days.length === 1 && first === today) {
    const when = f.slots.length === 1 && f.slots[0] === "dinner" ? "tonight" : "today";
    what = `${slots.charAt(0).toUpperCase()}${slots.slice(1)} ${when}`;
  } else if (f.days.length === 1 && first === addDays(today, 1)) {
    what = `${slots.charAt(0).toUpperCase()}${slots.slice(1)} tomorrow`;
  } else what = requestTitle(f);
  const parts = [what];
  if (f.timeCapMin !== null) parts.push(`≤ ${f.timeCapMin} min total`);
  for (const c of f.constraints) parts.push(constraintLabel(c).toLowerCase());
  const useUp = leftoverTexts(f, names);
  if (useUp.length) parts.push(`using ${listWords(useUp)}`);
  const portions =
    f.portionsCooked === 1
      ? "one portion each"
      : `${f.portionsCooked} portions each (eat one, keep the rest)`;
  const count = f.count === 1 ? "1 suggestion" : `${f.count} suggestions`;
  return `${parts.join(", ")}. ${count}, ${MODE_LABEL[f.sourceMode].short}, ${portions}.`;
}

/** A meal slot in a sentence: "Wed dinner", "Today lunch". */
export function slotWords(at: { date: string; slot: MealSlot }, today: string): string {
  const day =
    at.date === today ? "Today" : at.date === addDays(today, 1) ? "Tomorrow" : formatWeekday(at.date);
  return `${day} ${SLOT_NAME[at.slot].toLowerCase()}`;
}

/** Nothing eaten or still planned in the slot (snacks: nothing planned), as the server judges it. */
function slotOpen(day: PlanDay, slot: MealSlot): boolean {
  if (slot === "snack") return !day.plannedMeals.some((p) => p.slot === "snack" && p.status === "planned");
  return day.openSlots.includes(slot);
}

/**
 * Where Pick will put a suggestion, mirroring the server (`pickTarget`): the proposed day and slot
 * (a past day doesn't count), else the first of the request's days from today and its slots (or
 * the proposed slot) that is open on the plan, else the first of them. `days` is the plan of the
 * request's days; without it the first candidate.
 */
export function pickTarget(
  s: Pick<PlanningSuggestion, "proposedDate" | "proposedSlot">,
  request: Pick<PlanningRequest, "filters">,
  days: readonly PlanDay[] | undefined,
  today: string,
): { date: string; slot: MealSlot } {
  const date = s.proposedDate && s.proposedDate >= today ? s.proposedDate : null;
  const slot = s.proposedSlot;
  if (date && slot) return { date, slot };
  const slots = slot ? [slot] : request.filters.slots;
  let candidates = date ? [date] : request.filters.days.filter((d) => d >= today);
  if (candidates.length === 0) candidates = [today];
  const byDate = new Map((days ?? []).map((d) => [d.date, d]));
  for (const d of candidates) {
    const day = byDate.get(d);
    for (const sl of slots) {
      if (!day || slotOpen(day, sl)) return { date: d, slot: sl };
    }
  }
  return { date: candidates[0]!, slot: slots[0] ?? "dinner" };
}

/** How far a round is: "1 of 3 ready", "2 of 3 · 1 couldn't", "Queued", "Failed". */
export function roundMeta(round: PlanningRoundView): string {
  const ready = round.suggestions.filter((s) => s.status === "ready").length;
  const failed = round.suggestions.filter((s) => s.status === "failed").length;
  if (round.status === "failed") return ready ? `Failed · ${ready} ready` : "Failed";
  if (round.status === "queued") return ready ? `Queued · ${ready} of ${round.count} ready` : "Queued";
  if (round.status === "running") {
    return round.suggestions.length === 0 ? "Outlining…" : `${ready} of ${round.count} ready`;
  }
  if (failed) return `${ready} of ${round.count} · ${failed} couldn't`;
  return ready === 1 ? "1 suggestion" : `${ready} suggestions`;
}

/** The suggestions of a round still waiting for a verdict (ready, neither picked nor rejected). */
export const unanswered = (round: PlanningRoundView): number =>
  round.suggestions.filter((s) => s.status === "ready" && s.verdict === null).length;

/* ------------------------------------------------------------- the overview */

/** How an open request stands, for the overview's Planning strip; null when it wants nothing. */
export function requestState(
  r: PlanningRequestSummary,
): { kind: "waiting" | "suggesting" | "failed" | "added"; label: string; count: number } | null {
  const round = r.latestRound;
  if (!round)
    return r.pendingInputs > 0 || r.inputs > 0 ? { kind: "suggesting", label: "Queued", count: 0 } : null;
  if (round.status === "queued" || round.status === "running") {
    const done = round.ready + round.failed;
    return {
      kind: "suggesting",
      label:
        round.status === "queued" && done === 0
          ? "Queued"
          : `Suggesting · ${round.ready} of ${round.count} ready`,
      count: round.ready,
    };
  }
  if (round.status === "failed") return { kind: "failed", label: "Failed", count: 0 };
  const open = round.ready - round.picked - round.rejected;
  if (open > 0) return { kind: "waiting", label: `Suggested · ${open} for you`, count: open };
  if (r.pendingInputs > 0)
    return { kind: "added", label: `${plural(r.pendingInputs, "addition")} · suggest with it`, count: 0 };
  return null;
}

export type RequestState = NonNullable<ReturnType<typeof requestState>>;

/** A request whose filter days are all before `today` (the phone's zone): done wanting the overview. */
export function isPastRequest(r: Pick<PlanningRequestSummary, "request">, today: string): boolean {
  return r.request.filters.days.every((d) => d < today);
}

export interface StripRow {
  r: PlanningRequestSummary;
  state: RequestState;
}

/**
 * The open requests that still want the overview's strip: not past, each with its own state. The
 * nightly ones (#48) have their own quiet row (`nightlyStripRow`), never counted as waiting.
 */
export function stripRows(requests: readonly PlanningRequestSummary[], today: string): StripRow[] {
  return requests.flatMap((r) => {
    if (r.request.origin === "nightly" || isPastRequest(r, today)) return [];
    const state = requestState(r);
    return state ? [{ r, state }] : [];
  });
}

/**
 * The strip's rows folded to one per state, in the order each state first appears: a state more
 * than one request shares becomes a group instead of several full rows.
 */
export function groupStripRows(
  rows: readonly StripRow[],
): { kind: RequestState["kind"]; rows: StripRow[] }[] {
  const order: RequestState["kind"][] = [];
  const groups = new Map<RequestState["kind"], StripRow[]>();
  for (const row of rows) {
    const g = groups.get(row.state.kind);
    if (g) g.push(row);
    else {
      groups.set(row.state.kind, [row]);
      order.push(row.state.kind);
    }
  }
  return order.map((kind) => ({ kind, rows: groups.get(kind)! }));
}
