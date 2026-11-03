import { describe, expect, test } from "bun:test";
import {
  ALGORITHM_VERSION,
  calculateGoal,
  DAILY_LIFE_KEYS,
  DURATIONS,
  defaultChoices,
  FAT_PERCENT,
  GOAL_KINDS,
  type GoalChoices,
  type GoalInputs,
  type GoalResult,
  goalWeight,
  guidedLabel,
  INTENSITIES,
  PACES,
  PROTEIN_PRESETS,
  TRAINING_TYPES,
} from "../src/goal-calc.ts";

// The research report's worked example: man, 30 y, 180 cm, 80 kg, 15 % body fat.
const fixture: GoalInputs = {
  sex: "male",
  birthYear: 1996,
  heightCm: 180,
  weightKg: 80,
  bodyFatPct: 15,
  dailyLife: "some_walking",
  training: { sessionsPerWeek: 3, minutes: 60, type: "strength", intensity: "moderate" },
  today: "2026-11-03",
  pregnantOrBreastfeeding: false,
};
const noTraining = { ...fixture.training, sessionsPerWeek: 0 };

function calc(inputs: Partial<GoalInputs>, choices: Partial<GoalChoices> = {}): GoalResult {
  const i = { ...fixture, ...inputs };
  const r = calculateGoal(i, { ...defaultChoices(i, choices.goal ?? "maintain"), ...choices });
  if (!r.ok) throw new Error(`refused: ${r.message}`);
  return r;
}

describe("resting energy", () => {
  test("the fixture: Mifflin-St Jeor 1,780, Cunningham 1,996", () => {
    expect(calc({ bodyFatPct: null }).rmr).toEqual({ kcal: 1780, equation: "mifflin", ffmKg: null });
    expect(calc({}).rmr).toEqual({ kcal: 1996, equation: "cunningham", ffmKg: 68 });
  });

  test("Cunningham only when lean: under 25 % body fat for men, 32 % for women", () => {
    expect(calc({ bodyFatPct: 24.9 }).rmr.equation).toBe("cunningham");
    expect(calc({ bodyFatPct: 25 }).rmr.equation).toBe("mifflin");
    const woman = { sex: "female" as const, weightKg: 60, heightCm: 165 };
    expect(calc({ ...woman, bodyFatPct: 31 }).rmr.equation).toBe("cunningham");
    // Mifflin for women: 10·60 + 6.25·165 − 5·30 − 161 = 1,320.25
    expect(calc({ ...woman, bodyFatPct: 32 }).rmr).toEqual({ kcal: 1320, equation: "mifflin", ffmKg: null });
  });

  test("the line names the equation and what it rests on", () => {
    expect(calc({ bodyFatPct: null }).lines.rmr).toBe(
      "≈1,780 kcal at rest from height, weight, age and sex (Mifflin-St Jeor, typically ±10 %)",
    );
    expect(calc({}).lines.rmr).toContain("lean mass (68.0 kg at 15 % body fat; Cunningham");
  });
});

describe("maintenance", () => {
  test("resting × daily-life PAL plus discounted training, rounded to 10", () => {
    const r = calc({});
    expect(r.pal).toBe(1.5);
    expect(r.dailyLifeKcal).toBe(2994);
    // 0.75 × 3 × 1 h × (5 − 1) × 1,996 / 24 / 7
    expect(r.exerciseKcal).toBe(107);
    expect(r.maintenance).toEqual({ kcal: 3100, capped: false });
    expect(r.lines.exercise).toBe(
      "+110 kcal a day for 3 strength sessions a week (60 min), counted conservatively",
    );
  });

  test("no sessions: no training counted, whatever the rest says", () => {
    const r = calc({ training: { ...noTraining, type: "endurance", intensity: "hard" } });
    expect(r.exerciseKcal).toBe(0);
    expect(r.maintenance.kcal).toBe(2990);
    expect(r.lines.exercise).toBe("No training counted");
  });

  test("hard endurance counts more than moderate strength", () => {
    const hard = calc({
      training: { sessionsPerWeek: 3, minutes: 60, type: "endurance", intensity: "hard" },
    });
    // 0.75 × 3 × 1 × 8.5 × 1,996 / 24 / 7
    expect(hard.exerciseKcal).toBe(227);
  });
});

