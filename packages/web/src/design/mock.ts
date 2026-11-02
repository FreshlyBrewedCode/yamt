/**
 * Spike #5: made-up data for the design directions. Nothing here is real. Every direction
 * renders exactly this, so the screenshots compare like for like.
 */

export type MealStatus = "draft" | "analysing" | "needs_input" | "analysed" | "failed";

export type Macros = { kcal: number; protein: number; fat: number; carbs: number; fiber: number };

export type Meal = {
  id: string;
  title: string;
  time: string;
  status: MealStatus;
  /** undefined while a draft or analysing, preliminary while needs_input */
  kcal?: number;
  captures: string;
};

export type Day = { label: string; date: string; meals: Meal[]; totals: Macros };

export const goals: Macros = { kcal: 2400, protein: 160, fat: 80, carbs: 250, fiber: 35 };

export const days: Day[] = [
  {
    label: "Today",
    date: "Sun 2 Nov",
    totals: { kcal: 1198, protein: 72, fat: 41, carbs: 128, fiber: 19 },
    meals: [
      {
        id: "m4",
        title: "Ofenlachs mit Brokkoli und Süßkartoffel",
        time: "19:10",
        status: "draft",
        captures: "2 photos · 1 voice memo",
      },
      {
        id: "m3",
        title: "Apfel und eine Handvoll Walnüsse",
        time: "15:50",
        status: "analysing",
        captures: "1 text note",
      },
      {
        id: "m2",
        title: "Kürbis-Linsen-Curry mit Reis",
        time: "12:30",
        status: "needs_input",
        kcal: 712,
        captures: "1 voice memo · 2 photos · 1 note",
      },
      {
        id: "m1",
        title: "Haferflocken mit Skyr und Beeren",
        time: "07:40",
        status: "analysed",
        kcal: 486,
        captures: "1 voice memo",
      },
    ],
  },
  {
    label: "Yesterday",
    date: "Sat 1 Nov",
    totals: { kcal: 2310, protein: 151, fat: 84, carbs: 236, fiber: 31 },
    meals: [
      {
        id: "y4",
        title: "Griechischer Salat mit Feta",
        time: "19:30",
        status: "analysed",
        kcal: 430,
        captures: "1 photo",
      },
      { id: "y3", title: "Protein-Shake", time: "16:10", status: "failed", captures: "1 audio file" },
      {
        id: "y2",
        title: "Pasta al Pesto",
        time: "13:00",
        status: "analysed",
        kcal: 780,
        captures: "1 voice memo · 1 link",
      },
      {
        id: "y1",
        title: "Rührei mit Vollkornbrot",
        time: "08:15",
        status: "analysed",
        kcal: 520,
        captures: "2 photos",
      },
    ],
  },
  {
    label: "Friday",
    date: "Fri 31 Oct",
    totals: { kcal: 2480, protein: 164, fat: 79, carbs: 262, fiber: 36 },
    meals: [
      {
        id: "f3",
        title: "Chili sin Carne",
        time: "19:45",
        status: "analysed",
        kcal: 690,
        captures: "1 voice memo",
      },
      {
        id: "f2",
        title: "Linsensuppe mit Brot",
        time: "12:40",
        status: "analysed",
        kcal: 610,
        captures: "1 photo",
      },
      {
        id: "f1",
        title: "Porridge mit Banane",
        time: "07:30",
        status: "analysed",
        kcal: 450,
        captures: "1 text note",
      },
    ],
  },
];

export const statusLabel: Record<MealStatus, string> = {
  draft: "Draft",
  analysing: "Analysing",
  needs_input: "Needs input",
  analysed: "Analysed",
  failed: "Failed",
};

export type Provenance = "weighed" | "label" | "database" | "estimate";

export type Item = {
  name: string;
  grams: number;
  kcal: number;
  provenance: Provenance;
  confidence: number;
  note?: string;
};

