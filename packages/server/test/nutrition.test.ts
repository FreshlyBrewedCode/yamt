import { describe, expect, test } from "bun:test";
import type { Nutrients } from "@yamt/shared";
import { dayRange, isoLocal, localDate } from "../src/domain/time.ts";
import { FdcClient } from "../src/nutrition/fdc.ts";
import { getText, RateLimiter, USER_AGENT } from "../src/nutrition/http.ts";
import { emptyNutrients, mapFdcFood, mapOffProduct } from "../src/nutrition/nutrients.ts";
import { OFF_URLS, OffClient } from "../src/nutrition/off.ts";
import { rankCandidates, scoreCandidate, words } from "../src/nutrition/ranking.ts";
import { computeTotals, itemNutrients } from "../src/nutrition/totals.ts";
import { fixtureFetch, readFixture } from "./nutrition-fixtures.ts";

const n = (v: Partial<Nutrients>): Nutrients => ({ ...emptyNutrients(), ...v });
const json = (name: string) => JSON.parse(readFixture(name)) as Record<string, unknown>;

describe("computeTotals", () => {
  const oats = n({ energyKcal: 373, protein: 13.2, fat: 6.7, carbohydrate: 59.5, fiber: 9.7, salt: 0.01 });
  const skyr = n({ energyKcal: 64, protein: 11, fat: 0.2, carbohydrate: 4, fiber: 0, salt: 0.08 });
  const oil = n({ energyKcal: 884, fat: 100 });

  test("per-100 g × grams, summed, rounded once at the end", () => {
    const t = computeTotals([
      { grams: 60, per100g: oats, provenance: "weighed" },
      { grams: 150, per100g: skyr, provenance: "database" },
    ]);
    // 223.8 + 96 kcal, 7.92 + 16.5 g protein
    expect(t.nutrients.energyKcal).toBe(320);
    expect(t.nutrients.protein).toBe(24.4);
    expect(t.nutrients.fiber).toBe(5.8);
    expect(t.nutrients.salt).toBe(0.13);
    expect(t.grams).toBe(210);
    expect(t.items).toBe(2);
  });

  test("breaks the totals down by provenance", () => {
    const t = computeTotals([
      { grams: 60, per100g: oats, provenance: "weighed" },
      { grams: 150, per100g: skyr, provenance: "database" },
      { grams: 13.5, per100g: oil, provenance: "estimate" },
    ]);
    expect(t.byProvenance.weighed.nutrients.energyKcal).toBe(224);
    expect(t.byProvenance.database.nutrients.energyKcal).toBe(96);
    expect(t.byProvenance.estimate).toMatchObject({ grams: 13.5, items: 1 });
    expect(t.byProvenance.estimate.nutrients.energyKcal).toBe(119);
    expect(t.byProvenance.label).toMatchObject({ grams: 0, items: 0 });
    expect(t.nutrients.energyKcal).toBe(439);
  });

  test("a missing value counts as 0 and is reported", () => {
    const t = computeTotals([
      { grams: 100, per100g: oats, provenance: "database" },
      { grams: 10, per100g: oil, provenance: "estimate" },
    ]);
    expect(t.missing).toMatchObject({ protein: 1, sugars: 2, saturatedFat: 2, energyKcal: 0, fat: 0 });
    expect(t.nutrients.protein).toBe(13.2);
  });

  test("no items: zeros; deterministic for the same items", () => {
    expect(computeTotals([]).nutrients.energyKcal).toBe(0);
    const items = [{ grams: 33.3, per100g: oats, provenance: "estimate" as const }];
    expect(computeTotals(items)).toEqual(computeTotals(items));
  });

  test("an item's share keeps null for unknown values", () => {
    expect(itemNutrients({ grams: 13.5, per100g: oil })).toMatchObject({
      energyKcal: 119,
      fat: 13.5,
      protein: null,
    });
  });
});

