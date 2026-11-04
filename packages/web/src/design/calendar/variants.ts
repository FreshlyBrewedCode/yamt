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
  {
    key: "d",
    name: "Plan",
    blurb:
      "Round 2: C's heat month on ink, continued by the selected day's totals (A's slab) on the same ink. Squares say how a day sat against its goal's on-plan range (cut −15 … +5 %, maintain ±10 %, bulk −5 … +15 %): full lime on plan, fading in two steps (just off within 25 %, far off beyond), a cap on top for over and below for under, a hollow cap for too low; the 8th column is the week's average. The month summary with the weight line on tint, the legend in plain words on the page.",
  },
  {
    key: "e",
    name: "Plan, day first",
    blurb:
      "The same encoding, with the ink on the selected day's totals (as on the overview) and the month above it on tint: the lime squares on the quiet band instead of on ink.",
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
