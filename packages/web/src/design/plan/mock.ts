// Design spike: meal planning in the PWA, round 1. Mock data only: a made-up cut, made-up meals,
// a leftover pumpkin, two rounds of suggestions, a few planned days. Nothing here talks to the
// server. Nutrition is computed here from per-100 g values (the model reads, code computes).

export type Nutrients = Record<"energyKcal" | "protein" | "fat" | "carbohydrate" | "fiber", number>;

export const ZERO: Nutrients = { energyKcal: 0, protein: 0, fat: 0, carbohydrate: 0, fiber: 0 };

export const add = (a: Nutrients, b: Nutrients, f = 1): Nutrients => ({
  energyKcal: a.energyKcal + b.energyKcal * f,
  protein: a.protein + b.protein * f,
  fat: a.fat + b.fat * f,
  carbohydrate: a.carbohydrate + b.carbohydrate * f,
  fiber: a.fiber + b.fiber * f,
});
export const scale = (a: Nutrients, f: number): Nutrients => add(ZERO, a, f);

/** Today in the mock: Tuesday 4 Nov 2026, 16:10. */
export const NOW = new Date(2026, 10, 4, 16, 10).getTime();
export const TODAY = "2026-11-04";

export const GOAL = {
  label: "Cut, standard pace",
  since: "14 Oct",
  targets: { energyKcal: 2200, protein: 160, fat: 70, carbohydrate: 220, fiber: 30 } satisfies Nutrients,
};

/** Per 100 g, made up to be plausible (EU carbs: without fibre). */
export const FOODS = {
  hokkaido: { energyKcal: 60, protein: 1.5, fat: 0.5, carbohydrate: 11, fiber: 2 },
  kichererbsen: { energyKcal: 120, protein: 7, fat: 2.5, carbohydrate: 15, fiber: 6 },
  kokosmilchLight: { energyKcal: 75, protein: 0.7, fat: 7, carbohydrate: 2, fiber: 0 },
  zwiebel: { energyKcal: 30, protein: 1.2, fat: 0.2, carbohydrate: 5, fiber: 1.5 },
  spinat: { energyKcal: 20, protein: 2.7, fat: 0.4, carbohydrate: 0.6, fiber: 2.2 },
  currypaste: { energyKcal: 110, protein: 3, fat: 3, carbohydrate: 15, fiber: 3 },
  reis: { energyKcal: 350, protein: 7, fat: 1, carbohydrate: 78, fiber: 1.5 },
  feta: { energyKcal: 270, protein: 17, fat: 22, carbohydrate: 1, fiber: 0 },
  roteLinsen: { energyKcal: 330, protein: 25, fat: 1.5, carbohydrate: 50, fiber: 11 },
  linsenGekocht: { energyKcal: 115, protein: 9, fat: 0.5, carbohydrate: 17, fiber: 4 },
  ei: { energyKcal: 150, protein: 13, fat: 11, carbohydrate: 1, fiber: 0 },
  gnocchi: { energyKcal: 160, protein: 4, fat: 1, carbohydrate: 32, fiber: 2 },
  olivenoel: { energyKcal: 884, protein: 0, fat: 100, carbohydrate: 0, fiber: 0 },
  quinoa: { energyKcal: 360, protein: 14, fat: 6, carbohydrate: 58, fiber: 7 },
  haehnchenbrust: { energyKcal: 110, protein: 23, fat: 1.5, carbohydrate: 0, fiber: 0 },
  tomatenPassiert: { energyKcal: 30, protein: 1.5, fat: 0.3, carbohydrate: 5, fiber: 1.2 },
  joghurt: { energyKcal: 65, protein: 4, fat: 3.5, carbohydrate: 5, fiber: 0 },
  salbeiButter: { energyKcal: 740, protein: 0.7, fat: 82, carbohydrate: 0.6, fiber: 0 },
  paprika: { energyKcal: 30, protein: 1, fat: 0.3, carbohydrate: 5, fiber: 2 },
  knoblauch: { energyKcal: 140, protein: 6, fat: 0.5, carbohydrate: 28, fiber: 2 },
  vollkornbrot: { energyKcal: 220, protein: 8, fat: 1.5, carbohydrate: 38, fiber: 8 },
} satisfies Record<string, Nutrients>;

