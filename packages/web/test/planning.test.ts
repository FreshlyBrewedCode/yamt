import { describe, expect, test } from "bun:test";
import type { NutrientTotals, PlanDay, PlanGoal, PlannedMealView, RecipeItemView } from "@yamt/shared";
import { dateStart } from "../src/lib/format";
import {
  ateItTotals,
  canEat,
  dayMeta,
  defaultEatenAt,
  gramsFor,
  openBefore,
  readDay,
  slotTaken,
  sourceLabel,
  withPlanned,
  withValue,
} from "../src/lib/planning";

// The plan's reading on the phone (#40), with made-up recipes and days.

const totals = (energyKcal: number, protein = 0): NutrientTotals => ({
  grams: 0,
  items: 1,
  nutrients: {
    energyKcal,
    protein,
    fat: 0,
    saturatedFat: 0,
    carbohydrate: 0,
    sugars: 0,
    fiber: 0,
    salt: 0,
  },
});

const cut: PlanGoal = {
  id: "g",
  effectiveFrom: "2026-01-01",
  targets: { energyKcal: 2000, protein: 160, fat: null, carbohydrate: null, fiber: null },
  kind: "cut",
  label: "Cut, standard pace",
  floorKcal: 1500,
};

const planned = (more: Partial<PlannedMealView> = {}): PlannedMealView => ({
  id: "p1",
  date: "2026-11-04",
  slot: "dinner",
  position: 0,
  recipeId: "r1",
  title: "Kürbis-Curry",
  portionsCooked: 2,
  portionEaten: 1,
  status: "planned",
  loggedMealId: null,
  leftoverOf: null,
  suggestionId: null,
  note: null,
  createdAt: 0,
  updatedAt: 0,
  perPortion: totals(450, 30),
  eaten: totals(450, 30),
  ...more,
});

const day = (more: Partial<PlanDay> = {}): PlanDay => ({
  date: "2026-11-04",
  plannedMeals: [],
  meals: [],
  unanalysed: 0,
  eaten: null,
  projected: null,
  goal: cut,
  openSlots: ["breakfast", "lunch", "dinner"],
  mostlyKnown: false,
  ...more,
});

describe("readDay", () => {
  test("nothing planned, rest open until mostly known, then the calendar's reading", () => {
    expect(readDay(day())).toMatchObject({ kcal: null, words: "nothing planned", look: "empty" });
    expect(readDay(day({ projected: totals(900) }))).toMatchObject({
      kcal: 900,
      words: "rest open",
      look: "open",
    });
    // 1,800 of 2,000 on a cut: on plan, 10 % under
    expect(readDay(day({ projected: totals(1800), mostlyKnown: true }))).toMatchObject({
      words: "on plan, under",
      look: "plan",
      c: { band: "on", direction: "under" },
    });
    expect(readDay(day({ projected: totals(2600), mostlyKnown: true }))).toMatchObject({
      words: "far off, over",
    });
    expect(readDay(day({ projected: totals(1800), mostlyKnown: true, goal: null }))).toMatchObject({
      words: "no goal",
      look: "kcal",
    });
  });

  test("the strip's meta and the totals slab's note count only what is still planned", () => {
    const d = day({
      plannedMeals: [
        planned(),
        planned({ id: "p2", status: "skipped" }),
        planned({ id: "p3", status: "logged" }),
      ],
      meals: [
        {
          mealId: "m",
          title: "Müsli",
          eatenAt: 0,
          slot: "breakfast",
          totals: totals(400),
          plannedMealId: null,
        },
      ],
      projected: totals(1700),
    });
    expect(dayMeta(d)).toBe("1 planned · 1 eaten · rest open");
    expect(dayMeta(day())).toBe("");
    expect(withPlanned(d)).toEqual({ planned: 1, kcal: 1700, target: 2000, left: 300 });
    expect(withPlanned(day({ projected: totals(400) }))).toBeNull();
    expect(withPlanned({ ...d, goal: null, projected: totals(2100) })).toMatchObject({
      target: null,
      left: null,
    });
  });
});

