// Leftovers on the phone (#49): how a leftover reads on the plan view (where it comes from, where
// it is offered or planned) and in the Ate-it sheet. Pure, so it is tested without a screen.
import { addDays, type LeftoverOffer, type LeftoverView, type MealSlot, type PlanDay } from "@yamt/shared";
import { formatNumber, formatWeekday } from "./format";
import { SLOT_NAME } from "./planning";

/** "lunch today", "dinner tomorrow", "lunch Wed": a slot of a day in the middle of a sentence. */
const slotOn = (date: string, slot: MealSlot, today: string): string =>
  `${SLOT_NAME[slot].toLowerCase()} ${
    date === today ? "today" : date === addDays(today, 1) ? "tomorrow" : formatWeekday(date)
  }`;

/** Where the plan offers each leftover, from its days: leftover id → the day and slot. */
export function offersOf(days: readonly PlanDay[]): Map<string, { date: string } & LeftoverOffer> {
  return new Map(
    days.flatMap((d) => d.leftoverOffers.map((o) => [o.leftoverId, { ...o, date: d.date }] as const)),
  );
}

/**
 * A leftover's line under its name: a cooked one says when it was cooked and where it is planned
 * or offered ("After Tue · offered for lunch Wed"), a pack or the user's own its note, else who added
 * it and when.
 */
export function leftoverLine(
  l: LeftoverView,
  offer: { date: string; slot: MealSlot } | undefined,
  today: string,
): string {
  if (l.source === "cooked") {
    const cooked = l.cookedOn
      ? `After ${l.cookedOn === today ? "today" : formatWeekday(l.cookedOn)}`
      : "Cooked";
    const planned = l.plannedFor[0];
    if (planned) return `${cooked} · planned for ${slotOn(planned.date, planned.slot, today)}`;
    if (offer) return `${cooked} · offered for ${slotOn(offer.date, offer.slot, today)}`;
    return cooked;
  }
  if (l.note) return l.note;
  return l.source === "pack" ? "Noted with a suggestion" : "Added by you";
}

/**
 * The Ate-it sheet's leftover sentence: "1 portion (871 kcal) kept as a leftover: the plan offers
 * it from Wed." (the plan offers a cooked leftover from the day after the planned meal's day).
 */
export function keptWords(left: number, perPortionKcal: number, date: string, today: string): string {
  const portions = String(Math.round(left * 100) / 100);
  const next = addDays(date, 1);
  const from = next < today ? today : next;
  const when = from === today ? "today" : from === addDays(today, 1) ? "tomorrow" : formatWeekday(from);
  return `${portions} ${left === 1 ? "portion" : "portions"} (${formatNumber(perPortionKcal * left)} kcal) kept as a leftover: the plan offers it from ${when}.`;
}

/**
 * A leftover's number for a starter: a cooked one's portions, else its grams, else its quantity;
 * with what it is ("g Hokkaido at home").
 */
export function leftoverNumber(l: LeftoverView): { number: string | null; unit: string } {
  if (l.source === "cooked" && l.portions !== null) {
    return {
      number: String(Math.round(l.portions * 100) / 100),
      unit: `${l.portions === 1 ? "portion" : "portions"} of ${l.description} left`,
    };
  }
  if (l.grams !== null) return { number: formatNumber(l.grams), unit: `g ${l.description} at home` };
  if (l.quantity) return { number: l.quantity, unit: `${l.description} at home` };
  return { number: null, unit: `use up ${l.description}` };
}
