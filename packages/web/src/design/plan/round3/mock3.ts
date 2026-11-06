// Round 3 (G): what the consolidated direction adds to the mock. Rounds of three, an outline that
// completes one suggestion at a time, a round that partly failed, the nightly suggestions for
// today, leftovers as cooked portions, the shopping list and the planning settings. Mock only.
import {
  DAYS,
  type FoodKey,
  type PlannedMeal,
  RECIPES,
  type Recipe,
  ROUND_1,
  ROUND_2,
  SLOT_NAME,
  type Slot,
  type SourceMode,
} from "../mock";

/* ------------------------------------------------------------- source modes */

export const MODE_LABEL: Record<SourceMode, string> = {
  real: "Real recipes only",
  adapted: "Based on a real recipe",
  free: "Free",
};
export const MODE_DETAIL: Record<SourceMode, string> = {
  real: "As published: ingredients and amounts untouched.",
  adapted: "A real recipe, adapted to the goal and the leftovers; every change listed.",
  free: "The agent may compose its own dish from what you have.",
};
export const MODE_SHORT: Record<SourceMode, string> = {
  real: "Real only",
  adapted: "Adapted",
  free: "Free",
};

/** "From chefkoch.de", "Adapted from chefkoch.de · 2 changes", "Composed for you", "Your recipe · …". */
export function sourceLabel(r: Recipe): string {
  if (r.source.kind === "own") return r.source.label;
  if (r.source.kind === "agent" || r.mode === "free") return "Composed for you";
  if (r.mode === "adapted") {
    const n = r.changes?.length ?? 0;
    return `Adapted from ${r.source.label} · ${n} ${n === 1 ? "change" : "changes"}`;
  }
  return `From ${r.source.label}`;
}

/* ------------------------------------------------------------- the rounds */

/** G's rounds have three suggestions (Settings → Planning: suggestions per round). */
export const G_ROUND_1: Recipe[] = [ROUND_1[0]!, ROUND_1[1]!, ROUND_1[2]!];
export const G_ROUND_2: Recipe[] = [ROUND_2[2]!, ROUND_2[0]!, ROUND_2[1]!];

/** An idea of the round's outline: what the agent saves first, before it completes each one. */
export interface Outline {
  id: string;
  title: string;
  approach: string;
  source: string;
  proposed: { date: string; slot: Slot };
  state: "checking" | "queued" | "failed";
  /** For `failed`: why, in the agent's words. */
  reason?: string;
}

/** Round 1 in progress: the curry is complete, the soup is being checked, the oven dish waits. */
export const OUTLINE_IN_PROGRESS: Outline[] = [
  {
    id: "suppe",
    title: "Kürbis-Linsen-Suppe mit Feta",
    approach: "Rote Linsen, Kreuzkümmel, Feta obendrauf",
    source: "Composing",
    proposed: { date: "2026-11-05", slot: "dinner" },
    state: "checking",
  },
  {
    id: "ofen",
    title: "Ofenkürbis mit Hähnchen und Quinoa",
    approach: "Ein Blech, Quinoa dazu",
    source: "Your recipe · Ofenkürbis",
    proposed: { date: "2026-11-06", slot: "dinner" },
    state: "queued",
  },
];

/** The partly failed round: two complete, the third idea couldn't be matched. */
export const OUTLINE_FAILED: Outline = {
  id: "gruenkohl",
  title: "Grünkohl-Pfanne mit Hackfleisch",
  approach: "Grünkohl, Rinderhack, Kartoffeln",
  source: "Adapting chefkoch.de",
  proposed: { date: "2026-11-06", slot: "dinner" },
  state: "failed",
  reason: "No match for “Grünkohl, frisch” in the food data; the portion can't be computed.",
};

/* ---------------------------------------------------------- the nightly run */