describe("pace, caps and floors", () => {
  test("the fixture's cut: −440 kcal for 0.5 % a week", () => {
    const r = calc({}, { goal: "cut" });
    expect(r.pace).toMatchObject({ rate: 0.5, requested: -440, delta: -440, cap: null });
    expect(r.kcal).toMatchObject({ value: 2660, floorApplied: false });
    expect(r.lines.delta).toBe(
      "−440 kcal a day for about 0.4 kg (0.5 %) a week; slower cuts keep more muscle",
    );
  });

  test("bulk presets and maintain", () => {
    expect(calc({}, { goal: "bulk", pace: "gentle" }).pace.delta).toBe(90);
    expect(calc({}, { goal: "bulk" }).pace.delta).toBe(220);
    expect(calc({}, { goal: "bulk", pace: "ambitious" }).pace.delta).toBe(350);
    const m = calc({}, { goal: "maintain", pace: "ambitious" });
    expect(m.pace.delta).toBe(0);
    expect(m.kcal.value).toBe(m.maintenance.kcal);
  });

  test("a cut's deficit stops at 25 % of maintenance", () => {
    // 130 kg, sitting: maintenance 3,120; ambitious asks −1,070, 25 % is 780
    const r = calc(
      { weightKg: 130, birthYear: 1986, bodyFatPct: null, dailyLife: "sitting", training: noTraining },
      { goal: "cut", pace: "ambitious" },
    );
    expect(r.maintenance.kcal).toBe(3120);
    expect(r.pace).toMatchObject({ requested: -1070, delta: -780, cap: "share" });
    expect(r.kcal.value).toBe(2340);
    expect(r.notes.join(" ")).toContain("Deficit capped at 25 % of maintenance: 780 instead of 1,070");
  });

  test("and at 1,000 kcal a day", () => {
    const r = calc(
      {
        weightKg: 140,
        heightCm: 195,
        birthYear: 2001,
        bodyFatPct: null,
        dailyLife: "physical",
        training: { sessionsPerWeek: 5, minutes: 60, type: "endurance", intensity: "hard" },
      },
      { goal: "cut", pace: "ambitious" },
    );
    expect(r.maintenance.kcal).toBe(5100);
    expect(r.pace).toMatchObject({ requested: -1160, delta: -1000, cap: "max" });
  });

  test("a bulk's surplus stops at 15 % of maintenance", () => {
    const r = calc(
      {
        sex: "female",
        weightKg: 50,
        heightCm: 150,
        birthYear: 1956,
        bodyFatPct: null,
        dailyLife: "sitting",
        training: noTraining,
      },
      { goal: "bulk", pace: "ambitious" },
    );
    expect(r.maintenance.kcal).toBe(1300);
    expect(r.pace).toMatchObject({ requested: 220, delta: 190, cap: "share" });
  });

  test("never under 1,200 kcal for women, 1,500 for men", () => {
    const woman = calc(
      {
        sex: "female",
        weightKg: 50,
        heightCm: 155,
        birthYear: 1966,
        bodyFatPct: null,
        dailyLife: "sitting",
        training: noTraining,
      },
      { goal: "cut", pace: "ambitious" },
    );
    expect(woman.maintenance.kcal).toBe(1410);
    expect(woman.kcal).toEqual({ value: 1200, floor: 1200, floorApplied: true });
    expect(woman.pace.delta).toBe(-210);
    expect(woman.notes.join(" ")).toContain("Raised to 1,200 kcal, the lowest target yamt sets for women");
    expect(woman.lines.delta).toContain("limited, see below");

    const man = calc(
      {
        weightKg: 55,
        heightCm: 160,
        birthYear: 1956,
        bodyFatPct: null,
        dailyLife: "sitting",
        training: noTraining,
      },
      { goal: "cut", pace: "ambitious" },
    );
    expect(man.kcal).toMatchObject({ value: 1500, floorApplied: true });

    // maintenance itself under the floor: raised, and said so
    const small = calc(
      {
        sex: "female",
        weightKg: 45,
        heightCm: 150,
        birthYear: 1946,
        bodyFatPct: null,
        dailyLife: "sitting",
        training: noTraining,
      },
      { goal: "maintain" },
    );
    expect(small.maintenance.kcal).toBe(1160);
    expect(small.kcal.value).toBe(1200);
    expect(small.lines.delta).toBe("+40 kcal a day, up to the floor");
  });

  test("a cut's floor is at least resting energy", () => {
    expect(calc({}, { goal: "cut" }).kcal.floor).toBe(2000);
    expect(calc({}, { goal: "bulk" }).kcal.floor).toBe(1500);
  });
});

