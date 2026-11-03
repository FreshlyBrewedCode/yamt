import type { Targets } from "./api-goals.ts";

/**
 * Guided goal setup (#24): from body data, daily life, training and a goal (cut / maintain /
 * bulk) to daily targets, with one explanation line per number. One pure function,
 * `calculateGoal`: the web app runs it live while the user tweaks, the server runs it again on
 * save and stores its result, so stored targets never come from the client's arithmetic.
 *
 * The numbers and their sources: `reports/Goal setting research.md`. Resting energy by
 * Mifflin-St Jeor (Cunningham when body fat is known and lean), a daily-life PAL plus a
 * discounted exercise term, the pace as % body weight per week (7,700 kcal/kg), protein in g/kg
 * of a reference weight, fat as a share of energy with a floor, fibre from energy, carbs as the
 * remainder (EU energy factors; carbs exclude fibre, which counts 2 kcal/g).
 */

/** Bump when a rule or a number changes: every stored derivation records the version it ran. */
export const ALGORITHM_VERSION = 1;

export const SEXES = ["female", "male"] as const;
export type Sex = (typeof SEXES)[number];

export const DAILY_LIFE_KEYS = ["sitting", "some_walking", "on_feet", "physical"] as const;
export type DailyLife = (typeof DAILY_LIFE_KEYS)[number];

/** Physical activity level of daily life, exercise excluded (FAO/WHO/UNU, DGE examples). */
export const DAILY_LIFE: Record<DailyLife, { pal: number; label: string; example: string }> = {
  sitting: {
    pal: 1.4,
    label: "Mostly sitting",
    example: "Desk job, by car or train, little walking (under 5,000 steps)",
  },
  some_walking: {
    pal: 1.5,
    label: "Sitting with some walking",
    example: "Office work, walks and errands on foot (5,000–7,500 steps)",
  },
  on_feet: {
    pal: 1.65,
    label: "On my feet a lot",
    example: "Retail, teaching, care, lots of walking (7,500–10,000 steps)",
  },
  physical: {
    pal: 1.85,
    label: "Physical work",
    example: "Building site, farm, warehouse, carrying loads (over 10,000 steps)",
  },
};

export const TRAINING_TYPES = ["strength", "endurance", "mixed"] as const;
export type TrainingType = (typeof TRAINING_TYPES)[number];

export const INTENSITIES = ["moderate", "hard"] as const;
export type Intensity = (typeof INTENSITIES)[number];

/** MET values per type and intensity (2024 Adult Compendium). */
export const TRAINING: Record<
  TrainingType,
  { met: Record<Intensity, number>; label: string; example: string }
> = {
  strength: {
    met: { moderate: 5.0, hard: 6.0 },
    label: "Strength",
    example: "Weights, machines, bodyweight",
  },
  endurance: {
    met: { moderate: 7.0, hard: 9.5 },
    label: "Endurance",
    example: "Running, cycling, swimming",
  },
  mixed: {
    met: { moderate: 6.5, hard: 8.0 },
    label: "Mixed or team sport",
    example: "Football, classes, martial arts, CrossFit",
  },
};

export const DURATIONS = [30, 45, 60, 90] as const;
export type Duration = (typeof DURATIONS)[number];
export const MAX_SESSIONS = 7;

/** Exercise energy counts at 75 %: compensation and over-reporting (Careau 2021). */
const EXERCISE_DISCOUNT = 0.75;

export interface Training {
  /** 0–7; 0 = no training (type, minutes and intensity are then ignored). */
  sessionsPerWeek: number;
  minutes: Duration;
  type: TrainingType;
  intensity: Intensity;
}