export type FoodKey = keyof typeof FOODS;

export interface Ingredient {
  food: FoodKey;
  /** Display name, German like meal items. */
  name: string;
  /** Grams for the whole recipe (all `portions`). */
  grams: number;
  /** Something the cook may leave out ("minus the feta"). */
  optional?: boolean;
}

export type SourceKind = "web" | "own" | "agent";

/** Round 3: how a recipe relates to its source (Settings → Planning's default, overridable per request). */
export type SourceMode = "real" | "adapted" | "free";

export interface Recipe {
  id: string;
  title: string;
  pitch: string;
  /** Why it fits: goal, leftovers, variety, time. Short lines. */
  why: string[];
  /** A caution the agent noted (never orange: nothing failed). */
  note?: string;
  activeMin: number;
  totalMin: number;
  oven: boolean;
  source: { kind: SourceKind; label: string; url?: string };
  /** Round 3: as published, adapted (with the changes listed) or composed by the agent. */
  mode?: SourceMode;
  /** For `adapted`: what the agent changed against the original. */
  changes?: string[];
  /** Round 3: the slot the agent proposes ("no oven: fits Wednesday"). */
  proposed?: { date: string; slot: Slot };
  portions: number;
  ingredients: Ingredient[];
  steps: string[];
  /** The 3–4 ingredients that tell the dish. */
  key: string[];
}

/** Per portion, computed from the ingredients: never typed in, never from the model. */
export function perPortion(r: Recipe, without: ReadonlySet<string> = new Set()): Nutrients {
  const total = r.ingredients
    .filter((i) => !without.has(i.name))
    .reduce((acc, i) => add(acc, FOODS[i.food], i.grams / 100), ZERO);
  return scale(total, 1 / r.portions);
}

