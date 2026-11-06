import { describe, expect, test } from "bun:test";
import { computeTotals, type Nutrients, portionItems, scaleGrams } from "../src/index.ts";

// The totals the server saves and the web app previews ("Ate it", #40) are the same code.

const per100g = (energyKcal: number, protein: number): Nutrients => ({
  energyKcal,
  protein,
  fat: null,
  saturatedFat: null,
  carbohydrate: null,
  sugars: null,
  fiber: null,
  salt: null,
});

describe("portionItems", () => {
  const items = [
    { id: "a", grams: 500, per100g: per100g(40, 1.7), provenance: "database" as const },
    { id: "b", grams: 100, per100g: per100g(260, 17), provenance: "database" as const },
    { id: "c", grams: 333, per100g: per100g(120, 7), provenance: "estimate" as const },
  ];

  test("grams ÷ servings × the factor, to 0.01 g, the excluded ones left out", () => {
    const one = portionItems({ servings: 3 }, items, 1);
    expect(one.map((i) => i.grams)).toEqual([166.67, 33.33, 111]);
    const more = portionItems({ servings: 3 }, items, 1.5, new Set(["b"]));
    expect(more.map((i) => [i.id, i.grams])).toEqual([
      ["a", 250],
      ["c", 166.5],
    ]);
    expect(scaleGrams(0.001, 1)).toBe(0.01);
  });

  test("totals over a portion are computeTotals over the scaled items", () => {
    const t = computeTotals(portionItems({ servings: 2 }, items, 1, new Set(["c"])));
    // 250 g × 40 + 50 g × 260 per 100 g
    expect(t.nutrients.energyKcal).toBe(230);
    expect(t.nutrients.protein).toBe(12.8);
    expect(t.missing.fat).toBe(2);
    expect(t.items).toBe(2);
  });
});