describe("Open Food Facts mapping", () => {
  test("a v2 product: core set, full profile, serving portion, raw kept", async () => {
    const off = new OffClient(fixtureFetch());
    const p = (await off.product("4337185761638"))!;
    expect(p).toMatchObject({ name: "Skyr natur", brand: "K-Classic", barcode: "4337185761638" });
    expect(p.per100g).toEqual({
      energyKcal: 64,
      protein: 11,
      fat: 0.2,
      saturatedFat: 0.1,
      carbohydrate: 4,
      sugars: 4,
      fiber: 0,
      salt: 0.08,
    });
    expect(p.nutrients["energy-kj"]).toEqual({ value: 270, unit: "kJ" });
    expect(p.nutrients.sodium).toEqual({ value: 0.032, unit: "g" });
    expect(p.portions).toEqual([{ label: "100g", grams: 100 }]);
    expect((p.raw as { code: string }).code).toBe("4337185761638");
  });

  test("an unknown barcode is null (OFF answers status 0)", async () => {
    expect(await new OffClient(fixtureFetch()).product("0000000000000")).toBeNull();
  });

  test("search-a-licious hits: brands as a list, German name first", async () => {
    const hits = await new OffClient(fixtureFetch()).search("skyr", 5);
    expect(hits).toHaveLength(5);
    expect(hits[0]).toMatchObject({ name: "Skyr Mocca", brand: "Skyr", barcode: "5690845001987" });
    expect(hits[0]?.per100g.energyKcal).toBe(79);
  });

  test("falls back to the classic search when search-a-licious fails", async () => {
    const f = fixtureFetch();
    f.fail.set(OFF_URLS.search("quark", 3), 503);
    f.pages.set(OFF_URLS.legacySearch("quark", 3), {
      type: "application/json",
      body: JSON.stringify({
        products: [
          { code: "4000000000017", product_name: "Magerquark", brands: "Example, Other", nutriments: {} },
        ],
      }),
    });
    const hits = await new OffClient(f).search("quark", 3);
    expect(hits).toMatchObject([{ name: "Magerquark", brand: "Example", barcode: "4000000000017" }]);
  });

  test("energy from kJ and salt from sodium when the core keys are missing", () => {
    const p = mapOffProduct({
      code: "1",
      product_name: "Test",
      brands: " Brand , Other",
      nutriments: { "energy-kj_100g": 418.4, sodium_100g: 0.4, proteins_100g: "3,5" },
      serving_quantity: "30",
      serving_size: "2 Scheiben (30 g)",
    });
    expect(p.per100g).toMatchObject({ energyKcal: 100, salt: 1, protein: 3.5, fat: null });
    expect(p.brand).toBe("Brand");
    expect(p.portions).toEqual([{ label: "2 Scheiben (30 g)", grams: 30 }]);
  });

  test("EU carbohydrates are taken as they are; a US total (carbohydrates-total) loses its fiber", () => {
    const eu = mapOffProduct({ code: "2", nutriments: { carbohydrates_100g: 59.5, fiber_100g: 9.7 } });
    expect(eu.per100g).toMatchObject({ carbohydrate: 59.5, fiber: 9.7 });
    const us = mapOffProduct({ code: "3", nutriments: { "carbohydrates-total_100g": 70, fiber_100g: 10 } });
    expect(us.per100g).toMatchObject({ carbohydrate: 60, fiber: 10 });
    expect(us.nutrients["carbohydrates-total"]).toEqual({ value: 70, unit: "g" });
    const noFiber = mapOffProduct({ code: "4", nutriments: { "carbohydrates-total_100g": 12 } });
    expect(noFiber.per100g).toMatchObject({ carbohydrate: 12, fiber: null });
  });
});