export const ROUND_1: Recipe[] = [
  {
    id: "curry",
    title: "Kürbis-Kichererbsen-Curry",
    pitch: "Cremig und scharf, mit Reis. 35 Minuten.",
    why: [
      "Uses the half Hokkaido (250 g of it)",
      "30 g protein for the 82 g still open tonight",
      "Nothing like it in the last 10 days",
    ],
    activeMin: 20,
    totalMin: 35,
    oven: false,
    source: { kind: "web", label: "chefkoch.de", url: "https://www.chefkoch.de/" },
    mode: "adapted",
    changes: ["Sahne → Kokosmilch light", "−50 g Reis", "+ 200 g Spinat"],
    proposed: { date: "2026-11-04", slot: "dinner" },
    portions: 2,
    ingredients: [
      { food: "hokkaido", name: "Hokkaido", grams: 500 },
      { food: "kichererbsen", name: "Kichererbsen (Dose)", grams: 480 },
      { food: "kokosmilchLight", name: "Kokosmilch light", grams: 300 },
      { food: "zwiebel", name: "Zwiebel", grams: 160 },
      { food: "spinat", name: "Spinat", grams: 200 },
      { food: "currypaste", name: "Rote Currypaste", grams: 40 },
      { food: "reis", name: "Basmatireis (roh)", grams: 120 },
      { food: "olivenoel", name: "Olivenöl", grams: 10 },
    ],
    steps: [
      "Reis aufsetzen. Hokkaido waschen, entkernen, in 2 cm Würfel schneiden (Schale bleibt dran).",
      "Zwiebel in Öl glasig dünsten, Currypaste 1 Minute mitrösten.",
      "Kürbis zugeben, mit Kokosmilch und 200 ml Wasser auffüllen, 15 Minuten köcheln.",
      "Kichererbsen abgießen, zugeben, 5 Minuten weiter. Spinat unterrühren, bis er zusammenfällt.",
      "Mit Salz und Limette abschmecken, mit Reis servieren.",
    ],
    key: ["Hokkaido", "Kichererbsen", "Kokosmilch", "Spinat"],
  },
  {
    id: "suppe",
    title: "Kürbis-Linsen-Suppe mit Feta",
    pitch: "Rote Linsen, Kreuzkümmel, Feta obendrauf. 30 Minuten.",
    why: [
      "Uses the pumpkin and the 200 g feta",
      "14 g fibre: almost all of today's 15 g rest",
      "Soup last seen 12 days ago",
    ],
    activeMin: 15,
    totalMin: 30,
    oven: false,
    source: { kind: "agent", label: "Composed for you" },
    mode: "free",
    proposed: { date: "2026-11-05", slot: "dinner" },
    portions: 2,
    ingredients: [
      { food: "hokkaido", name: "Hokkaido", grams: 400 },
      { food: "roteLinsen", name: "Rote Linsen", grams: 160 },
      { food: "zwiebel", name: "Zwiebel", grams: 100 },
      { food: "knoblauch", name: "Knoblauch", grams: 10 },
      { food: "feta", name: "Feta", grams: 100, optional: true },
      { food: "joghurt", name: "Joghurt 3,5 %", grams: 100, optional: true },
      { food: "olivenoel", name: "Olivenöl", grams: 10 },
    ],
    steps: [
      "Zwiebel und Knoblauch in Öl anschwitzen, Kreuzkümmel und Paprikapulver kurz mitrösten.",
      "Kürbiswürfel und Linsen zugeben, mit 900 ml Brühe auffüllen, 20 Minuten köcheln.",
      "Grob pürieren, mit Zitrone und Salz abschmecken.",
      "Mit zerbröseltem Feta und einem Löffel Joghurt servieren.",
    ],
    key: ["Hokkaido", "Rote Linsen", "Feta", "Kreuzkümmel"],
  },
  {
    id: "ofen",
    title: "Ofenkürbis mit Hähnchen und Quinoa",
    pitch: "Blech, 45 Minuten, davon 15 am Herd.",
    why: ["57 g protein: the most of this round", "Uses the Hokkaido"],
    note: "Chicken 3× this week already. Needs the oven: not for Wednesday.",
    activeMin: 15,
    totalMin: 45,
    oven: true,
    source: { kind: "own", label: "Your recipe · Ofenkürbis" },
    mode: "real",
    proposed: { date: "2026-11-06", slot: "dinner" },
    portions: 2,
    ingredients: [
      { food: "hokkaido", name: "Hokkaido", grams: 500 },
      { food: "haehnchenbrust", name: "Hähnchenbrust", grams: 360 },
      { food: "quinoa", name: "Quinoa (roh)", grams: 120 },
      { food: "paprika", name: "Paprika", grams: 200 },
      { food: "olivenoel", name: "Olivenöl", grams: 20 },
      { food: "joghurt", name: "Joghurt 3,5 %", grams: 100, optional: true },
    ],
    steps: [
      "Ofen auf 220 °C. Kürbis und Paprika in Spalten, mit Öl, Salz, Paprikapulver aufs Blech.",
      "25 Minuten rösten. Quinoa nach Packung kochen.",
      "Hähnchen würzen, nach 10 Minuten mit aufs Blech legen.",
      "Mit Quinoa und Joghurt anrichten.",
    ],
    key: ["Hokkaido", "Hähnchenbrust", "Quinoa", "Paprika"],
  },
  {
    id: "gnocchi",
    title: "Kürbis-Gnocchi-Pfanne mit Salbei",
    pitch: "Eine Pfanne, 20 Minuten.",
    why: ["Fastest of the round", "Uses the Hokkaido"],
    note: "Only 19 g protein: leaves most of tonight's protein open.",
    activeMin: 20,
    totalMin: 20,
    oven: false,
    source: { kind: "web", label: "eat-this.org", url: "https://www.eat-this.org/" },
    mode: "real",
    proposed: { date: "2026-11-06", slot: "dinner" },
    portions: 2,
    ingredients: [
      { food: "hokkaido", name: "Hokkaido", grams: 400 },
      { food: "gnocchi", name: "Gnocchi (Kühlregal)", grams: 500 },
      { food: "salbeiButter", name: "Butter mit Salbei", grams: 30 },
      { food: "zwiebel", name: "Zwiebel", grams: 100 },
      { food: "feta", name: "Feta", grams: 60, optional: true },
    ],
    steps: [
      "Kürbis in kleine Würfel, in der Pfanne 10 Minuten anbraten.",
      "Gnocchi und Zwiebel zugeben, 8 Minuten rösten.",
      "Salbeibutter unterschwenken, Feta drüberbröseln.",
    ],
    key: ["Hokkaido", "Gnocchi", "Salbei"],
  },
];