export const GOAL_KINDS = ["cut", "maintain", "bulk"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export const GOAL_KIND: Record<GoalKind, { label: string; example: string }> = {
  cut: { label: "Cut", example: "Lose fat, keep the muscle" },
  maintain: { label: "Maintain", example: "Keep your weight, eat well" },
  bulk: { label: "Bulk", example: "Build muscle; a little fat comes with it" },
};

export const PACES = ["gentle", "standard", "ambitious"] as const;
export type Pace = (typeof PACES)[number];

export const PACE_LABEL: Record<Pace, string> = {
  gentle: "Gentle",
  standard: "Standard",
  ambitious: "Ambitious",
};

/** % body weight per week (cut: Helms 2014, Garthe 2011; bulk: Iraki 2019, Helms 2023). */
export const PACE_RATES: Record<"cut" | "bulk", Record<Pace, number>> = {
  cut: { gentle: 0.25, standard: 0.5, ambitious: 0.75 },
  bulk: { gentle: 0.1, standard: 0.25, ambitious: 0.4 },
};

const KCAL_PER_KG = 7700;
/** Cut deficit: at most 25 % of maintenance and 1,000 kcal; bulk surplus at most 15 %. */
const CUT_MAX_SHARE = 0.25;
const CUT_MAX_KCAL = 1000;
const BULK_MAX_SHARE = 0.15;
/** Maintenance above 2.4 × resting is hard to sustain (FAO/WHO/UNU). */
const MAX_PAL = 2.4;
const KCAL_FLOOR: Record<Sex, number> = { female: 1200, male: 1500 };

export const PROTEIN_PRESETS = ["basic", "moderate", "high", "very_high"] as const;
export type ProteinPreset = (typeof PROTEIN_PRESETS)[number];

/** Grams per kg of reference weight (Morton 2018, ISSN, Helms 2014; DGE minimum 0.8). */
export const PROTEIN: Record<ProteinPreset, { gPerKg: number; label: string }> = {
  basic: { gPerKg: 1.2, label: "Basic" },
  moderate: { gPerKg: 1.6, label: "Moderate" },
  high: { gPerKg: 2.0, label: "High" },
  very_high: { gPerKg: 2.4, label: "Very high" },
};
const PROTEIN_MAX_SHARE = 0.35;

/** Fat as % of energy: presets on the 20–40 % scale (EFSA/IOM 20–35 %, DGE 30 %). */
export const FAT_PRESETS = [
  { percent: 25, label: "Lower" },
  { percent: 30, label: "Balanced" },
  { percent: 35, label: "Higher" },
] as const;
export const FAT_PERCENT = { min: 20, max: 40, step: 5, default: 30 } as const;
const FAT_FLOOR_SHARE = 0.2;
const FAT_FLOOR_G_PER_KG = 0.6;

const CARBS_LOW_G = 130;

/** What the user is, does and weighs: the questions of the flow's first three steps. */
export interface GoalInputs {
  sex: Sex;
  birthYear: number;
  heightCm: number;
  weightKg: number;
  /** Optional; switches to Cunningham when lean. */
  bodyFatPct: number | null;
  dailyLife: DailyLife;
  training: Training;
  /** The local date the goal starts (`YYYY-MM-DD`): age is reckoned from its year. */
  today: string;
  pregnantOrBreastfeeding: boolean;
}

/** What the user picks and tweaks: the goal, its pace, protein and fat. */
export interface GoalChoices {
  goal: GoalKind;
  /** Ignored for maintain. */
  pace: Pace;
  protein: ProteinPreset;
  /** 20–40, in steps of 5. */
  fatPercent: number;
}

export type GoalRefusalReason = "under_18" | "pregnancy" | "underweight_cut";

export interface GoalRefusal {
  ok: false;
  version: number;
  reason: GoalRefusalReason;
  message: string;
}

/** The explanation, one line per number (English UI copy). */
export interface GoalLines {
  rmr: string;
  dailyLife: string;
  exercise: string;
  maintenance: string;
  delta: string;
  protein: string;
  fat: string;
  carbs: string;
  fiber: string;
}

export interface GoalResult {
  ok: true;
  version: number;
  age: number;
  bmi: number;
  rmr: { kcal: number; equation: "mifflin" | "cunningham"; ffmKg: number | null };
  pal: number;
  /** Resting × PAL: a day without training. */
  dailyLifeKcal: number;
  /** Per day, averaged over the week, already discounted. */
  exerciseKcal: number;
  /** Rounded to 10; `capped` at 2.4 × resting. */
  maintenance: { kcal: number; capped: boolean };
  pace: {
    /** % body weight per week asked for (0 for maintain). */
    rate: number;
    /** kcal/day the rate asks for, before caps and the floor (negative for a cut). */
    requested: number;
    /** What applies: `kcal − maintenance`. */
    delta: number;
    /** What the applied delta means in kg (signed) and % body weight per week. */
    kgPerWeek: number;
    percentPerWeek: number;
    /** Which limit cut the requested delta down, if any. */
    cap: "share" | "max" | null;
  };
  kcal: { value: number; floor: number; floorApplied: boolean };
  /** Weight at BMI 25 above it, else the actual weight: protein and the fat floor scale with it. */
  referenceWeightKg: number;
  protein: {
    grams: number;
    preset: ProteinPreset;
    /** Grams per kg of reference weight, as targeted. */
    gPerKg: number;
    capped: boolean;
    floorApplied: boolean;
  };
  fat: { grams: number; chosenPercent: number; floorApplied: boolean };
  carbs: { grams: number; low: boolean };
  fiber: { grams: number };
  /** Share of kcal per macro (fibre at 2 kcal/g), unrounded fractions 0–1. */
  split: { protein: number; fat: number; carbs: number; fiber: number };
  /** 4P + 9F + 4C + 2·fibre: within ±10 of `kcal.value`. */
  energyCheck: number;
  lines: GoalLines;
  /** Floors and caps that applied, and warnings (none is an error). */
  notes: string[];
  footer: string;
  targets: Targets;
}

export type GoalCalculation = GoalResult | GoalRefusal;

/**
 * What a saved guided goal stores (`goals.derivation`): everything that went in, and everything
 * that came out, so a later retro can show why a target was what it was.
 */
export interface GoalDerivation {
  version: number;
  inputs: GoalInputs;
  choices: GoalChoices;
  weight: GoalWeight;
  result: GoalResult;
}

/** The weight the calculation uses, and where it came from. */
export interface GoalWeight {
  kg: number;
  /** `average`: mean of the last 7 days (≥ 4 entries); `latest`: the newest entry. */
  basis: "average" | "latest";
  /** Entries the figure rests on. */
  count: number;
  /** When the newest entry it uses was measured (epoch ms). */
  measuredAt: number;
}

const DAY_MS = 86_400_000;

/**
 * The weight from the log: the mean of the last 7 days when there are at least 4 entries in
 * them, else the newest entry. Null without any entry.
 */
export function goalWeight(
  entries: readonly { kg: number; measuredAt: number }[],
  now: number,
): GoalWeight | null {
  const past = entries.filter((e) => e.measuredAt <= now).toSorted((a, b) => b.measuredAt - a.measuredAt);
  const latest = past[0];
  if (!latest) return null;
  const week = past.filter((e) => e.measuredAt > now - 7 * DAY_MS);
  if (week.length >= 4) {
    const mean = week.reduce((s, e) => s + e.kg, 0) / week.length;
    return { kg: round(mean, 0.1), basis: "average", count: week.length, measuredAt: latest.measuredAt };
  }
  return { kg: latest.kg, basis: "latest", count: 1, measuredAt: latest.measuredAt };
}

/** Age from the birth year (the year the goal starts in; ± a year without a birthday). */
export const ageOf = (birthYear: number, today: string): number => Number(today.slice(0, 4)) - birthYear;

export const bmiOf = (weightKg: number, heightCm: number): number => weightKg / (heightCm / 100) ** 2;

/** The protein preset to start from: by training, goal and age. */
export function defaultProtein(inputs: Pick<GoalInputs, "training" | "birthYear" | "today">, goal: GoalKind) {
  const trains = inputs.training.sessionsPerWeek > 0;
  if (!trains) return ageOf(inputs.birthYear, inputs.today) >= 65 ? "moderate" : "basic";
  return goal === "cut" ? "high" : "moderate";
}

/** The choices a fresh flow starts with for a goal. */
export function defaultChoices(
  inputs: Pick<GoalInputs, "training" | "birthYear" | "today">,
  goal: GoalKind,
): GoalChoices {
  return { goal, pace: "standard", protein: defaultProtein(inputs, goal), fatPercent: FAT_PERCENT.default };
}

/** Why yamt doesn't calculate targets, said neutrally (shown in the flow and as the API's 422). */
export const REFUSALS: Record<GoalRefusalReason, string> = {
  under_18:
    "yamt doesn't calculate targets under 18: growing bodies need more than a formula. A doctor or dietitian can help, and the manual targets stay open.",
  pregnancy:
    "During pregnancy and breastfeeding needs change from month to month, so yamt doesn't calculate them. Your midwife or doctor can help, and the manual targets stay open.",
  underweight_cut: "At a BMI under 18.5 yamt doesn't plan a cut. Maintain or bulk are open.",
};

/** Whether the inputs rule out a plan, or a cut. Null: fine. */
export function refusalFor(
  inputs: Pick<GoalInputs, "birthYear" | "today" | "pregnantOrBreastfeeding" | "weightKg" | "heightCm">,
  goal?: GoalKind,
): GoalRefusal | null {
  const refuse = (reason: GoalRefusalReason): GoalRefusal => ({
    ok: false,
    version: ALGORITHM_VERSION,
    reason,
    message: REFUSALS[reason],
  });
  if (ageOf(inputs.birthYear, inputs.today) < 18) return refuse("under_18");
  if (inputs.pregnantOrBreastfeeding) return refuse("pregnancy");
  if (goal === "cut" && bmiOf(inputs.weightKg, inputs.heightCm) < 18.5) return refuse("underweight_cut");
  return null;
}

/**
 * Rounds to a multiple of `step`; `ceil` and `floor` for floors and caps, so they still hold
 * after rounding (with a little tolerance for binary leftovers like 48.000000001).
 */
function round(n: number, step: number, mode: "round" | "ceil" | "floor" = "round"): number {
  const q = n / step;
  const k = mode === "ceil" ? Math.ceil(q - 1e-9) : mode === "floor" ? Math.floor(q + 1e-9) : Math.round(q);
  return Math.round(k * step * 1000) / 1000;
}

const fmt = (n: number): string => Math.round(n).toLocaleString("en");
const fmt1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);
/** "0.5", "0.25", "0.1": a pace rate without trailing zeros. */
const fmtRate = (n: number): string => String(Math.round(n * 100) / 100);
const signed = (n: number): string => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : "±0");
const pct = (fraction: number): string => `${Math.round(fraction * 100)} %`;