describe("macros", () => {
  test("the fixture's cut: 160 g protein (2.0 g/kg), 30 % fat, fibre from energy, carbs the rest", () => {
    const r = calc({}, { goal: "cut" });
    expect(r.targets).toEqual({ energyKcal: 2660, protein: 160, fat: 90, carbohydrate: 285, fiber: 35 });
    expect(r.lines.protein).toBe("160 g ≈ 2.0 g/kg, protects muscle while cutting");
    expect(r.lines.fat).toBe("90 g ≈ 30 % of energy (DGE); never below 20 %");
    expect(r.lines.fiber).toBe("at least 35 g (14 g per 1,000 kcal)");
    expect(r.split.protein + r.split.fat + r.split.carbs + r.split.fiber).toBeCloseTo(1, 2);
  });

  test("protein per kg of the weight at BMI 25 above it", () => {
    const r = calc({ weightKg: 100, bodyFatPct: null }, { goal: "cut" });
    expect(r.bmi).toBe(30.9);
    expect(r.referenceWeightKg).toBe(81);
    expect(r.protein.grams).toBe(160);
    expect(r.lines.protein).toContain("of 81.0 kg (your weight at BMI 25)");
    expect(calc({ weightKg: 70 }).referenceWeightKg).toBe(70);
  });

  test("protein capped at 35 % of energy", () => {
    const r = calc(
      { bodyFatPct: null, dailyLife: "sitting", training: noTraining },
      { goal: "cut", pace: "ambitious", protein: "very_high" },
    );
    expect(r.kcal.value).toBe(1870);
    expect(r.protein).toMatchObject({ grams: 160, capped: true });
    expect((4 * r.protein.grams) / r.kcal.value).toBeLessThanOrEqual(0.35);
    expect(r.notes.join(" ")).toContain("Protein capped at 35 % of energy");
  });

  test("fat follows the slider, never under 0.6 g/kg", () => {
    const base = { bodyFatPct: null, dailyLife: "sitting" as const, training: noTraining };
    expect(calc(base, { fatPercent: 40 }).fat.grams).toBe(110); // 40 % of 2,490
    const low = calc(base, { goal: "cut", pace: "ambitious", fatPercent: 20 });
    // 20 % of 1,870 = 41.6 g, but 0.6 g/kg of 80 kg = 48 g
    expect(low.fat).toEqual({ grams: 50, chosenPercent: 20, floorApplied: true });
    expect(low.notes.join(" ")).toContain("Fat raised to 50 g");
    // out of range: clamped to 20–40
    expect(calc(base, { fatPercent: 60 }).fat.chosenPercent).toBe(40);
  });

  test("fibre at least 30 g, 14 g per 1,000 kcal above 2,140 kcal", () => {
    expect(calc({}, { goal: "cut" }).fiber.grams).toBe(35);
    const small = calc(
      {
        sex: "female",
        weightKg: 55,
        heightCm: 160,
        bodyFatPct: null,
        dailyLife: "sitting",
        training: noTraining,
      },
      { goal: "cut" },
    );
    expect(small.fiber.grams).toBe(30);
    expect(small.lines.fiber).toBe("at least 30 g (DGE)");
  });

  test("a warning (not a refusal) under 130 g carbs", () => {
    const r = calc(
      {
        sex: "female",
        weightKg: 50,
        heightCm: 155,
        birthYear: 1966,
        bodyFatPct: null,
        dailyLife: "sitting",
        training: noTraining,
      },
      { goal: "cut", pace: "ambitious", fatPercent: 40 },
    );
    expect(r.carbs).toEqual({ grams: 100, low: true });
    expect(r.notes.join(" ")).toContain("Carbs under 130 g");
  });

  test("everything rounds to 10 kcal and 5 g, and the energy still adds up within ±10", () => {
    let n = 0;
    for (const sex of ["female", "male"] as const)
      for (const weightKg of [48, 63.4, 81.7, 112])
        for (const bodyFatPct of [null, 14, 29])
          for (const dailyLife of DAILY_LIFE_KEYS)
            for (const sessionsPerWeek of [0, 4])
              for (const goal of GOAL_KINDS)
                for (const pace of PACES)
                  for (const protein of PROTEIN_PRESETS)
                    for (const fatPercent of [20, 30, 40]) {
                      const inputs = {
                        ...fixture,
                        sex,
                        weightKg,
                        bodyFatPct,
                        dailyLife,
                        heightCm: sex === "male" ? 182 : 166,
                        training: { ...fixture.training, sessionsPerWeek },
                      };
                      const r = calculateGoal(inputs, { goal, pace, protein, fatPercent });
                      if (!r.ok) continue;
                      n++;
                      const t = r.targets;
                      expect(t.energyKcal! % 10).toBe(0);
                      for (const g of [t.protein!, t.fat!, t.carbohydrate!, t.fiber!]) expect(g % 5).toBe(0);
                      expect(Math.abs(r.energyCheck - r.kcal.value)).toBeLessThanOrEqual(10);
                      expect(t.carbohydrate!).toBeGreaterThanOrEqual(0);
                      expect(r.kcal.value).toBeGreaterThanOrEqual(sex === "male" ? 1500 : 1200);
                      expect(4 * t.protein!).toBeLessThanOrEqual(0.35 * r.kcal.value + 1e-9);
                      expect(9 * t.fat!).toBeGreaterThanOrEqual(0.2 * r.kcal.value - 22.5); // a 5 g step
                      if (goal === "cut")
                        expect(-r.pace.delta).toBeLessThanOrEqual(0.25 * r.maintenance.kcal);
                      if (goal === "bulk")
                        expect(r.pace.delta).toBeLessThanOrEqual(0.15 * r.maintenance.kcal);
                    }
    expect(n).toBeGreaterThan(5000);
  });

  test("every option of the flow is a valid input", () => {
    for (const type of TRAINING_TYPES)
      for (const intensity of INTENSITIES)
        for (const minutes of DURATIONS)
          expect(calc({ training: { sessionsPerWeek: 7, minutes, type, intensity } }).ok).toBe(true);
    expect(FAT_PERCENT.default).toBe(30);
  });
});