/** Tonight's third suggestion, composed for one portion from what the fridge photo showed. */
export const OMELETT: Recipe = {
  id: "omelett",
  title: "Spinat-Feta-Omelett mit Vollkornbrot",
  pitch: "Drei Eier, Spinat, Feta, zwei Scheiben Brot. 15 Minuten.",
  why: [
    "46 g protein for the 82 g still open tonight",
    "Uses the feta and the spinach from the fridge photo",
  ],
  activeMin: 15,
  totalMin: 15,
  oven: false,
  source: { kind: "agent", label: "Composed for you" },
  mode: "free",
  proposed: { date: "2026-11-04", slot: "dinner" },
  portions: 1,
  ingredients: [
    { food: "ei", name: "Eier (3)", grams: 180 },
    { food: "spinat", name: "Spinat", grams: 120 },
    { food: "feta", name: "Feta", grams: 60 },
    { food: "vollkornbrot", name: "Vollkornbrot", grams: 90 },
    { food: "olivenoel", name: "Olivenöl", grams: 8 },
  ],
  steps: [
    "Spinat in der Pfanne zusammenfallen lassen, herausnehmen.",
    "Eier verquirlen, salzen, in die Pfanne, Spinat und Feta darauf verteilen.",
    "Bei kleiner Hitze stocken lassen, zusammenklappen, mit Brot servieren.",
  ],
  key: ["Eier", "Spinat", "Feta"],
};

export const NIGHTLY: Recipe[] = [ROUND_1[0]!, OMELETT, ROUND_1[3]!];
export const NIGHTLY_AT = "03:00";
export const NIGHTLY_REGEN_AT = "16:11";

export const ALL_RECIPES = new Map([...RECIPES, [OMELETT.id, OMELETT]]);

/* ---------------------------------------------------------- the plan (G) */

/** The plan after the thread: the curry cooked for 2, one eaten Tue; the shakshuka Wed; the soup Thu for 2. */
export const PLANNED_G: PlannedMeal[] = [
  { recipeId: "curry", date: "2026-11-04", slot: "dinner", factor: 1, cooked: 2 },
  { recipeId: "shakshuka", date: "2026-11-05", slot: "dinner", factor: 1, cooked: 2 },
  { recipeId: "suppe", date: "2026-11-06", slot: "dinner", factor: 1, cooked: 2 },
];

/** A cooked portion that wasn't eaten: offered on the next day. */
export interface LeftoverPortion {
  recipeId: string;
  portions: number;
  /** When it was (or will be) cooked. */
  cookedOn: string;
  /** The day the plan offers it on. */
  offeredOn: string;
  slot: Slot;
}

export const LEFTOVER_PORTIONS: LeftoverPortion[] = [
  { recipeId: "curry", portions: 1, cookedOn: "2026-11-04", offeredOn: "2026-11-05", slot: "lunch" },
  { recipeId: "shakshuka", portions: 1, cookedOn: "2026-11-05", offeredOn: "2026-11-06", slot: "lunch" },
];

/** What is at home now, from the last meals and the fridge photo. */
export interface Leftover {
  name: string;
  amount: string;
  since: string;
  food?: FoodKey;
  grams?: number;
}

export const LEFTOVERS_G: Leftover[] = [
  { name: "Hokkaido", amount: "½ · ≈ 500 g", since: "Bought Saturday", food: "hokkaido", grams: 500 },
  { name: "Feta", amount: "200 g", since: "Fridge photo, today", food: "feta", grams: 200 },
  { name: "Koriander", amount: "1 bunch", since: "Fridge photo, today" },
];

export const dayOf = (date: string) => DAYS.find((d) => d.date === date);
export const slotLabel = (s: { date: string; slot: Slot }) =>
  `${dayOf(s.date)?.weekday ?? s.date} ${SLOT_NAME[s.slot].toLowerCase()}`;

/* ---------------------------------------------------------- shopping list */

export type Aisle = "Produce" | "Dairy & eggs" | "Pantry";

