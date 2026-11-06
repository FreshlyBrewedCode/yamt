// The entry screen's starters (#47, G's starter bands): ideas with a live number. The nightly run
// (#48) writes some (the agent picks the idea, its kind and what it is about); code computes the
// others from what the app already has (the plan of today and tomorrow, the meals logged most, the
// month, the last request, a leftover to use up, #49). Every number is computed here, when the
// screen renders, never by the run. A tap fills the composer and the filters. Pure, so it is tested
// without a screen.
import {
  addDays,
  type LeftoverView,
  type PlanDay,
  type PlanningRequest,
  type PlanningStarterView,
  type RepeatableMeal,
  type StarterKind,
} from "@yamt/shared";
import { dateStart, dayLabel, formatNumber, formatWeekday, localDate, plural, startOfDay } from "./format";
import { leftoverNumber } from "./leftovers";
import type { FilterDraft } from "./plan-request";

/** The code-computed starters' ids. */
export type CodeStarterId = "protein" | "kcal" | "leftover" | "again" | "season" | "last";

export interface Starter {
  /** A code starter's id, or the agent's starter's. */
  id: CodeStarterId | (string & {});
  /** What it is about: an agent starter's kind, a code starter's equivalent. */
  kind: StarterKind;
  /** Who wrote the idea: the nightly run's agent, or code. */
  by: "agent" | "code";
  /** The number it carries ("82", "4×", "Nov", "Sat") and what it is; null: no number to show. */
  number: string | null;
  unit: string;
  /** The idea, as the band's headline. */
  text: string;
  /** One line of why, from the user's data. */
  why: string;
  /** What a tap fills into the composer's field. */
  composerText: string;
  /** What a tap sets the filters to (over the defaults). */
  draft: FilterDraft;
}

/**
 * What is in season in Germany, per month (January first): a static list, the first four shown.
 * Produce names stay German, like the meal titles the agent writes.
 */