describe("FoodData Central mapping", () => {
  test("SR Legacy details: core set from nutrient ids, sodium mg → salt g, portions", () => {
    const f = mapFdcFood(json("fdc-food-171413.json"));
    expect(f.name).toBe("Oil, olive, salad or cooking");
    expect(f.per100g.energyKcal).toBe(884);
    expect(f.per100g.fat).toBe(100);
    expect(f.per100g.saturatedFat).toBeCloseTo(13.8, 1);
    expect(f.per100g.salt).toBe(0.005);
    expect(f.portions).toContainEqual({ label: "1 tablespoon", grams: 13.5 });
    expect(f.nutrients["Energy (kcal)"]).toEqual({ value: 884, unit: "kcal" });
  });

  test("search hits: Foundation foods fall back to Atwater energy (2047) and sugars 1063", () => {
    const foods = (json("fdc-search-oats.json").foods as Record<string, unknown>[]).map(mapFdcFood);
    const puffed = foods.find((f) => f.name === "Oats, puffed")!;
    expect(puffed.per100g).toMatchObject({ energyKcal: 402, protein: 14.6, sugars: 1.2, fat: 6.85, salt: 0 });
    const raw = foods.find((f) => f.name === "Oats, raw")!;
    expect(raw.per100g).toMatchObject({ energyKcal: 379, fiber: 10.1, salt: 0.015 });
    expect(raw.portions.length).toBeGreaterThan(0);
  });

  test("carbohydrate is available carbohydrate: fiber comes off FDC's total, the profile keeps it", () => {
    const foods = (json("fdc-search-oats.json").foods as Record<string, unknown>[]).map(mapFdcFood);
    // by difference (1005) 67.7 includes fiber (1079) 10.1
    const raw = foods.find((f) => f.name === "Oats, raw")!;
    expect(raw.per100g).toMatchObject({ carbohydrate: 57.6, fiber: 10.1 });
    expect(raw.nutrients["Carbohydrate, by difference"]).toEqual({ value: 67.7, unit: "g" });
    const puffed = foods.find((f) => f.name === "Oats, puffed")!;
    expect(puffed.per100g).toMatchObject({ carbohydrate: 61.81, fiber: 8.79 });
    // by summation (1050) is sugars + starch + fiber, so the same applies; never below 0
    const summed = mapFdcFood({
      fdcId: 2,
      description: "Summed",
      foodNutrients: [
        { nutrientId: 1050, nutrientName: "Carbohydrate, by summation", value: 3.8, unitName: "G" },
        { nutrientId: 1079, nutrientName: "Fiber, total dietary", value: 2.4, unitName: "G" },
      ],
    });
    expect(summed.per100g).toMatchObject({ carbohydrate: 1.4, fiber: 2.4 });
    const over = mapFdcFood({
      fdcId: 3,
      description: "Over",
      foodNutrients: [
        { nutrientId: 1005, nutrientName: "Carbohydrate, by difference", value: 1, unitName: "G" },
        { nutrientId: 1079, nutrientName: "Fiber, total dietary", value: 1.5, unitName: "G" },
      ],
    });
    expect(over.per100g.carbohydrate).toBe(0);
  });

  test("without a fiber value FDC's carbohydrate stays as reported and fiber null", () => {
    const f = mapFdcFood({
      fdcId: 4,
      description: "Milk, no fiber analysed",
      foodNutrients: [
        { nutrientId: 1005, nutrientName: "Carbohydrate, by difference", value: 4.8, unitName: "G" },
      ],
    });
    expect(f.per100g).toMatchObject({ carbohydrate: 4.8, fiber: null });
  });

  test("abridged details are keyed by nutrient number; Total fat (NLEA) and kJ as fallbacks", () => {
    const f = mapFdcFood({
      fdcId: 1,
      description: "Abridged",
      foodNutrients: [
        { number: "268", name: "Energy", amount: 1000, unitName: "kJ" },
        { number: "298", name: "Total fat (NLEA)", amount: 93.7, unitName: "G" },
        { number: "307", name: "Sodium, Na", amount: 400, unitName: "MG" },
      ],
    });
    expect(f.per100g).toMatchObject({ energyKcal: 239, fat: 93.7, salt: 1 });
  });

  test("without a key the client is unavailable and never calls out", async () => {
    const f = fixtureFetch();
    const fdc = new FdcClient(f, null);
    expect(fdc.available).toBe(false);
    await expect(fdc.search("oats", 5)).rejects.toThrow("FDC_API_KEY");
    expect(f.calls).toEqual([]);
  });
});

describe("ranking", () => {
  const base = {
    brand: null,
    per100g: n({ energyKcal: 100, protein: 1, fat: 1, carbohydrate: 1 }),
    sourceRank: 0,
  };

  test("folds umlauts and ß", () => {
    expect(words("Käse-Spätzle, Weißbrot")).toEqual(["kase", "spatzle", "weissbrot"]);
  });

  test("history beats Open Food Facts beats FDC at equal match", () => {
    const ranked = rankCandidates("skyr", [
      { ...base, origin: "fdc" as const, name: "Skyr" },
      { ...base, origin: "off" as const, name: "Skyr" },
      { ...base, origin: "history" as const, name: "Skyr", meals: 1 },
    ]);
    expect(ranked.map((c) => c.origin)).toEqual(["history", "off", "fdc"]);
  });

  test("a full match beats a partial one from a better source", () => {
    const ranked = rankCandidates("skyr natur", [
      { ...base, origin: "history" as const, name: "Naturjoghurt", meals: 1 },
      { ...base, origin: "off" as const, name: "Skyr natur" },
    ]);
    expect(ranked[0]?.name).toBe("Skyr natur");
  });

  test("prefix matches count, short generic names win, missing energy sinks", () => {
    expect(scoreCandidate("hafer", { ...base, origin: "off", name: "Haferflocken" })).toBeGreaterThan(
      scoreCandidate("hafer", { ...base, origin: "off", name: "Dinkelflocken" }),
    );
    expect(scoreCandidate("skyr", { ...base, origin: "off", name: "Skyr" })).toBeGreaterThan(
      scoreCandidate("skyr", { ...base, origin: "off", name: "Skyr Himbeer Cranberry" }),
    );
    const noEnergy = { ...base, per100g: n({}), origin: "history" as const, name: "Skyr", meals: 3 };
    expect(scoreCandidate("skyr", noEnergy)).toBeLessThan(
      scoreCandidate("skyr", { ...base, origin: "fdc", name: "Skyr" }),
    );
  });

  test("ties keep the sources' own order", () => {
    const ranked = rankCandidates("x", [
      { ...base, origin: "off" as const, name: "x a", sourceRank: 0 },
      { ...base, origin: "off" as const, name: "x b", sourceRank: 0 },
    ]);
    expect(ranked.map((c) => c.name)).toEqual(["x a", "x b"]);
  });
});

