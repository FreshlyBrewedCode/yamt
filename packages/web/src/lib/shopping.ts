// The shopping list on the phone (#49): its lines by aisle with their counts, what is at home in
// words, and the days the range sheet offers. Pure, so it is tested without a screen; the lines
// and their grams are the server's.
import { AISLES, type Aisle, addDays, type ShoppingLine } from "@yamt/shared";
import { formatGrams } from "./format";

export interface AisleGroup {
  aisle: Aisle;
  lines: ShoppingLine[];
  /** Lines to buy (not covered by leftovers), and of those the ones in the basket. */
  toBuy: number;
  checked: number;
}

/** The lines by aisle, in the aisles' order (the server's order within each), with counts. */
export function byAisle(lines: readonly ShoppingLine[]): AisleGroup[] {
  return AISLES.flatMap((aisle) => {
    const of = lines.filter((l) => l.aisle === aisle);
    if (of.length === 0) return [];
    const buy = of.filter((l) => !l.covered);
    return [{ aisle, lines: of, toBuy: buy.length, checked: buy.filter((l) => l.checked).length }];
  });
}

/** "½ Hokkaido at home", "200 g Feta at home", "Feta at home"; "" when nothing is. */
export function atHomeWords(l: Pick<ShoppingLine, "atHome">): string {
  if (l.atHome.length === 0) return "";
  return `${l.atHome
    .map((h) =>
      [h.quantity ?? (h.grams !== null ? `${formatGrams(h.grams)} g` : null), h.description]
        .filter(Boolean)
        .join(" "),
    )
    .join(", ")} at home`;
}

/** The range sheet's days: today to the last planned day, a week at least, and the range shown. */
export function rangeDays(today: string, lastPlanned: string | null, from: string, to: string): string[] {
  const first = from < today ? from : today;
  let last = addDays(today, 6);
  for (const d of [lastPlanned, to]) if (d && d > last) last = d;
  const days: string[] = [];
  for (let d = first; d <= last && days.length < 31; d = addDays(d, 1)) days.push(d);
  return days;
}
