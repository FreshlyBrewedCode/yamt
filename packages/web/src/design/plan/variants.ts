// The three variants and the screens each is shown in (the index page and the contact sheet).
export type Screen = "overview" | "request" | "suggesting" | "suggestions" | "recipe" | "plan" | "ate";

export const SCREENS: { key: Screen; label: string }[] = [
  { key: "overview", label: "Overview with today's planned dinner" },
  { key: "request", label: "The request, with input" },
  { key: "suggesting", label: "Round 2 suggesting… (round 1 done)" },
  { key: "suggestions", label: "Both rounds: pick / reject / steer" },
  { key: "recipe", label: "Recipe detail (planned today)" },
  { key: "plan", label: "Plan view, 4 days" },
  { key: "ate", label: "Ate it sheet" },
];

export const VARIANTS = [
  {
    key: "a",
    name: "Request",
    blurb:
      "A planning request is a meal-shaped thing of its own: Plan meals sits next to Log meal in the overview's bottom slab, the request screen is the capture view (recorder, add strip, captures, lime Suggest). Rounds stack like revisions: your input on tint, then suggestions as plain rows with macro chips and why-it-fits lines; Pick fills a square, Reject folds the row. Steering is Add more at the bottom, which turns the slab into Suggest again. The plan is a list of days reached from the request's header.",
  },
  {
    key: "b",
    name: "Board",
    blurb:
      "Plan first: a week board (the ink slab: four days as bars of planned kcal against the target) with slots under the selected day. Every empty slot is the entry point: Suggest for Wed dinner opens a request scoped to that day and slot. Suggestions are full-width bands, each with the day's bar and what it would do to it (→ 1,740 of 2,200 · 460 left). Newest round open, earlier rounds folded with their steer text; steering is an input row that reopens the request.",
  },
  {
    key: "c",
    name: "Deck",
    blurb:
      "One suggestion at a time, full screen: the title is the page title, its numbers are the ink slab against what's open tonight, why-it-fits on tint, key ingredients and the source below; the bottom slab is Skip | Pick. After the last card the round sums up and the steer band asks what to change. Planning starts from a quiet Tonight row under today's meals; the plan view is four day squares in the calendar's fades over the planned rows.",
  },
] as const;

export type VariantKey = (typeof VARIANTS)[number]["key"];