export const ROUND_2: Recipe[] = [
  {
    id: "pfanne",
    title: "Kürbis-Feta-Pfanne mit Kichererbsen",
    pitch: "Wie die Suppe, nur aus der Pfanne. 20 Minuten.",
    why: ["No meat", "Uses pumpkin and feta", "33 g protein, 20 minutes"],
    activeMin: 20,
    totalMin: 20,
    oven: false,
    source: { kind: "agent", label: "Composed for you" },
    mode: "free",
    proposed: { date: "2026-11-05", slot: "dinner" },
    portions: 2,
    ingredients: [
      { food: "hokkaido", name: "Hokkaido", grams: 400 },
      { food: "kichererbsen", name: "Kichererbsen (Dose)", grams: 480 },
      { food: "feta", name: "Feta", grams: 120, optional: true },
      { food: "spinat", name: "Spinat", grams: 150 },
      { food: "zwiebel", name: "Zwiebel", grams: 100 },
      { food: "olivenoel", name: "Olivenöl", grams: 15 },
    ],
    steps: [
      "Kürbiswürfel in Öl 10 Minuten anbraten, Zwiebel zugeben.",
      "Kichererbsen abgießen, mitrösten, bis sie knusprig werden.",
      "Spinat unterheben, Feta drüberbröseln, mit Zitrone abschmecken.",
    ],
    key: ["Hokkaido", "Kichererbsen", "Feta", "Spinat"],
  },
  {
    id: "express",
    title: "Schnelle Kürbis-Linsen-Suppe",
    pitch: "Die Suppe von eben mit gekochten Linsen. 20 Minuten.",
    why: ["Closest to the one you liked, 10 minutes faster", "No meat", "13 g fibre, 28 g protein"],
    activeMin: 10,
    totalMin: 20,
    oven: false,
    source: { kind: "agent", label: "Composed for you" },
    mode: "free",
    proposed: { date: "2026-11-06", slot: "dinner" },
    portions: 2,
    ingredients: [
      { food: "hokkaido", name: "Hokkaido", grams: 400 },
      { food: "linsenGekocht", name: "Linsen (gekocht, Glas)", grams: 400 },
      { food: "zwiebel", name: "Zwiebel", grams: 100 },
      { food: "feta", name: "Feta", grams: 80, optional: true },
      { food: "olivenoel", name: "Olivenöl", grams: 10 },
    ],
    steps: [
      "Zwiebel anschwitzen, Kürbis in kleinen Würfeln 10 Minuten mitdünsten.",
      "Linsen mit Flüssigkeit und 400 ml Wasser zugeben, 8 Minuten köcheln, grob pürieren.",
      "Mit Feta servieren.",
    ],
    key: ["Hokkaido", "Linsen", "Feta"],
  },
  {
    id: "shakshuka",
    title: "Kürbis-Shakshuka mit Feta",
    pitch: "Eier in Tomaten-Kürbis-Sugo, Brot dazu. 25 Minuten.",
    why: ["No meat, 36 g protein from eggs and feta", "One pan, no oven: fits Wednesday"],
    activeMin: 15,
    totalMin: 25,
    oven: false,
    source: { kind: "web", label: "chefkoch.de", url: "https://www.chefkoch.de/" },
    mode: "real",
    proposed: { date: "2026-11-05", slot: "dinner" },
    portions: 2,
    ingredients: [
      { food: "hokkaido", name: "Hokkaido", grams: 300 },
      { food: "tomatenPassiert", name: "Passierte Tomaten", grams: 400 },
      { food: "ei", name: "Eier (4)", grams: 240 },
      { food: "feta", name: "Feta", grams: 100, optional: true },
      { food: "paprika", name: "Paprika", grams: 200 },
      { food: "zwiebel", name: "Zwiebel", grams: 100 },
      { food: "olivenoel", name: "Olivenöl", grams: 15 },
      { food: "vollkornbrot", name: "Vollkornbrot", grams: 120, optional: true },
    ],
    steps: [
      "Zwiebel und Paprika anbraten, Kürbis in kleinen Würfeln 8 Minuten mitdünsten.",
      "Tomaten zugeben, würzen, 5 Minuten köcheln.",
      "Vier Mulden formen, Eier hineingeben, Deckel drauf, 6 Minuten stocken lassen.",
      "Feta drüber, mit Brot servieren.",
    ],
    key: ["Hokkaido", "Eier", "Tomaten", "Feta"],
  },
];

