// The entry screen's starters (#47, G's starter bands): ideas with a live number, computed by code
// from what the app already has (the plan of today and tomorrow, the meals logged most, the month,
// the last request). A tap fills the composer and the filters; the agent-written starters of the
// nightly run (#48) and leftovers (#49) come later. Pure, so it is tested without a screen.
import { addDays, type PlanDay, type PlanningRequest, type RepeatableMeal } from "@yamt/shared";
import { dateStart, dayLabel, formatNumber, formatWeekday, localDate, plural, startOfDay } from "./format";
import type { FilterDraft } from "./plan-request";

export interface Starter {
  id: "protein" | "kcal" | "again" | "season" | "last";
  /** The number it carries ("82", "4×", "Nov", "Sat") and what it is. */
  number: string;
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
}

/**
 * The starters, in the order the screen shows them (the first is the screen's ink slab): what is
 * open tonight (protein, else kcal; tomorrow once tonight's dinner is eaten or planned), the meal
 * logged most ("like …, but different"), the season, the last request. Each only when its data is
 * there: nothing is invented.
 */
export function computeStarters(i: StarterInput): Starter[] {
  return [openStarter(i), againStarter(i), seasonStarter(i), lastStarter(i)].filter(
    (s): s is Starter => s !== null,
  );
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
    number: formatNumber(kcalLeft),
    unit: `kcal open ${when}`,
    text: `Something for ${when}`,
    why: `${formatNumber(eaten?.energyKcal ?? 0)} of ${formatNumber(kcalTarget)} kcal${after}`,
    composerText: `Something for ${when}`,
    draft,
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
    sourceMode: f.sourceMode,
    portionsCooked: f.portionsCooked,
    count: f.count,
  };
  const madeDay = localDate(request.createdAt);
  const ago = daysBetween(madeDay, today);
  return {
    id: "last",
    number: ago === 0 ? "Today" : formatWeekday(madeDay),
    unit: "your last request",
    text: `${request.title}, like last time`,
    why: `${last.picked} picked of ${plural(last.suggested, "suggestion")} · reuses its filters`,
    composerText: last.text ?? `Like last time: ${request.title}`,
    draft,
  };
}