describe("openBefore", () => {
  test("the day without this meal: planned ones count in the projection, logged ones through their meal", () => {
    const p = planned();
    const d = day({ plannedMeals: [p], projected: totals(1450, 90) });
    const { base, open } = openBefore(d, p);
    expect(base.energyKcal).toBe(1000);
    expect(open.energyKcal).toBe(1000);
    expect(open.protein).toBe(100);
    // no fat target: nothing open to compare with
    expect(open.fat).toBeNull();

    const logged = planned({ status: "logged", loggedMealId: "m1" });
    const after = day({
      plannedMeals: [logged],
      meals: [
        {
          mealId: "m1",
          title: "Kürbis-Curry",
          eatenAt: 0,
          slot: "dinner",
          totals: totals(400),
          plannedMealId: "p1",
        },
      ],
      projected: totals(1400),
    });
    expect(openBefore(after, logged).base.energyKcal).toBe(1000);

    const skipped = planned({ status: "skipped" });
    expect(openBefore(day({ projected: totals(1000) }), skipped).base.energyKcal).toBe(1000);
    expect(openBefore(day({ goal: null }), p).open.energyKcal).toBeNull();
  });
});

describe("ate it", () => {
  const item = (id: string, grams: number, kcal: number): RecipeItemView => ({
    id,
    recipeId: "r1",
    position: 0,
    foodId: null,
    description: id,
    grams,
    provenance: "estimate",
    confidence: "medium",
    note: null,
    optional: false,
    per100g: {
      energyKcal: kcal,
      protein: 1,
      fat: null,
      saturatedFat: null,
      carbohydrate: null,
      sugars: null,
      fiber: null,
      salt: null,
    },
    food: null,
    nutrients: {
      energyKcal: null,
      protein: null,
      fat: null,
      saturatedFat: null,
      carbohydrate: null,
      sugars: null,
      fiber: null,
      salt: null,
    },
    portionGrams: grams / 2,
    portionNutrients: {
      energyKcal: null,
      protein: null,
      fat: null,
      saturatedFat: null,
      carbohydrate: null,
      sugars: null,
      fiber: null,
      salt: null,
    },
  });
  const items = [item("Hokkaido", 500, 40), item("Feta", 100, 260)];

  test("the portion of the items still switched on, with the shared totals", () => {
    // 1.5 of 2 portions: 375 g Hokkaido (150 kcal) + 75 g Feta (195 kcal)
    expect(ateItTotals({ servings: 2 }, items, 1.5, new Set()).nutrients.energyKcal).toBe(345);
    expect(ateItTotals({ servings: 2 }, items, 1.5, new Set(["Feta"])).nutrients.energyKcal).toBe(150);
    expect(gramsFor({ servings: 2 }, items[0]!, 3)).toBe(750);
    expect(gramsFor({ servings: 3 }, items[1]!, 1)).toBe(33.33);
  });

  test("offered for today and earlier, never ahead; an earlier day starts at the slot's hour", () => {
    expect(canEat(planned(), "2026-11-04")).toBe(true);
    expect(canEat(planned(), "2026-11-05")).toBe(true);
    expect(canEat(planned(), "2026-11-03")).toBe(false);
    expect(canEat(planned({ status: "logged" }), "2026-11-04")).toBe(false);
    const now = dateStart("2026-11-04") + 13 * 3_600_000;
    expect(defaultEatenAt("2026-11-04", "dinner", now)).toBe(now);
    expect(defaultEatenAt("2026-11-03", "dinner", now)).toBe(dateStart("2026-11-03") + 19 * 3_600_000);
  });
});

describe("plan for", () => {
  test("a slot already holding a planned or eaten meal is named; skipped ones and itself are not", () => {
    const d = day({
      plannedMeals: [
        planned(),
        planned({ id: "p2", title: "Shakshuka" }),
        planned({ id: "p3", title: "Suppe", status: "skipped" }),
      ],
      meals: [{ mealId: "m", title: null, eatenAt: 0, slot: "dinner", totals: null, plannedMealId: null }],
    });
    expect(slotTaken(d, "dinner", "p1")).toEqual(["Shakshuka", "a meal not analysed yet"]);
    expect(slotTaken(d, "lunch", "p1")).toEqual([]);
    expect(slotTaken(undefined, "dinner", "p1")).toEqual([]);
  });

  test("source labels and portion presets", () => {
    const base = { sourceUrl: "https://www.chefkoch.de/rezepte/1/x.html", sourceName: null, changes: [] };
    expect(sourceLabel({ ...base, sourceMode: "published" })).toBe("From chefkoch.de");
    expect(sourceLabel({ ...base, sourceMode: "adapted", changes: ["a", "b", "c"] })).toBe(
      "Adapted from chefkoch.de · 3 changes",
    );
    expect(sourceLabel({ ...base, sourceMode: "composed", sourceUrl: null })).toBe("Composed for you");
    expect(withValue([1, 2, 3, 4], 6)).toEqual([1, 2, 3, 4, 6]);
    expect(withValue([0.5, 1, 1.5, 2], 0.75)).toEqual([0.5, 0.75, 1, 1.5, 2]);
  });
});