export const RECIPES = new Map([...ROUND_1, ...ROUND_2].map((r) => [r.id, r]));

export type CaptureKind = "note" | "photo" | "link" | "audio";

export interface MockCapture {
  kind: CaptureKind;
  title: string;
  detail: string;
}

export interface Round {
  n: number;
  at: string;
  inputs: MockCapture[];
  suggestions: Recipe[];
}

export const ROUNDS: Round[] = [
  {
    n: 1,
    at: "Today, 15:41",
    inputs: [
      {
        kind: "note",
        title:
          "Something with pumpkin, I still have half a Hokkaido. Dinners for Tue–Thu, Wednesday without the oven.",
        detail: "Note",
      },
      { kind: "photo", title: "Fridge", detail: "Photo · feta, spinach, eggs seen" },
      { kind: "link", title: "chefkoch.de/rezepte/kuerbis-curry", detail: "Link" },
    ],
    suggestions: ROUND_1,
  },
  {
    n: 2,
    at: "Today, 16:02",
    inputs: [
      {
        kind: "audio",
        title: "Less meat. More like the second one, but faster.",
        detail: "Voice memo · 0:06",
      },
    ],
    suggestions: ROUND_2,
  },
];

/** Where preferences come from (one line, out of scope otherwise). */
export const PREFS_LINE = "Dislikes, cooking time and equipment come from Settings → Preferences.";

export type Slot = "breakfast" | "lunch" | "dinner";
export const SLOT_NAME: Record<Slot, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
export const SLOTS: Slot[] = ["breakfast", "lunch", "dinner"];

export interface PlannedMeal {
  recipeId: string;
  date: string;
  slot: Slot;
  /** Portion factor of one recipe portion. */
  factor: number;
  /** Round 3: portions cooked ("cook 2, eat 1"); the rest become leftovers. Default: the recipe's. */
  cooked?: number;
}

export const PLANNED: PlannedMeal[] = [
  { recipeId: "curry", date: "2026-11-04", slot: "dinner", factor: 1 },
  { recipeId: "shakshuka", date: "2026-11-05", slot: "dinner", factor: 1 },
  { recipeId: "suppe", date: "2026-11-06", slot: "dinner", factor: 1.5 },
];