function trainingWords(t: Training): string {
  const kind = { strength: "strength", endurance: "endurance", mixed: "mixed or team sport" }[t.type];
  const n = t.sessionsPerWeek;
  return `${n} ${t.intensity === "hard" ? "hard " : ""}${kind} session${n === 1 ? "" : "s"} a week (${t.minutes} min)`;
}

const PROTEIN_WHY: Record<ProteinPreset, (goal: GoalKind) => string> = {
  basic: () => "covers everyday needs without training (the DGE minimum is 0.8 g/kg)",
  moderate: (goal) => (goal === "bulk" ? "enough to build muscle" : "where muscle gain levels off"),
  high: (goal) => (goal === "cut" ? "protects muscle while cutting" : "generous; more than most people need"),
  very_high: () => "the upper end; more brings nothing extra",
};

/**
 * Daily targets from inputs and choices, with the intermediate values and one explanation line
 * per number. A refusal (under 18, pregnancy or breastfeeding, a cut at BMI < 18.5) instead of a
 * result when the inputs rule a plan out.
 */
export function calculateGoal(inputs: GoalInputs, choices: GoalChoices): GoalCalculation {
  const refusal = refusalFor(inputs, choices.goal);
  if (refusal) return refusal;

  const { sex, heightCm: h, weightKg: w, bodyFatPct: bf, training } = inputs;
  const age = ageOf(inputs.birthYear, inputs.today);
  const bmi = bmiOf(w, h);
  const notes: string[] = [];

  // 1. resting energy: Cunningham from lean mass when lean, else Mifflin-St Jeor
  const lean = bf !== null && bf < (sex === "male" ? 25 : 32);
  const ffmKg = lean ? round(w * (1 - bf / 100), 0.1) : null;
  const rmr = Math.round(
    ffmKg !== null ? 500 + 22 * ffmKg : 10 * w + 6.25 * h - 5 * age + (sex === "male" ? 5 : -161),
  );

  // 2. daily life, 3. training (net of resting, discounted, averaged over the week)
  const pal = DAILY_LIFE[inputs.dailyLife].pal;
  const dailyLifeKcal = Math.round(rmr * pal);
  const sessions = Math.max(0, Math.min(MAX_SESSIONS, Math.round(training.sessionsPerWeek)));
  const met = TRAINING[training.type].met[training.intensity];
  const exerciseKcal =
    sessions === 0
      ? 0
      : Math.round((EXERCISE_DISCOUNT * sessions * (training.minutes / 60) * (met - 1) * (rmr / 24)) / 7);

  // 4. maintenance, capped at 2.4 × resting
  const uncapped = dailyLifeKcal + exerciseKcal;
  const maintenanceCapped = uncapped > MAX_PAL * rmr;
  const maintenance = round(Math.min(uncapped, MAX_PAL * rmr), 10);
  if (maintenanceCapped) {
    notes.push(
      `Maintenance capped at ${fmt(maintenance)} kcal (2.4 × resting): more is hard to sustain and usually over-counted.`,
    );
  }

  // 5. pace: % body weight per week → kcal/day, within the caps
  const goal = choices.goal;
  const rate = goal === "maintain" ? 0 : PACE_RATES[goal][choices.pace];
  const sign = goal === "cut" ? -1 : 1;
  // the magnitude is rounded, so a cut and a bulk of the same size round alike
  const requested = sign * round((rate * w * KCAL_PER_KG) / 100 / 7, 10);
  let delta = requested;
  let cap: "share" | "max" | null = null;
  let limit = Number.POSITIVE_INFINITY;
  if (goal === "cut") {
    const share = round(CUT_MAX_SHARE * maintenance, 10, "floor");
    limit = Math.min(share, CUT_MAX_KCAL);
    if (-delta > limit) {
      delta = -limit;
      cap = share <= CUT_MAX_KCAL ? "share" : "max";
    }
  } else if (goal === "bulk") {
    limit = round(BULK_MAX_SHARE * maintenance, 10, "floor");
    if (delta > limit) {
      delta = limit;
      cap = "share";
    }
  }

  // 6. kcal, never under the floor (a cut never under resting energy)
  const floor = Math.max(KCAL_FLOOR[sex], goal === "cut" ? rmr : 0);
  const floorKcal = round(floor, 10, "ceil");
  const floorApplied = maintenance + delta < floorKcal;
  const kcal = floorApplied ? floorKcal : maintenance + delta;
  delta = kcal - maintenance;
  const kgPerWeek = (delta * 7) / KCAL_PER_KG;
  const percentPerWeek = (kgPerWeek / w) * 100;
  if (cap === "share") {
    notes.push(
      goal === "cut"
        ? `Deficit capped at 25 % of maintenance: ${fmt(limit)} instead of ${fmt(-requested)} kcal a day. A bigger one costs muscle.`
        : `Surplus capped at 15 % of maintenance: ${fmt(limit)} instead of ${fmt(requested)} kcal a day. More mostly adds fat.`,
    );
  } else if (cap === "max") {
    notes.push(`Deficit capped at 1,000 kcal a day instead of ${fmt(-requested)}.`);
  }
  if (floorApplied) {
    notes.push(
      goal === "cut" && floorKcal > round(KCAL_FLOOR[sex], 10, "ceil")
        ? `Raised to ${fmt(floorKcal)} kcal: a cut stays above your resting energy.`
        : `Raised to ${fmt(floorKcal)} kcal, the lowest target yamt sets for ${sex === "male" ? "men" : "women"}.`,
    );
  }

  // 7. protein per kg of reference weight (weight at BMI 25 above it)
  const referenceWeightKg = bmi > 25 ? round(25 * (h / 100) ** 2, 0.1) : w;
  const gPerKg = PROTEIN[choices.protein].gPerKg;
  const proteinFloor = (age >= 65 ? 1.0 : 0.8) * referenceWeightKg;
  const proteinCap = (PROTEIN_MAX_SHARE * kcal) / 4;
  let protein = gPerKg * referenceWeightKg;
  let proteinCapped = false;
  let proteinFloorApplied = false;
  if (protein > proteinCap) {
    protein = round(proteinCap, 5, "floor");
    proteinCapped = true;
    notes.push(`Protein capped at 35 % of energy (${fmt(protein)} g).`);
  } else {
    protein = round(protein, 5);
  }
  if (protein < proteinFloor) {
    protein = round(proteinFloor, 5, "ceil");
    proteinFloorApplied = true;
  }

  // 8. fat as a share of energy, never under max(20 %, 0.6 g/kg)
  const fatPercent = Math.min(FAT_PERCENT.max, Math.max(FAT_PERCENT.min, choices.fatPercent));
  const fatFloor = Math.max((FAT_FLOOR_SHARE * kcal) / 9, FAT_FLOOR_G_PER_KG * referenceWeightKg);
  const fatChosen = ((fatPercent / 100) * kcal) / 9;
  const fatFloorApplied = fatChosen < fatFloor;
  const fat = fatFloorApplied ? round(fatFloor, 5, "ceil") : round(fatChosen, 5);
  if (fatFloorApplied) {
    notes.push(`Fat raised to ${fmt(fat)} g (0.6 g/kg): enough for hormones and fat-soluble vitamins.`);
  }

  // 9. fibre from energy, 10.–11. carbs as the rest, rounded so the energy still adds up
  const fiber = round(Math.max(30, (14 * kcal) / 1000), 5);
  const carbs = Math.max(0, round((kcal - 4 * protein - 9 * fat - 2 * fiber) / 4, 5));
  const carbsLow = carbs < CARBS_LOW_G;
  if (carbsLow) {
    notes.push(`Carbs under 130 g a day, the usual minimum: a lower protein or fat preset leaves more.`);
  }
  const energyCheck = 4 * protein + 9 * fat + 4 * carbs + 2 * fiber;

  const split = {
    protein: (4 * protein) / kcal,
    fat: (9 * fat) / kcal,
    carbs: (4 * carbs) / kcal,
    fiber: (2 * fiber) / kcal,
  };

  // the explanation, one line per number
  const kgWord = `${fmt1(Math.abs(kgPerWeek))} kg (${fmtRate(Math.abs(percentPerWeek))} %)`;
  const lines: GoalLines = {
    rmr:
      ffmKg !== null
        ? `≈${fmt(round(rmr, 10))} kcal at rest from your lean mass (${fmt1(ffmKg)} kg at ${fmt(bf!)} % body fat; Cunningham, suits lean, active people)`
        : `≈${fmt(round(rmr, 10))} kcal at rest from height, weight, age and sex (Mifflin-St Jeor, typically ±10 %)`,
    dailyLife: `× ${pal.toFixed(2).replace(/0$/, "")} for daily life, ${DAILY_LIFE[inputs.dailyLife].label.toLowerCase()}: ≈${fmt(round(dailyLifeKcal, 10))} kcal without training`,
    exercise:
      sessions === 0
        ? "No training counted"
        : `+${fmt(round(exerciseKcal, 10))} kcal a day for ${trainingWords({ ...training, sessionsPerWeek: sessions })}, counted conservatively`,
    maintenance: `≈${fmt(maintenance)} kcal a day keeps your weight`,
    delta:
      goal === "maintain" && delta === 0
        ? "No deficit or surplus: eat at maintenance"
        : goal === "maintain"
          ? `${signed(delta)} kcal a day, up to the floor`
          : `${signed(delta)} kcal a day for about ${kgWord} a week; ${
              floorApplied || cap
                ? "limited, see below"
                : goal === "cut"
                  ? "slower cuts keep more muscle"
                  : "a small surplus adds less fat"
            }`,
    protein: proteinCapped
      ? `${fmt(protein)} g, capped at 35 % of energy (${fmt1(protein / referenceWeightKg)} g/kg)`
      : proteinFloorApplied
        ? `${fmt(protein)} g ≈ ${fmt1(protein / referenceWeightKg)} g/kg, the minimum at your age`
        : `${fmt(protein)} g ≈ ${fmt1(gPerKg)} g/kg${referenceWeightKg !== w ? ` of ${fmt1(referenceWeightKg)} kg (your weight at BMI 25)` : ""}, ${PROTEIN_WHY[choices.protein](goal)}`,
    fat: fatFloorApplied
      ? `${fmt(fat)} g ≈ ${pct(split.fat)} of energy, raised to the floor of 0.6 g/kg`
      : `${fmt(fat)} g ≈ ${pct(split.fat)} of energy${fatPercent === 30 ? " (DGE)" : ""}; never below 20 %`,
    carbs: carbsLow
      ? `${fmt(carbs)} g, the rest: under the usual 130 g`
      : `${fmt(carbs)} g, the rest, for training and fibre-rich food`,
    fiber: fiber > 30 ? `at least ${fmt(fiber)} g (14 g per 1,000 kcal)` : `at least ${fmt(fiber)} g (DGE)`,
  };

  return {
    ok: true,
    version: ALGORITHM_VERSION,
    age,
    bmi: round(bmi, 0.1),
    rmr: { kcal: rmr, equation: ffmKg !== null ? "cunningham" : "mifflin", ffmKg },
    pal,
    dailyLifeKcal,
    exerciseKcal,
    maintenance: { kcal: maintenance, capped: maintenanceCapped },
    pace: {
      rate,
      requested,
      delta,
      kgPerWeek: round(kgPerWeek, 0.01),
      percentPerWeek: round(percentPerWeek, 0.01),
      cap,
    },
    kcal: { value: kcal, floor: floorKcal, floorApplied },
    referenceWeightKg,
    protein: {
      grams: protein,
      preset: choices.protein,
      gPerKg,
      capped: proteinCapped,
      floorApplied: proteinFloorApplied,
    },
    fat: { grams: fat, chosenPercent: fatPercent, floorApplied: fatFloorApplied },
    carbs: { grams: carbs, low: carbsLow },
    fiber: { grams: fiber },
    split,
    energyCheck,
    lines,
    notes,
    footer: "A starting estimate: your weight trend will tell whether it fits.",
    targets: { energyKcal: kcal, protein, fat, carbohydrate: carbs, fiber },
  };
}

/** "Guided · cut, standard pace" for a goal's history. */
export function guidedLabel(d: Pick<GoalDerivation, "choices">): string {
  return `Guided · ${guidedSummary(d).toLowerCase()}`;
}

/** "Cut, standard pace", "Maintain". */
export function guidedSummary(d: Pick<GoalDerivation, "choices">): string {
  const { goal, pace } = d.choices;
  return goal === "maintain" ? "Maintain" : `${GOAL_KIND[goal].label}, ${pace} pace`;
}
