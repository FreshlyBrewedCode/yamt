export const directions = [
  {
    key: "a",
    name: "Ledger",
    blurb:
      "A kitchen journal on warm paper: serif headlines, hairline rules, tabular numbers, one moss accent.",
  },
  {
    key: "b",
    name: "Blockprint",
    blurb:
      "Bold poster: black outlines, acid lime, huge numbers, thick borders and hard shadows. Nothing subtle.",
  },
  {
    key: "c",
    name: "Pebble",
    blurb: "Soft and native-feeling: rounded cards, coral and sage, a kcal ring, a round Log meal button.",
  },
] as const;

export const screens = [
  { slug: "overview", label: "Meals overview", path: "/" },
  { slug: "log-idle", label: "Log meal (idle)", path: "/log" },
  { slug: "log-recording", label: "Log meal (recording)", path: "/log?state=recording" },
  { slug: "meal", label: "Meal detail", path: "/meal" },
  { slug: "goals", label: "Goals and weight", path: "/goals" },
] as const;