export const meal = {
  title: "Kürbis-Linsen-Curry mit Reis",
  time: "Today, 12:30",
  status: "needs_input" as MealStatus,
  macros: { kcal: 712, protein: 28, fat: 22, carbs: 98, fiber: 16 } satisfies Macros,
  items: [
    { name: "Hokkaido-Kürbis", grams: 220, kcal: 90, provenance: "weighed", confidence: 0.96 },
    { name: "Rote Linsen, trocken", grams: 90, kcal: 318, provenance: "weighed", confidence: 0.96 },
    {
      name: "Basmatireis, gekocht",
      grams: 180,
      kcal: 234,
      provenance: "estimate",
      confidence: 0.45,
      note: "Portion guessed from the photo",
    },
    { name: "Kokosmilch, Alnatura", grams: 100, kcal: 178, provenance: "label", confidence: 0.9 },
    { name: "Zwiebel", grams: 60, kcal: 24, provenance: "database", confidence: 0.85 },
    { name: "Olivenöl", grams: 10, kcal: 88, provenance: "estimate", confidence: 0.7 },
    { name: "Rote Currypaste", grams: 15, kcal: 18, provenance: "label", confidence: 0.8 },
  ] satisfies Item[],
  assumptions: [
    "Assumed 1 tbsp olive oil for frying the onions.",
    "Coconut milk taken as full-fat; label read from the second photo.",
    "Rice portion estimated from the photo; the memo doesn't mention it.",
  ],
  question: {
    text: "How much rice was on the plate? The photo suggests about 180 g cooked, but you didn't mention it.",
    placeholder: "e.g. 150 g cooked, or a small cup dry",
  },
  trace: [
    { id: "t1", tool: "transcribe_audio", detail: "voice memo (0:42) → 68 words, de", ms: 2300 },
    { id: "t2", tool: "read_image", detail: "photo 1: plate with curry and rice", ms: 1800 },
    { id: "t3", tool: "read_image", detail: "photo 2: coconut milk label (Alnatura, 400 ml)", ms: 1500 },
    { id: "t4", tool: "search_food", detail: '"rote linsen" → personal history, 1 hit', ms: 120 },
    { id: "t5", tool: "search_food", detail: '"hokkaido kürbis" → Open Food Facts, 3 hits', ms: 640 },
    { id: "t6", tool: "lookup_barcode", detail: "4104420… → Kokosmilch, per 100 ml", ms: 410 },
    { id: "t7", tool: "search_food", detail: '"basmati reis gekocht" → USDA, 2 hits', ms: 880 },
    { id: "t8", tool: "compute_totals", detail: "7 items → 712 kcal", ms: 4 },
    { id: "t9", tool: "save_revision", detail: "revision 2, 1 question", ms: 30 },
  ],
  captures: [
    { id: "mc1", kind: "voice", label: "Voice memo", detail: "0:42 · transcribed" },
    { id: "mc2", kind: "photo", label: "Photo", detail: "plate" },
    { id: "mc3", kind: "photo", label: "Photo", detail: "coconut milk label" },
    { id: "mc4", kind: "note", label: "Note", detail: "Kokosmilch Alnatura, Reis vom Vortag" },
  ],
};

export const provenanceLabel: Record<Provenance, string> = {
  weighed: "Weighed",
  label: "Label",
  database: "Database",
  estimate: "Estimate",
};

/** The capture list on the Log meal screen, with upload states. */
export type Capture = { id: string } & (
  | { kind: "photo"; label: string; state: "uploaded" | "uploading"; progress?: number; hue: number }
  | { kind: "note"; text: string; state: "saved" }
  | { kind: "link"; url: string; title: string; state: "saved" }
  | { kind: "audio"; name: string; duration: string; state: "uploading" | "uploaded"; progress?: number }
  | { kind: "recording"; duration: string; state: "uploaded" }
);

export const captures: Capture[] = [
  { id: "c1", kind: "recording", duration: "0:42", state: "uploaded" },
  { id: "c2", kind: "photo", label: "IMG_2041", state: "uploaded", hue: 40 },
  { id: "c3", kind: "photo", label: "IMG_2042", state: "uploading", progress: 62, hue: 110 },
  { id: "c4", kind: "note", text: "Kokosmilch Alnatura, Reis vom Vortag", state: "saved" },
  {
    id: "c5",
    kind: "link",
    url: "eat-this.org/kuerbis-linsen-curry",
    title: "Kürbis-Linsen-Curry – Eat this!",
    state: "saved",
  },
  { id: "c6", kind: "audio", name: "Kochen Sonntag.m4a", duration: "6:18", state: "uploading", progress: 18 },
];

/** Weight log: five weeks, made up. */
export const weights: { day: number; kg: number }[] = [
  83.9, 84.3, 83.6, 83.8, 83.2, 83.5, 83.0, 83.4, 82.9, 83.1, 82.6, 83.0, 82.4, 82.8, 82.5, 82.1, 82.6, 82.3,
  81.9, 82.4, 82.0, 82.2, 81.8, 82.3, 81.7, 82.0, 81.6, 81.9, 81.5, 81.8, 81.4, 81.7, 81.3, 81.6, 81.2,
].map((kg, day) => ({ day, kg }));

export const todayWeight = { kg: 81.2, date: "Today 06:55" };

export const pct = (value: number, goal: number) => Math.min(100, Math.round((value / goal) * 100));
