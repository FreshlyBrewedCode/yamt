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

/* ------------------------------------------------------------------ round 2 */

export type Screen2 =
  | "overview"
  | "empty"
  | "typing"
  | "attached"
  | "suggesting"
  | "suggestions"
  | "steer"
  | "round2"
  | "plan";

export const SCREENS2: { key: Screen2; label: string }[] = [
  { key: "overview", label: "Overview: Log | Plan, a request waiting, one suggesting" },
  { key: "empty", label: "Composer, empty: starters and filters" },
  { key: "typing", label: "Typing, keyboard up" },
  { key: "attached", label: "A voice chip, a photo, a link, filters chosen" },
  { key: "suggesting", label: "Sent: round 1 suggesting…" },
  { key: "suggestions", label: "Round 1 in the mix, steering below" },
  { key: "steer", label: "Steering, keyboard up" },
  { key: "round2", label: "Both rounds, Tue and Wed filled" },
  { key: "plan", label: "Plan view (C's)" },
];

export const VARIANTS2 = [
  {
    key: "d",
    name: "Dock",
    blurb:
      "Chat-like: the composer is the sticky bottom slab (plus, field, mic, a lime send square once there is something to send), and it is the same dock on every planning screen. Above it the screen stacks what's open tonight (ink), the starters as rows and the filters as a tint band right over the dock, where the thumb is; chosen filters become chips in the dock and travel with the request. In a thread the dock becomes the steer: quick steer chips over the field.",
  },
  {
    key: "e",
    name: "Form",
    blurb:
      "A form: the field at the top under “What do you fancy?”, Attach and Speak as two tint halves under it, then the request as the agent will read it (ink: the filters as one sentence), the structured filters as a tint band, and the starters at the end. Suggest is the lime bottom slab and stays above the keyboard, its hint repeating the request. In a thread the same form sits at the end as Steer, and the slab reads Suggest again.",
  },
  {
    key: "f",
    name: "Starters",
    blurb:
      "Bold: the starters are the screen. Each is a full-width band carrying its number (82 g protein open tonight as the ink slab, ½ Hokkaido to use up, 3 weeks without fish, 760 kcal Linsen-Dal, November, the last request). A tap fills the compact composer in the bottom slab and the scope row (Tonight · dinner · any time), which opens the filters; Suggest is lime under it. Steering gets the same slab with steer chips instead of starters.",
  },
] as const;

export type Variant2Key = (typeof VARIANTS2)[number]["key"];