describe("defaults", () => {
  test("protein by training, goal and age; pace standard; fat 30 %", () => {
    expect(defaultChoices(fixture, "cut")).toEqual({
      goal: "cut",
      pace: "standard",
      protein: "high",
      fatPercent: 30,
    });
    expect(defaultChoices(fixture, "maintain").protein).toBe("moderate");
    expect(defaultChoices(fixture, "bulk").protein).toBe("moderate");
    const idle = { ...fixture, training: noTraining };
    expect(defaultChoices(idle, "cut").protein).toBe("basic");
    expect(defaultChoices({ ...idle, birthYear: 1961 }, "maintain").protein).toBe("moderate"); // 65
    expect(defaultChoices({ ...idle, birthYear: 1962 }, "maintain").protein).toBe("basic"); // 64
  });
});

describe("refusals", () => {
  const refused = (inputs: Partial<GoalInputs>, goal: GoalChoices["goal"] = "maintain") => {
    const r = calculateGoal({ ...fixture, ...inputs }, defaultChoices(fixture, goal));
    return r.ok ? null : r.reason;
  };

  test("under 18, pregnancy or breastfeeding, and a cut when underweight", () => {
    expect(refused({ birthYear: 2009 })).toBe("under_18");
    expect(refused({ birthYear: 2008 })).toBeNull();
    expect(refused({ sex: "female", pregnantOrBreastfeeding: true })).toBe("pregnancy");
    // BMI 17.9: no cut, but maintain and bulk are fine
    expect(refused({ weightKg: 58 }, "cut")).toBe("underweight_cut");
    expect(refused({ weightKg: 58 }, "bulk")).toBeNull();
    const r = calculateGoal({ ...fixture, birthYear: 2010 }, defaultChoices(fixture, "maintain"));
    expect(r).toMatchObject({ ok: false, version: ALGORITHM_VERSION });
    expect(r.ok ? "" : r.message).toContain("under 18");
  });
});

describe("weight from the log", () => {
  const now = Date.parse("2026-11-03T08:00:00Z");
  const day = 86_400_000;
  test("the mean of the last 7 days with at least 4 entries, else the newest", () => {
    expect(goalWeight([], now)).toBeNull();
    const four = [80, 81, 79.5, 80.3].map((kg, i) => ({ kg, measuredAt: now - i * day }));
    expect(goalWeight(four, now)).toEqual({ kg: 80.2, basis: "average", count: 4, measuredAt: now });
    const three = four.slice(1);
    expect(goalWeight(three, now)).toEqual({ kg: 81, basis: "latest", count: 1, measuredAt: now - day });
    // older than a week doesn't count towards the four; future entries never count
    const old = [...three, { kg: 90, measuredAt: now - 8 * day }, { kg: 70, measuredAt: now + day }];
    expect(goalWeight(old, now)?.basis).toBe("latest");
    expect(goalWeight([{ kg: 82, measuredAt: now - 60 * day }], now)?.kg).toBe(82);
  });
});

test("a guided goal's label", () => {
  expect(guidedLabel({ choices: defaultChoices(fixture, "cut") })).toBe("Guided · cut, standard pace");
  expect(guidedLabel({ choices: defaultChoices(fixture, "maintain") })).toBe("Guided · maintain");
});