const AISLE: Record<FoodKey, Aisle> = {
  hokkaido: "Produce",
  zwiebel: "Produce",
  spinat: "Produce",
  paprika: "Produce",
  knoblauch: "Produce",
  feta: "Dairy & eggs",
  joghurt: "Dairy & eggs",
  ei: "Dairy & eggs",
  kichererbsen: "Pantry",
  kokosmilchLight: "Pantry",
  currypaste: "Pantry",
  reis: "Pantry",
  roteLinsen: "Pantry",
  linsenGekocht: "Pantry",
  gnocchi: "Pantry",
  olivenoel: "Pantry",
  quinoa: "Pantry",
  haehnchenbrust: "Dairy & eggs",
  tomatenPassiert: "Pantry",
  salbeiButter: "Dairy & eggs",
  vollkornbrot: "Pantry",
};

/** Staples the list never asks for (a tap on the line still shows what needs them). */
const STAPLE: Partial<Record<FoodKey, string>> = { olivenoel: "pantry staple" };

export interface ShoppingLine {
  /** None for a line added by hand. */
  food: FoodKey | null;
  name: string;
  aisle: Aisle;
  /** Grams the recipes need over the range. */
  needed: number;
  /** Grams already at home (leftovers), subtracted. */
  atHome: number;
  atHomeNote?: string;
  /** Which planned recipes need it, with their grams. */
  by: { title: string; grams: number }[];
  /** Added by hand: no recipe behind it. */
  own?: boolean;
}

/** The list for a range of the plan: every ingredient of the planned recipes, scaled to the portions cooked, grouped. */
export function shoppingList(
  planned: readonly PlannedMeal[],
  from: string,
  to: string,
  leftovers: readonly Leftover[] = LEFTOVERS_G,
): ShoppingLine[] {
  const lines = new Map<FoodKey, ShoppingLine>();
  for (const p of planned) {
    if (p.date < from || p.date > to) continue;
    const r = ALL_RECIPES.get(p.recipeId);
    if (!r) continue;
    const cooked = p.cooked ?? r.portions;
    for (const i of r.ingredients) {
      const grams = (i.grams / r.portions) * cooked;
      const line = lines.get(i.food) ?? {
        food: i.food,
        name: i.name.replace(/ \(.*\)$/, ""),
        aisle: AISLE[i.food],
        needed: 0,
        atHome: 0,
        by: [],
      };
      line.needed += grams;
      line.by.push({ title: r.title, grams });
      lines.set(i.food, line);
    }
  }
  for (const l of leftovers) {
    const line = l.food && lines.get(l.food);
    if (line && l.grams) {
      line.atHome = Math.min(line.needed, l.grams);
      line.atHomeNote = `${l.amount.split(" · ")[0]} ${l.name} at home`;
    }
  }
  for (const [k, note] of Object.entries(STAPLE) as [FoodKey, string][]) {
    const line = lines.get(k);
    if (line) {
      line.atHome = line.needed;
      line.atHomeNote = note;
    }
  }
  return [...lines.values()].sort(
    (a, b) => AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle) || b.needed - a.needed,
  );
}

export const AISLES: Aisle[] = ["Produce", "Dairy & eggs", "Pantry"];

/** Lines the user added by hand in the mock. */
export const OWN_LINES: ShoppingLine[] = [
  { food: null, name: "Limetten (2)", aisle: "Produce", needed: 0, atHome: 0, by: [], own: true },
];

/* --------------------------------------------------------------- settings */

export interface PlanningSettings {
  perRound: number;
  mode: SourceMode;
  nightly: boolean;
  nightlyAt: string;
  nightlyCount: number;
  cook: number;
}

export const SETTINGS: PlanningSettings = {
  perRound: 3,
  mode: "adapted",
  nightly: true,
  nightlyAt: "03:00",
  nightlyCount: 3,
  cook: 2,
};

export const PREFERENCES: { key: string; title: string; value: string }[] = [
  { key: "dislikes", title: "Dislikes", value: "Rosenkohl, Leber, Sellerie" },
  { key: "never", title: "Never eat", value: "Pork, shellfish" },
  { key: "equipment", title: "Equipment", value: "Oven, two pans, blender · no air fryer" },
  { key: "time", title: "Weekday cooking time", value: "≤ 40 min Mon–Fri, any time at the weekend" },
  { key: "sites", title: "Favourite recipe sites", value: "chefkoch.de, eat-this.org" },
];
