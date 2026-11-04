// The three variants and the screens each is shown in (the index page and the contact sheet).
import type { CalendarSearch } from "./search";

export const VARIANTS = [
  {
    key: "a",
    name: "Fill",
    blurb:
      "A month grid: each day's tile fills with lime up to its kcal share of the target, the excess in the foreground above a gap. The selected day is the ink tile and its numbers the ink slab under the grid; months step in the bottom slab. Reached from a calendar square in the overview's header.",
  },
  {
    key: "b",
    name: "Bars",
    blurb:
      "The selected day's totals slab on top, the month under it as tiles with five small bars (kcal, protein, fat, carbs, fibre), the month's numbers as plain rows, Open day as the bottom slab. Takes the place of the overview's 'Earlier days' row.",
  },
  {
    key: "c",
    name: "Heat",
    blurb:
      "The month is the ink slab: squares in three lime strengths for how close the day came to its kcal target, a paper cap for over. The selected day as a plain row, the month's numbers and the weight's 7-day average on tint. Reached by tapping a day header in the overview.",
  },
] as const;

export const SCREENS: { slug: string; label: string; search: CalendarSearch }[] = [
  { slug: "now", label: "November · today", search: {} },
  { slug: "october", label: "October · 31 Oct selected", search: { month: "2026-10", day: "2026-10-31" } },
  {
    slug: "september",
    label: "September · 4 Sept selected (no goal yet)",
    search: { month: "2026-09", day: "2026-09-04" },
  },
];