export interface EatenMeal {
  time: string;
  title: string;
  captures: string;
  nutrients: Nutrients;
}

/** Today so far: breakfast and lunch logged, dinner planned. */
export const EATEN_TODAY: EatenMeal[] = [
  {
    time: "12:40",
    title: "Hähnchen-Reis-Bowl mit Brokkoli",
    captures: "1 voice memo · 1 photo",
    nutrients: { energyKcal: 680, protein: 52, fat: 18, carbohydrate: 74, fiber: 7 },
  },
  {
    time: "07:55",
    title: "Haferbrei mit Beeren und Skyr",
    captures: "Logged again",
    nutrients: { energyKcal: 420, protein: 26, fat: 9, carbohydrate: 58, fiber: 8 },
  },
];

export const EATEN_TOTAL: Nutrients = EATEN_TODAY.reduce((a, m) => add(a, m.nutrients), ZERO);
export const LEFT_TODAY: Nutrients = add(GOAL.targets, EATEN_TOTAL, -1);

/** The last days, for variety (what the agent saw). */
export const RECENT = [
  { title: "Hähnchen-Reis-Bowl mit Brokkoli", times: 3 },
  { title: "Haferbrei mit Beeren und Skyr", times: 6 },
  { title: "Linsen-Dal mit Naan", times: 1 },
  { title: "Rührei mit Vollkornbrot", times: 2 },
  { title: "Thunfisch-Salat", times: 1 },
];

export const LEFTOVERS = ["½ Hokkaido (≈ 500 g)", "200 g Feta", "Koriander"];

export interface PlanDay {
  date: string;
  label: string;
  short: string;
  weekday: string;
  /** Eaten so far (today only). */
  eaten: Nutrients | null;
  eatenMeals: number;
}

export const DAYS: PlanDay[] = [
  { date: "2026-11-04", label: "Today", short: "4 Nov", weekday: "Tue", eaten: EATEN_TOTAL, eatenMeals: 2 },
  { date: "2026-11-05", label: "Tomorrow", short: "5 Nov", weekday: "Wed", eaten: null, eatenMeals: 0 },
  { date: "2026-11-06", label: "Thursday", short: "6 Nov", weekday: "Thu", eaten: null, eatenMeals: 0 },
  { date: "2026-11-07", label: "Friday", short: "7 Nov", weekday: "Fri", eaten: null, eatenMeals: 0 },
];

export function plannedOn(date: string, planned: readonly PlannedMeal[] = PLANNED) {
  return planned
    .filter((p) => p.date === date)
    .map((p) => ({
      ...p,
      recipe: RECIPES.get(p.recipeId)!,
      nutrients: scale(perPortion(RECIPES.get(p.recipeId)!), p.factor),
    }));
}

/** A day's projection: eaten plus planned. */
export function projection(day: PlanDay, planned: readonly PlannedMeal[] = PLANNED) {
  const list = plannedOn(day.date, planned);
  const plannedTotal = list.reduce((a, p) => add(a, p.nutrients), ZERO);
  const total = add(day.eaten ?? ZERO, plannedTotal);
  return { list, plannedTotal, total, left: add(GOAL.targets, total, -1) };
}

/** The calendar's words, cut range: on plan −15 … +5 %, just off within 25 %, far off beyond. */
export function planWords(
  kcal: number,
  target = GOAL.targets.energyKcal,
): { band: "on" | "just" | "far"; words: string } {
  const dev = kcal / target - 1;
  const band = dev >= -0.15 && dev <= 0.05 ? "on" : Math.abs(dev) <= 0.25 ? "just" : "far";
  const dir = dev > 0.05 ? ", over" : dev < -0.05 ? ", under" : "";
  return { band, words: `${band === "on" ? "On plan" : band === "just" ? "Just off" : "Far off"}${dir}` };
}

export const fmt = (n: number): string => Math.round(n).toLocaleString("en");
export const fmtG = (n: number): string => `${Math.round(n)}`;