describe("outbound HTTP", () => {
  test("the rate limiter lets a burst through, then spaces calls", async () => {
    let now = 0;
    const slept: number[] = [];
    const limiter = new RateLimiter(
      2,
      1000,
      () => now,
      async (ms) => {
        slept.push(ms);
        now += ms;
      },
    );
    await limiter.take();
    await limiter.take();
    expect(slept).toEqual([]);
    await limiter.take();
    expect(slept).toEqual([1000]);
    now += 500;
    await limiter.take();
    expect(slept).toEqual([1000, 500]);
  });

  test("sends the yamt User-Agent", async () => {
    let ua = "";
    await getText(
      async (_url, init) => {
        ua = new Headers(init?.headers).get("user-agent") ?? "";
        return new Response("ok");
      },
      "https://example.com/",
      { timeoutMs: 1000, maxBytes: 100 },
    );
    expect(ua).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^yamt\/\d+\.\d+\.\d+ \(https:\/\/github\.com\/FreshlyBrewedCode\/yamt\)$/);
  });

  test("refuses bodies over the cap, declared or streamed", async () => {
    const big = "x".repeat(200);
    const opts = { timeoutMs: 1000, maxBytes: 100 };
    await expect(getText(async () => new Response(big), "https://example.com/", opts)).rejects.toThrow(
      "larger",
    );
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    await expect(getText(async () => new Response(stream), "https://example.com/", opts)).rejects.toThrow(
      "larger",
    );
  });

  test("times out", async () => {
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    await expect(getText(hang, "https://example.com/", { timeoutMs: 50, maxBytes: 100 })).rejects.toThrow(
      "no answer within",
    );
  });

  test("HTTP errors carry the status; API keys never appear in messages", async () => {
    const err = await getText(async () => new Response("nope", { status: 404 }), "https://example.com/", {
      timeoutMs: 1000,
      maxBytes: 100,
    }).catch((e) => e);
    expect(err.status).toBe(404);
    const net: unknown = await getText(
      async (url) => {
        throw new Error(`could not connect to ${url}`);
      },
      "https://example.com/?api_key=SECRET&x=1",
      { timeoutMs: 1000, maxBytes: 100 },
    ).catch((e) => e);
    expect((net as Error).message).toContain("api_key=…");
    expect((net as Error).message).not.toContain("SECRET");
  });
});

describe("days and local times", () => {
  test("a day in Berlin, including the DST change", () => {
    const winter = dayRange("2026-11-02", "Europe/Berlin");
    expect(new Date(winter.from).toISOString()).toBe("2026-11-01T23:00:00.000Z");
    expect(winter.to - winter.from).toBe(24 * 3_600_000);
    const fallBack = dayRange("2026-10-25", "Europe/Berlin");
    expect(new Date(fallBack.from).toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(fallBack.to - fallBack.from).toBe(25 * 3_600_000);
    expect(() => dayRange("2026-13", "Europe/Berlin")).toThrow("YYYY-MM-DD");
  });

  test("ISO with offset and the local date", () => {
    const ms = Date.parse("2026-11-02T11:30:00Z");
    expect(isoLocal(ms, "Europe/Berlin")).toBe("2026-11-02T12:30:00+01:00");
    expect(isoLocal(ms, "UTC")).toBe("2026-11-02T11:30:00+00:00");
    expect(localDate(Date.parse("2026-11-02T23:30:00Z"), "Europe/Berlin")).toBe("2026-11-03");
  });
});