export const SEASON: readonly (readonly string[])[] = [
  ["Grünkohl", "Rosenkohl", "Lauch", "Pastinake", "Rote Bete", "Wirsing"],
  ["Grünkohl", "Rosenkohl", "Lauch", "Schwarzwurzel", "Pastinake", "Chicorée"],
  ["Bärlauch", "Lauch", "Feldsalat", "Spinat", "Chicorée"],
  ["Bärlauch", "Spargel", "Rhabarber", "Radieschen", "Spinat"],
  ["Spargel", "Rhabarber", "Erdbeeren", "Kohlrabi", "Radieschen"],
  ["Erdbeeren", "Spargel", "Zucchini", "Kirschen", "Erbsen", "Kohlrabi"],
  ["Zucchini", "Tomaten", "Bohnen", "Gurken", "Heidelbeeren", "Aprikosen"],
  ["Tomaten", "Paprika", "Mais", "Auberginen", "Zwetschgen", "Brombeeren"],
  ["Kürbis", "Zwetschgen", "Pilze", "Äpfel", "Paprika", "Birnen"],
  ["Kürbis", "Pilze", "Äpfel", "Rote Bete", "Birnen", "Mangold"],
  ["Kürbis", "Grünkohl", "Rosenkohl", "Birnen", "Pastinake", "Wirsing"],
  ["Grünkohl", "Rosenkohl", "Rotkohl", "Pastinake", "Feldsalat", "Äpfel"],
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Less protein open than this isn't worth a starter. */
export const MIN_PROTEIN_OPEN = 20;
/** A meal logged fewer times in the window isn't a favourite yet. */
export const MIN_TIMES = 2;

/** The last request with what came of it, for "like last time". */
export interface LastRequest {
  request: PlanningRequest;
  /** Its first text input, if any. */
  text: string | null;
  picked: number;
  suggested: number;
}

export interface StarterInput {
  today: string;
  now: number;
  /** The plan of today and tomorrow (either may be missing while loading). */
  days: readonly PlanDay[];
  /** Meals logged again lately (`GET /api/meals/repeatable`). */
  repeatable: readonly RepeatableMeal[];
  last: LastRequest | null;
  /** The nightly run's starters (#48), in its order; none without. */
  agent?: readonly PlanningStarterView[];
  /** The open leftovers (#49), oldest first. */
  leftovers?: readonly LeftoverView[];
}

/** At most this many starter bands. */
export const MAX_SHOWN_STARTERS = 6;

/**
 * The starters, in the order the screen shows them (the first is the screen's ink slab): the
 * nightly run's (#48) first, in its order, then the code-computed ones of a kind it didn't write:
 * what is open tonight (protein, else kcal; tomorrow once tonight's dinner is eaten or planned), the
 * oldest leftover to use up (not a cooked dish: the plan offers those itself), the meal logged most
 * ("like …, but different"), the season, the last request. A code starter only when its data is
 * there: nothing is invented.
 */
export function computeStarters(i: StarterInput): Starter[] {
  const code = [openStarter(i), leftoverStarter(i), againStarter(i), seasonStarter(i), lastStarter(i)].filter(
    (s): s is Starter => s !== null,
  );
  const agent = (i.agent ?? []).map((s) => agentStarter(s, i));
  const written = new Set(agent.map((s) => s.kind));
  return [...agent, ...code.filter((c) => !written.has(c.kind))].slice(0, MAX_SHOWN_STARTERS);
}

/**
 * A starter the nightly run wrote: its idea, why and filters as written, its number computed now
 * from the kind and what the reference names (`liveNumber`).
 */
export function agentStarter(s: PlanningStarterView, i: StarterInput): Starter {
  const live = liveNumber(s, i);
  const f = s.filters;
  return {
    id: s.id,
    kind: s.kind,
    by: "agent",
    number: live.number,
    unit: live.unit,
    text: s.text,
    why: s.detail || live.why,
    composerText: s.text,
    draft: {
      ...(f.when ? { when: f.when } : {}),
      ...(f.slots ? { slots: f.slots } : {}),
      ...(f.timeCapMin !== undefined ? { timeCapMin: f.timeCapMin } : {}),
      ...(f.constraints ? { constraints: f.constraints } : {}),
      ...(f.useUp ? { useUp: f.useUp } : {}),
      // the leftover it is about, while it is open, to use up
      ...(s.leftover ? { leftovers: [s.leftover.id] } : {}),
      ...(f.sourceMode ? { sourceMode: f.sourceMode } : {}),
      ...(f.portionsCooked ? { portionsCooked: f.portionsCooked } : {}),
      ...(f.count ? { count: f.count } : {}),
    },
  };
}

/**
 * An agent starter's number, by its kind, from the app's data as it is now: the protein (or kcal)
 * open tonight, how often or how long ago the referenced meal was eaten, the month, when the
 * referenced request was made, how much of the referenced leftover is left. Null where there is
 * nothing to count (`other`, a reference that is gone).
 */
export function liveNumber(
  s: Pick<PlanningStarterView, "kind" | "meal" | "request" | "filters" | "leftover">,
  i: StarterInput,
): { number: string | null; unit: string; why: string } {
  switch (s.kind) {
    case "protein_gap": {
      const open = openStarter(i);
      return open
        ? { number: open.number, unit: open.unit, why: open.why }
        : { number: null, unit: "an idea for tonight", why: "" };
    }
    case "like_meal":
    case "variety": {
      const meal = s.meal;
      if (!meal) return { number: null, unit: s.kind === "variety" ? "for variety" : "a twist", why: "" };
      const times =
        s.kind === "like_meal"
          ? i.repeatable.find((m) => m.mealId === meal.id || (meal.title !== null && m.title === meal.title))
              ?.times
          : undefined;
      if (times !== undefined && times >= MIN_TIMES)
        return { number: `${times}×`, unit: "logged in 30 days", why: "" };
      const days = daysBetween(localDate(meal.eatenAt), i.today);
      return days <= 0
        ? { number: "Today", unit: "you had it", why: "" }
        : { number: String(days), unit: `${days === 1 ? "day" : "days"} since you had it`, why: "" };
    }
    case "season": {
      const month = Number(i.today.slice(5, 7)) - 1;
      return {
        number: MONTHS[month] ?? "",
        unit: (SEASON[month] ?? []).slice(0, 4).join(", "),
        why: "From the seasonal calendar",
      };
    }
    case "last_request": {
      if (!s.request) return { number: null, unit: "like last time", why: "" };
      const made = localDate(s.request.createdAt);
      return {
        number: made === i.today ? "Today" : formatWeekday(made),
        unit: "your request",
        why: s.request.title,
      };
    }
    case "use_up": {
      if (s.leftover) return { ...leftoverNumber(s.leftover), why: s.leftover.note ?? "" };
      const first = s.filters.useUp?.[0];
      return { number: null, unit: first ? `use up ${first}` : "to use up", why: "" };
    }
    case "other":
      return { number: null, unit: "an idea", why: "" };
  }
}

function openStarter({ today, days }: StarterInput): Starter | null {
  const todayPlan = days.find((d) => d.date === today);
  const tomorrow = addDays(today, 1);
  const tonight = !todayPlan || todayPlan.openSlots.includes("dinner");
  const day = tonight ? todayPlan : days.find((d) => d.date === tomorrow);
  if (!day?.goal) return null;
  const when = tonight ? "tonight" : "tomorrow";
  const draft: FilterDraft = { when: tonight ? "today" : "tomorrow", slots: ["dinner"] };
  const eaten = day.projected?.nutrients;
  const kcalTarget = day.goal.targets.energyKcal;
  const kcalLeft = kcalTarget === null ? null : Math.round(kcalTarget - (eaten?.energyKcal ?? 0));
  const meals = day.meals.length + day.plannedMeals.filter((p) => p.status === "planned").length;
  const after = meals ? ` after ${plural(meals, "meal")}` : "";
  const protein = day.goal.targets.protein;
  if (protein !== null) {
    const open = Math.round(protein - (eaten?.protein ?? 0));
    if (open >= MIN_PROTEIN_OPEN) {
      return {
        id: "protein",
        kind: "protein_gap",
        by: "code",
        number: formatNumber(open),
        unit: `g protein open ${when}`,
        text: `High protein ${when}`,
        why:
          kcalLeft !== null && kcalTarget !== null
            ? `${formatNumber(Math.max(0, kcalLeft))} kcal left of ${formatNumber(kcalTarget)}${after}`
            : `${formatNumber(eaten?.protein ?? 0)} of ${formatNumber(protein)} g so far${after}`,
        composerText: `High protein ${when}`,
        draft: { ...draft, constraints: ["high_protein"] },
      };
    }
  }
  if (kcalLeft === null || kcalTarget === null || kcalLeft <= 0) return null;
  return {
    id: "kcal",
    kind: "protein_gap",
    by: "code",
    number: formatNumber(kcalLeft),
    unit: `kcal open ${when}`,
    text: `Something for ${when}`,
    why: `${formatNumber(eaten?.energyKcal ?? 0)} of ${formatNumber(kcalTarget)} kcal${after}`,
    composerText: `Something for ${when}`,
    draft,
  };
}

/** The oldest leftover that is an ingredient (a pack, the user's own) as a starter to use it up. */
function leftoverStarter({ leftovers = [] }: StarterInput): Starter | null {
  const l = leftovers.find((x) => x.source !== "cooked" && x.status === "open");
  if (!l) return null;
  return {
    id: "leftover",
    kind: "use_up",
    by: "code",
    ...leftoverNumber(l),
    text: `Use up the ${l.description}`,
    why: l.note ?? "On your leftovers list",
    composerText: `Something with the ${l.description}`,
    draft: { leftovers: [l.id] },
  };
}

function againStarter({ repeatable, now }: StarterInput): Starter | null {
  const best = [...repeatable]
    .filter((m) => m.times >= MIN_TIMES)
    .sort((a, b) => b.times - a.times || b.eatenAt - a.eatenAt)[0];
  if (!best) return null;
  const n = best.totals.nutrients;
  const text = `Like ${best.title}, but different`;
  return {
    id: "again",
    kind: "like_meal",
    by: "code",
    number: `${best.times}×`,
    unit: "logged in 30 days",
    text,
    why: `${formatNumber(n.energyKcal)} kcal · ${formatNumber(n.protein)} g protein · last ${dayLabel(
      startOfDay(best.eatenAt),
      now,
    ).toLowerCase()}`,
    composerText: text,
    draft: {},
  };
}

function seasonStarter({ today }: StarterInput): Starter {
  const month = Number(today.slice(5, 7)) - 1;
  const produce = SEASON[month] ?? [];
  return {
    id: "season",
    kind: "season",
    by: "code",
    number: MONTHS[month] ?? "",
    unit: produce.slice(0, 4).join(", "),
    text: "Something in season",
    why: "From the seasonal calendar",
    composerText: `Something in season: ${produce.join(", ")}`,
    draft: {},
  };
}

/** Days apart, `a` to `b`. */
const daysBetween = (a: string, b: string) => Math.round((dateStart(b) - dateStart(a)) / 86_400_000);

function lastStarter({ last, today }: StarterInput): Starter | null {
  if (!last) return null;
  const { request } = last;
  const f = request.filters;
  const first = f.days[0];
  // the same days again, from today on (one day: today)
  const draft: FilterDraft = {
    ...(f.days.length <= 1 || !first
      ? { when: "today" as const }
      : { when: "days" as const, days: f.days.map((d) => addDays(today, daysBetween(first, d))) }),
    slots: f.slots,
    timeCapMin: f.timeCapMin,
    constraints: f.constraints,
    useUp: f.useUp.flatMap((u) => ("text" in u ? [u.text] : [])),
    leftovers: f.useUp.flatMap((u) => ("leftoverId" in u ? [u.leftoverId] : [])),
    sourceMode: f.sourceMode,
    portionsCooked: f.portionsCooked,
    count: f.count,
  };
  const madeDay = localDate(request.createdAt);
  const ago = daysBetween(madeDay, today);
  return {
    id: "last",
    kind: "last_request",
    by: "code",
    number: ago === 0 ? "Today" : formatWeekday(madeDay),
    unit: "your last request",
    text: `${request.title}, like last time`,
    why: `${last.picked} picked of ${plural(last.suggested, "suggestion")} · reuses its filters`,
    composerText: last.text ?? `Like last time: ${request.title}`,
    draft,
  };
}
