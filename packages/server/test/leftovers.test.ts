import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type ApiError,
  addDays,
  type LeftoverResponse,
  type LeftoversResponse,
  type LogPlannedMealResponse,
  leftoverPaths,
  mealPaths,
  type PlannedMealResponse,
  type PlanResponse,
  planningPaths,
  type ShoppingListResponse,
  shoppingPaths,
} from "@yamt/shared";
import { IDENTITY_HEADER } from "../src/auth/identity.ts";
import { leftoverOffers } from "../src/domain/leftovers.ts";
import { ingredientName, lineKey } from "../src/domain/shopping.ts";
import { localDate } from "../src/domain/time.ts";
import { aisleByCategories, aisleByKeyword, aisleOf } from "../src/nutrition/aisles.ts";
import { type AppServer, createServer } from "../src/server.ts";
import { tempDir } from "./helpers.ts";

// Leftovers and the shopping list (#49). Made-up foods and recipes; each describe gets a server of
// its own (plans and leftovers apply across tests).

const TZ = "Europe/Berlin";
const servers: AppServer[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => s.stop()));
});

function setup() {
  const app = createServer({
    dataDir: join(tempDir(), "data"),
    port: 0,
    webDist: null,
    auth: { kind: "tailnet", login: "alice@example.com" },
    timeZone: TZ,
  });
  servers.push(app);
  const s = app.services;
  async function call<T>(method: string, path: string, body?: unknown) {
    const res = await fetch(new URL(path, app.localUrl), {
      method,
      headers: {
        [IDENTITY_HEADER]: "alice@example.com",
        origin: new URL(app.localUrl).origin,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T & ApiError };
  }
  const food = (name: string, energyKcal: number) =>
    s.foods.create({ source: "custom", name, per100g: { energyKcal, protein: 2, fat: 1, carbohydrate: 5 } })
      .id;
  const foods = {
    hokkaido: food("Hokkaido", 40),
    onion: food("Zwiebel", 40),
    coconut: food("Kokosmilch light", 75),
    feta: food("Feta", 260),
    eggs: food("Eier", 140),
  };
  const item = (foodId: string, description: string, grams: number) => ({
    foodId,
    description,
    grams,
    provenance: "database" as const,
    confidence: "high" as const,
  });
  /** Kürbis-Curry for 2: 500 g Hokkaido, 100 g onion, 400 g coconut milk, 240 g chickpeas (estimate). */
  const curry = () =>
    s.recipes.save({
      title: "Kürbis-Curry",
      summary: "",
      sourceMode: "composed",
      servings: 2,
      timeTotalMin: 40,
      steps: ["Kochen."],
      items: [
        item(foods.hokkaido, "½ Hokkaido (ca. 500 g)", 500),
        item(foods.onion, "1 Zwiebel", 100),
        item(foods.coconut, "1 Dose Kokosmilch light (400 ml)", 400),
        {
          estimatePer100g: { energyKcal: 120, protein: 7, fat: 2.5, carbohydrate: 16 },
          description: "1 Dose Kichererbsen, abgetropft",
          grams: 240,
          provenance: "estimate",
          confidence: "medium",
        },
      ],
    }).recipe;
  /** Shakshuka for 1: 300 g Hokkaido, 120 g eggs, 100 g feta. */
  const shakshuka = () =>
    s.recipes.save({
      title: "Kürbis-Shakshuka mit Feta",
      summary: "",
      sourceMode: "composed",
      servings: 1,
      timeTotalMin: 25,
      steps: ["Braten."],
      items: [
        item(foods.hokkaido, "300 g Hokkaido", 300),
        item(foods.eggs, "2 Eier", 120),
        item(foods.feta, "Feta", 100),
      ],
    }).recipe;
  const today = localDate(Date.now(), TZ);
  return { app, s, call, foods, curry, shakshuka, today };
}

describe("cooked leftovers", () => {
  const { s, call, curry, today } = setup();
  const tomorrow = addDays(today, 1);

  test("Ate it with cook 2, eat 1 keeps a portion; the plan offers it; Plan it; logging it uses it up", async () => {
    const recipe = curry();
    const { plannedMeal } = s.planning.create({
      recipeId: recipe.id,
      date: today,
      slot: "dinner",
      portionsCooked: 2,
    });
    const logged = await call<LogPlannedMealResponse>("POST", planningPaths.log(plannedMeal.id), {
      eatenAt: Date.now() - 60_000,
    });
    expect(logged.status).toBe(201);

    const list = await call<LeftoversResponse>("GET", leftoverPaths.leftovers);
    expect(list.body.leftovers).toHaveLength(1);
    const leftover = list.body.leftovers[0]!;
    expect(leftover).toMatchObject({
      source: "cooked",
      description: "Kürbis-Curry",
      portions: 1,
      available: 1,
      plannedMealId: plannedMeal.id,
      recipeId: recipe.id,
      cookedOn: today,
      status: "open",
      plannedFor: [],
    });
    expect(leftover.perPortion?.nutrients.energyKcal).toBe(
      logged.body.plannedMeal.perPortion.nutrients.energyKcal,
    );

    // offered for tomorrow's lunch, the day after it was cooked
    const plan = await call<PlanResponse>(
      "GET",
      `${planningPaths.plan}?from=${today}&to=${tomorrow}&tz=${TZ}`,
    );
    expect(plan.body.days.map((d) => d.leftoverOffers)).toEqual([
      [],
      [{ leftoverId: leftover.id, slot: "lunch" }],
    ]);
    expect(plan.body.leftovers.map((l) => l.id)).toEqual([leftover.id]);

    // Plan it: a planned meal of the recipe naming the one it was cooked with, nothing cooked
    const id = crypto.randomUUID();
    const planned = await call<PlannedMealResponse>("POST", leftoverPaths.plan(leftover.id), {
      id,
      date: tomorrow,
      slot: "lunch",
    });
    expect(planned.status).toBe(201);
    expect(planned.body.plannedMeal).toMatchObject({
      id,
      recipeId: recipe.id,
      date: tomorrow,
      slot: "lunch",
      portionsCooked: 0,
      portionEaten: 1,
      leftoverOf: plannedMeal.id,
      status: "planned",
    });
    // a retry answers it; nothing is left to plan; the offer is gone
    expect(
      (await call("POST", leftoverPaths.plan(leftover.id), { id, date: tomorrow, slot: "lunch" })).status,
    ).toBe(200);
    const again = await call("POST", leftoverPaths.plan(leftover.id), { date: tomorrow, slot: "dinner" });
    expect(again.status).toBe(409);
    expect(again.body.error).toContain("planned already");
    const after = s.planning.plan({ from: tomorrow, to: tomorrow, tz: TZ });
    expect(after.days[0]!.leftoverOffers).toEqual([]);
    expect(after.leftovers[0]).toMatchObject({
      available: 0,
      plannedFor: [{ plannedMealId: id, slot: "lunch" }],
    });
    // a leftover isn't cooked: its portions cooked can't change
    expect((await call("PATCH", planningPaths.plannedMeal(id), { portionsCooked: 2 })).status).toBe(400);
    expect((await call("PATCH", planningPaths.plannedMeal(id), { portionEaten: 1.5 })).status).toBe(400);

    // eaten (logged today, ahead of the plan): the leftover is used
    expect((await call("POST", planningPaths.log(id), { eatenAt: Date.now() })).status).toBe(201);
    expect(s.repos.leftovers.get(leftover.id)).toMatchObject({ status: "used", portions: 0 });
    expect((await call<LeftoversResponse>("GET", leftoverPaths.leftovers)).body.leftovers).toEqual([]);

    // removing the curry's own meal keeps a leftover something was eaten from; removing the meal
    // that ate it gives the portion back; a restore eats it again
    expect((await call("POST", mealPaths.remove(logged.body.meal.id))).status).toBe(200);
    expect(s.repos.leftovers.get(leftover.id)).toMatchObject({ status: "used", portions: 0 });
    const ate = s.repos.plannedMeals.get(id)!.loggedMealId!;
    expect((await call("POST", mealPaths.remove(ate))).status).toBe(200);
    expect(s.repos.leftovers.get(leftover.id)).toMatchObject({ status: "open", portions: 1 });
    expect((await call("POST", mealPaths.restore(ate))).status).toBe(200);
    expect(s.repos.leftovers.get(leftover.id)).toMatchObject({ status: "used", portions: 0 });
  });

  test("removing a meal logged from the plan takes its unused leftover back; a restore brings it back", async () => {
    const { plannedMeal } = s.planning.create({
      recipeId: curry().id,
      date: today,
      slot: "lunch",
      portionsCooked: 3,
    });
    const logged = s.planning.log(plannedMeal.id, {
      eatenAt: Date.now(),
      portionEaten: 1.5,
      excludeItemIds: [],
    });
    const own = s.repos.leftovers.ofPlannedMeal(plannedMeal.id)!;
    expect(own).toMatchObject({ portions: 1.5, status: "open" });
    s.meals.remove(logged.meal.id);
    expect(s.repos.leftovers.ofPlannedMeal(plannedMeal.id)).toBeNull();
    s.meals.restore(logged.meal.id);
    expect(s.repos.leftovers.ofPlannedMeal(plannedMeal.id)).toMatchObject({ portions: 1.5, status: "open" });
    // planned for a day, then that one unplanned: the portion is free again
    const leftover = s.repos.leftovers.ofPlannedMeal(plannedMeal.id)!;
    const { plannedMeal: p } = s.planning.planLeftover(leftover.id, { date: tomorrow, slot: "dinner" });
    expect(s.leftovers.get(leftover.id).available).toBe(0.5);
    s.planning.unplan(p.id);
    expect(s.leftovers.get(leftover.id).available).toBe(1.5);
  });

  test("the user's own leftovers: add (idempotent), used, gone and back", async () => {
    const id = crypto.randomUUID();
    const body = { id, description: "Koriander", quantity: "1 Bund", note: "Vom Markt" };
    const made = await call<LeftoverResponse>("POST", leftoverPaths.leftovers, body);
    expect(made.status).toBe(201);
    expect(made.body.leftover).toMatchObject({
      source: "user",
      description: "Koriander",
      quantity: "1 Bund",
    });
    expect((await call("POST", leftoverPaths.leftovers, body)).status).toBe(200);
    expect((await call("POST", leftoverPaths.leftovers, { ...body, description: "Minze" })).status).toBe(409);
    const gone = await call<LeftoverResponse>("PATCH", leftoverPaths.leftover(id), { status: "gone" });
    expect(gone.body.leftover).toMatchObject({ status: "gone", closedAt: expect.any(Number) });
    expect((await call("POST", leftoverPaths.plan(id), { date: today, slot: "lunch" })).status).toBe(409);
    const back = await call<LeftoverResponse>("PATCH", leftoverPaths.leftover(id), { status: "open" });
    expect(back.body.leftover).toMatchObject({ status: "open", closedAt: null });
    expect(
      (await call("PATCH", leftoverPaths.leftover(crypto.randomUUID()), { status: "used" })).status,
    ).toBe(404);
  });
});

describe("leftoverOffers", () => {
  const cooked = (id: string, cookedOn: string, available = 1) =>
    ({ id, source: "cooked", status: "open", cookedOn, available }) as Parameters<
      typeof leftoverOffers
    >[0][number];
  const days = [
    { date: "2026-11-10", openSlots: ["lunch", "dinner"] as const },
    { date: "2026-11-11", openSlots: ["dinner"] as const },
    { date: "2026-11-12", openSlots: ["lunch", "dinner"] as const },
  ].map((d) => ({ ...d, openSlots: [...d.openSlots] }));

  test("the first open lunch, else dinner, from the day after cooking (today at the earliest), one per slot", () => {
    const offers = leftoverOffers(
      [
        cooked("a", "2026-11-10"),
        cooked("b", "2026-11-10"),
        cooked("c", "2026-11-01"),
        cooked("d", "2026-11-10", 0),
      ],
      days,
      "2026-11-10",
    );
    expect(Object.fromEntries(offers)).toEqual({
      "2026-11-10": [{ leftoverId: "c", slot: "lunch" }],
      "2026-11-11": [{ leftoverId: "a", slot: "dinner" }],
      "2026-11-12": [{ leftoverId: "b", slot: "lunch" }],
    });
  });
});

describe("the shopping list", () => {
  const { s, call, foods, curry, shakshuka, today } = setup();
  const d1 = addDays(today, 1);
  const d2 = addDays(today, 2);
  const list = async (from = today, to = d2) =>
    (await call<ShoppingListResponse>("GET", `${shoppingPaths.list}?from=${from}&to=${to}&tz=${TZ}`)).body;
  const line = (l: ShoppingListResponse, key: string) => l.lines.find((x) => x.key === key);

  test("cooked amounts summed by food, leftovers at home subtracted, aisles, leftover meals need nothing", async () => {
    const c = curry();
    // cooked 4 of a recipe for 2: double the grams
    const curryMeal = s.planning.create({
      recipeId: c.id,
      date: d1,
      slot: "dinner",
      portionsCooked: 4,
    }).plannedMeal;
    s.planning.create({ recipeId: shakshuka().id, date: d2, slot: "dinner" });
    // a leftover planned meal needs nothing, nor does one logged, skipped, or outside the range
    s.repos.plannedMeals.insert({
      date: d2,
      slot: "lunch",
      recipeId: c.id,
      title: c.title,
      portionsCooked: 0,
      portionEaten: 1,
      note: null,
      leftoverOf: curryMeal.id,
    });
    const skipped = s.planning.create({ recipeId: c.id, date: d1, slot: "lunch" }).plannedMeal;
    s.planning.skip(skipped.id);
    s.planning.create({ recipeId: c.id, date: addDays(today, 5), slot: "lunch" });
    // at home: half a Hokkaido (by name), a feta without an amount (covers it)
    s.leftovers.note({ description: "Hokkaido", quantity: "½", grams: 500 }, null);
    s.leftovers.create({ description: "Feta" });

    const l = await list();
    expect(l).toMatchObject({ from: today, to: d2, meals: 2 });
    const hokkaido = line(l, `food:${foods.hokkaido}`)!;
    expect(hokkaido).toMatchObject({
      name: "Hokkaido",
      aisle: "produce",
      needed: 1300,
      grams: 800,
      covered: false,
      atHome: [{ description: "Hokkaido", quantity: "½", grams: 500 }],
    });
    expect(hokkaido.needs.map((n) => [n.title, n.grams])).toEqual([
      ["Kürbis-Curry", 1000],
      ["Kürbis-Shakshuka mit Feta", 300],
    ]);
    expect(line(l, `food:${foods.coconut}`)).toMatchObject({
      name: "Kokosmilch light",
      aisle: "pantry",
      grams: 800,
    });
    expect(line(l, "name:kichererbsen")).toMatchObject({ name: "Kichererbsen", aisle: "pantry", grams: 480 });
    expect(line(l, `food:${foods.feta}`)).toMatchObject({ aisle: "dairy_eggs", covered: true, grams: 0 });
    expect(line(l, `food:${foods.eggs}`)).toMatchObject({ name: "Eier", aisle: "dairy_eggs", grams: 120 });
    // by aisle, then grams; covered last within its aisle
    expect(l.lines.map((x) => x.name)).toEqual([
      "Hokkaido",
      "Zwiebel",
      "Eier",
      "Feta",
      "Kokosmilch light",
      "Kichererbsen",
    ]);
    expect(l).toMatchObject({ toBuy: 5, inBasket: 0 });
  });

  test("the default range runs from today to the last planned day", async () => {
    const l = (await call<ShoppingListResponse>("GET", `${shoppingPaths.list}?tz=${TZ}`)).body;
    expect(l).toMatchObject({ from: today, to: addDays(today, 5), lastPlannedDay: addDays(today, 5) });
    expect((await call("GET", `${shoppingPaths.list}?from=${d2}&to=${d1}`)).status).toBe(400);
  });

  test("checks persist across plan changes while the line needs no more; own lines", async () => {
    const onion = `food:${foods.onion}`;
    let l = (
      await call<ShoppingListResponse>("POST", shoppingPaths.check, {
        from: today,
        to: d2,
        key: onion,
        checked: true,
      })
    ).body;
    expect(line(l, onion)!.checked).toBe(true);
    expect(l.inBasket).toBe(1);
    // a narrower range that still overlaps keeps it; another plan change elsewhere too
    expect(line(await list(d1, d1), onion)!.checked).toBe(true);
    s.planning.create({ recipeId: shakshuka().id, date: d1, slot: "lunch" });
    expect(line(await list(), onion)!.checked).toBe(true);
    // a range that doesn't overlap the check's: not checked
    s.planning.create({ recipeId: curry().id, date: addDays(today, 6), slot: "dinner" });
    expect(line(await list(addDays(today, 6), addDays(today, 6)), onion)!.checked).toBe(false);
    // the plan needs more onion now: open again
    s.planning.create({ recipeId: curry().id, date: d2, slot: "lunch" });
    expect(line(await list(), onion)!.checked).toBe(false);
    // unchecking clears it; a key not on the list is a 409
    l = (
      await call<ShoppingListResponse>("POST", shoppingPaths.check, {
        from: today,
        to: d2,
        key: onion,
        checked: true,
      })
    ).body;
    expect(line(l, onion)!.checked).toBe(true);
    l = (
      await call<ShoppingListResponse>("POST", shoppingPaths.check, {
        from: today,
        to: d2,
        key: onion,
        checked: false,
      })
    ).body;
    expect(line(l, onion)!.checked).toBe(false);
    expect(
      (await call("POST", shoppingPaths.check, { from: today, to: d2, key: "name:mango", checked: true }))
        .status,
    ).toBe(409);

    // own lines: aisle by keyword, checked, removed; idempotent with an id
    const id = crypto.randomUUID();
    const added = await call<ShoppingListResponse>("POST", shoppingPaths.lines, {
      id,
      from: today,
      to: d2,
      text: "Limetten (2)",
    });
    expect(added.status).toBe(201);
    expect(line(added.body, `line:${id}`)).toMatchObject({
      name: "Limetten (2)",
      aisle: "produce",
      own: true,
      grams: null,
    });
    expect(
      (await call("POST", shoppingPaths.lines, { id, from: today, to: d2, text: "Limetten (2)" })).status,
    ).toBe(200);
    l = (
      await call<ShoppingListResponse>("POST", shoppingPaths.check, {
        from: today,
        to: d2,
        key: `line:${id}`,
        checked: true,
      })
    ).body;
    expect(line(l, `line:${id}`)!.checked).toBe(true);
    expect((await call("DELETE", shoppingPaths.line(id))).status).toBe(204);
    expect(line(await list(), `line:${id}`)).toBeUndefined();
    expect((await call("DELETE", shoppingPaths.line(id))).status).toBe(404);
  });
});

describe("ingredient names and aisles", () => {
  test("a description without its amount, unit, amounts in parentheses and what follows a comma", () => {
    expect(ingredientName("½ Hokkaido (ca. 500 g)")).toBe("Hokkaido");
    expect(ingredientName("1 Dose Kichererbsen, abgetropft")).toBe("Kichererbsen");
    expect(ingredientName("2 EL Olivenöl")).toBe("Olivenöl");
    expect(ingredientName("ca. 200g Feta")).toBe("Feta");
    expect(ingredientName("Kichererbsen (Dose)")).toBe("Kichererbsen (Dose)");
    expect(ingredientName("3 Eier")).toBe("Eier");
    expect(ingredientName("150 g Joghurt 3,5 %")).toBe("Joghurt 3,5 %");
    expect(ingredientName("500")).toBe("500");
    expect(lineKey({ foodId: null, description: "1 Dose Kichererbsen, abgetropft" })).toBe(
      "name:kichererbsen",
    );
    expect(lineKey({ foodId: "f1", description: "x" })).toBe("food:f1");
  });

  test("Open Food Facts tags and USDA categories first, then keywords, else other", () => {
    expect(aisleByCategories(["en:plant-based-foods", "en:canned-foods", "en:vegetables"])).toBe("pantry");
    expect(aisleByCategories(["en:dairies", "en:cheeses"])).toBe("dairy_eggs");
    expect(aisleByCategories(["Vegetables and Vegetable Products"])).toBe("produce");
    expect(aisleByCategories(["Finfish and Shellfish Products"])).toBe("meat_fish");
    expect(aisleByCategories(["Fats and Oils"])).toBe("pantry");
    expect(aisleByCategories(["en:something-else"])).toBeNull();
    expect(aisleByKeyword("Basmatireis")).toBe("pantry");
    expect(aisleByKeyword("Paprikapulver")).toBe("pantry");
    expect(aisleByKeyword("Paprika, rot")).toBe("produce");
    expect(aisleByKeyword("Passierte Tomaten")).toBe("pantry");
    expect(aisleByKeyword("Kokosmilch light")).toBe("pantry");
    expect(aisleByKeyword("Hähnchenbrust")).toBe("meat_fish");
    expect(aisleByKeyword("Champignons")).toBe("produce");
    expect(aisleByKeyword("Reis")).toBe("pantry");
    expect(aisleByKeyword("2 Eier")).toBe("dairy_eggs");
    expect(aisleByKeyword("Orangensaft")).toBe("drinks");
    expect(aisleByKeyword("Vollkornbrot")).toBe("bakery");
    expect(aisleByKeyword("Olivenöl")).toBe("pantry");
    expect(aisleByKeyword("Spülmittel")).toBeNull();
    expect(aisleOf({ name: "Hokkaido-Kürbis", categories: ["en:frozen-foods"] }, "Hokkaido")).toBe("frozen");
    expect(aisleOf({ name: "Produkt 123", categories: [] }, "Rote Linsen")).toBe("pantry");
    expect(aisleOf(null, "Spülmittel")).toBe("other");
  });
});
