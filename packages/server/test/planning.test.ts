import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type ApiError,
  goalPaths,
  type LogPlannedMealResponse,
  type MealDetailResponse,
  type MealResponse,
  mealPaths,
  type PlannedMealResponse,
  type PlanResponse,
  planningPaths,
  type RecipeView,
  slotOf,
} from "@yamt/shared";
import { IDENTITY_HEADER } from "../src/auth/identity.ts";
import { PlanningService } from "../src/domain/planning.ts";
import { dayRange } from "../src/domain/time.ts";
import { type AppServer, createServer } from "../src/server.ts";
import { tempDir } from "./helpers.ts";

// Recipes, planned meals, the plan and "Ate it" (#39). Made-up foods and recipes; each describe
// gets a server of its own (goals and plans apply across tests).

const TZ = "Europe/Berlin";
const HOUR = 3_600_000;
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
  const food = (
    name: string,
    per100g: { energyKcal: number; protein?: number; fat?: number; carbohydrate?: number },
  ) => s.foods.create({ source: "custom", name, per100g }).id;
  const hokkaido = food("Hokkaido", { energyKcal: 40, protein: 1.7, fat: 0.6, carbohydrate: 8 });
  const coconut = food("Kokosmilch light", { energyKcal: 75, protein: 0.8, fat: 7, carbohydrate: 2 });
  const feta = food("Feta", { energyKcal: 260, protein: 17, fat: 21, carbohydrate: 0.5 });
  /** Kürbis-Curry for 2: per portion 250 + 120 + 100 + 50 g, 100 + 144 + 75 + 130 = 449 kcal. */
  const curry = () =>
    s.recipes.save({
      title: "Kürbis-Curry",
      summary: "Hokkaido, Kichererbsen und Kokosmilch, mild",
      sourceMode: "adapted",
      sourceUrl: "https://www.chefkoch.de/rezepte/0000000/kuerbis-curry.html",
      sourceName: "chefkoch.de",
      changes: ["Sahne → Kokosmilch light"],
      servings: 2,
      timeActiveMin: 20,
      timeTotalMin: 40,
      steps: ["Kürbis würfeln.", "Alles 20 Minuten köcheln."],
      items: [
        {
          foodId: hokkaido,
          description: "½ Hokkaido (ca. 500 g)",
          grams: 500,
          provenance: "database",
          confidence: "medium",
        },
        {
          estimatePer100g: { energyKcal: 120, protein: 7, fat: 2.5, carbohydrate: 16, fiber: 6 },
          description: "1 Dose Kichererbsen, abgetropft",
          grams: 240,
          provenance: "estimate",
          confidence: "medium",
        },
        {
          foodId: coconut,
          description: "200 ml Kokosmilch light",
          grams: 200,
          provenance: "database",
          confidence: "high",
        },
        {
          foodId: feta,
          description: "Feta",
          grams: 100,
          provenance: "database",
          confidence: "high",
          optional: true,
        },
      ],
    });
  /** A meal at `eatenAt`, analysed with one estimate of `kcal`. */
  async function eaten(eatenAt: number, kcal: number, text = "Essen") {
    const m = (await call<MealResponse>("POST", mealPaths.meals, { eatenAt })).body.meal;
    await call("POST", mealPaths.captures(m.id), { kind: "text", text });
    s.revisions.save({
      mealId: m.id,
      runId: null,
      title: text,
      summary: "",
      eatenAt: null,
      assumptions: [],
      items: [
        {
          description: text,
          grams: 100,
          provenance: "estimate",
          confidence: "medium",
          estimatePer100g: { energyKcal: kcal, protein: 10 },
        },
      ],
      questions: [],
    });
    return m.id;
  }
  const plan = (recipeId: string, date: string, slot: string, more: Record<string, unknown> = {}) =>
    call<PlannedMealResponse>("POST", planningPaths.plannedMeals, { recipeId, date, slot, ...more });
  const at = (date: string, hour: number) => dayRange(date, TZ).from + hour * HOUR;
  /** The plan as of noon on `today` (the service with a fixed clock; the API's is the real one). */
  const planOn = (today: string, from: string, to: string) =>
    new PlanningService(s.repos, s.revisions, TZ, () => at(today, 12)).plan({ from, to, tz: TZ });
  return { app, s, call, curry, eaten, plan, at, planOn, feta };
}

describe("recipes", () => {
  const { s, call, curry } = setup();

  test("saved with matched items, read with items and totals per portion and for the whole recipe", async () => {
    const saved = curry();
    const res = await call<RecipeView>("GET", planningPaths.recipe(saved.recipe.id));
    expect(res.status).toBe(200);
    const view = res.body;
    expect(view.recipe).toMatchObject({
      title: "Kürbis-Curry",
      sourceMode: "adapted",
      sourceName: "chefkoch.de",
      changes: ["Sahne → Kokosmilch light"],
      servings: 2,
      steps: ["Kürbis würfeln.", "Alles 20 Minuten köcheln."],
    });
    expect(view.items.map((i) => [i.grams, i.portionGrams, i.optional])).toEqual([
      [500, 250, false],
      [240, 120, false],
      [200, 100, false],
      [100, 50, true],
    ]);
    expect(view.items[0]!.food?.name).toBe("Hokkaido");
    expect(view.items[1]!.food).toBeNull();
    expect(view.items[3]!.portionNutrients.energyKcal).toBe(130);
    expect(view.perPortion.nutrients.energyKcal).toBe(449);
    expect(view.whole.nutrients.energyKcal).toBe(898);
    expect(view.perPortion.byProvenance.estimate.nutrients.energyKcal).toBe(144);
    expect((await call("GET", planningPaths.recipe("0190a0b0-0000-7000-8000-000000000099"))).status).toBe(
      404,
    );
  });

  test("validated like revision items, with the source rules of each mode", () => {
    const base = {
      title: "Test",
      summary: "",
      servings: 1,
      items: [
        {
          description: "x",
          grams: 100,
          provenance: "estimate" as const,
          confidence: "low" as const,
          estimatePer100g: { energyKcal: 100 },
        },
      ],
    };
    const err = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as Error).message;
      }
      throw new Error("should have failed");
    };
    expect(s.recipes.save({ ...base, sourceMode: "composed" }).perPortion.nutrients.energyKcal).toBe(100);
    expect(err(() => s.recipes.save({ ...base, sourceMode: "published" }))).toContain("names its source");
    expect(err(() => s.recipes.save({ ...base, sourceMode: "composed", changes: ["mehr Chili"] }))).toContain(
      "only an adapted recipe",
    );
    expect(err(() => s.recipes.save({ ...base, sourceMode: "composed", items: [] }))).toContain(
      "at least one",
    );
    expect(
      err(() => s.recipes.save({ ...base, sourceMode: "composed", timeActiveMin: 30, timeTotalMin: 20 })),
    ).toContain("timeTotalMin");
    expect(
      err(() =>
        s.recipes.save({
          ...base,
          sourceMode: "composed",
          items: [{ ...base.items[0]!, provenance: "database" }],
        }),
      ),
    ).toContain("items[0]: provenance database needs a foodId");
    const noEnergy = s.foods.create({ source: "custom", name: "Wasser", per100g: { energyKcal: 0 } });
    expect(
      s.recipes.save({
        ...base,
        sourceMode: "composed",
        items: [
          {
            foodId: noEnergy.id,
            description: "Wasser",
            grams: 500,
            provenance: "database",
            confidence: "high",
          },
        ],
      }).whole.nutrients.energyKcal,
    ).toBe(0);
    expect(
      err(() =>
        s.recipes.save({
          ...base,
          sourceMode: "composed",
          items: [
            {
              foodId: "0190a0b0-0000-7000-8000-000000000099",
              description: "?",
              grams: 1,
              provenance: "database",
              confidence: "low",
            },
          ],
        }),
      ),
    ).toContain("items[0].foodId");
  });

  test("insert-only: the database refuses changing or deleting a recipe or its items", () => {
    const { recipe } = curry();
    expect(() => s.repos.db.query("UPDATE recipes SET title = 'x' WHERE id = ?").run(recipe.id)).toThrow(
      "recipes are immutable",
    );
    expect(() => s.repos.db.query("DELETE FROM recipe_items WHERE recipe_id = ?").run(recipe.id)).toThrow(
      "never deleted",
    );
  });

  test("a portion is grams ÷ servings, to 0.01 g", () => {
    const view = s.recipes.save({
      title: "Drittel",
      summary: "",
      sourceMode: "composed",
      servings: 3,
      items: [
        {
          description: "x",
          grams: 100,
          provenance: "estimate",
          confidence: "low",
          estimatePer100g: { energyKcal: 300 },
        },
      ],
    });
    expect(view.items[0]!.portionGrams).toBe(33.33);
    expect(view.perPortion.nutrients.energyKcal).toBe(100);
  });
});

describe("planned meals", () => {
  const { s, call, curry, plan } = setup();
  const recipeId = curry().recipe.id;

  test("created at the end of their slot, idempotent with a client id", async () => {
    const id = "0190a0b0-0000-7000-8000-0000000000a1";
    const first = await plan(recipeId, "2026-04-01", "dinner", {
      id,
      portionsCooked: 2,
      note: " für zwei Tage ",
    });
    expect(first.status).toBe(201);
    expect(first.body.plannedMeal).toMatchObject({
      id,
      date: "2026-04-01",
      slot: "dinner",
      position: 0,
      title: "Kürbis-Curry",
      portionsCooked: 2,
      portionEaten: 1,
      status: "planned",
      loggedMealId: null,
      note: "für zwei Tage",
    });
    expect(first.body.plannedMeal.perPortion.nutrients.energyKcal).toBe(449);
    expect(first.body.plannedMeal.eaten.nutrients.energyKcal).toBe(449);
    const again = await plan(recipeId, "2026-04-01", "dinner", { id });
    expect(again.status).toBe(200);
    expect(again.body.plannedMeal.id).toBe(id);
    const other = s.recipes.save({
      title: "Anderes",
      summary: "",
      sourceMode: "composed",
      servings: 1,
      items: [
        {
          description: "x",
          grams: 1,
          provenance: "estimate",
          confidence: "low",
          estimatePer100g: { energyKcal: 1 },
        },
      ],
    });
    expect((await plan(other.recipe.id, "2026-04-01", "dinner", { id })).status).toBe(409);
    const second = await plan(recipeId, "2026-04-01", "dinner", { portionEaten: 0.5 });
    expect(second.body.plannedMeal.position).toBe(1);
    expect(second.body.plannedMeal.eaten.nutrients.energyKcal).toBe(225);

    expect((await plan("0190a0b0-0000-7000-8000-000000000099", "2026-04-01", "dinner")).status).toBe(400);
    expect((await plan(recipeId, "2026-04-31", "dinner")).status).toBe(400);
    expect((await plan(recipeId, "2026-04-01", "brunch")).status).toBe(400);
    expect((await plan(recipeId, "2026-04-01", "lunch", { portionEaten: 0 })).status).toBe(400);
  });

  test("moved and reordered within and across slots; positions stay 0, 1, …", async () => {
    const a = (await plan(recipeId, "2026-04-02", "lunch")).body.plannedMeal;
    const b = (await plan(recipeId, "2026-04-02", "lunch")).body.plannedMeal;
    const c = (await plan(recipeId, "2026-04-02", "lunch")).body.plannedMeal;
    const slot = () =>
      s.repos.plannedMeals
        .between("2026-04-02", "2026-04-02")
        .filter((p) => p.slot === "lunch")
        .map((p) => [p.id, p.position]);

    const moved = await call<PlannedMealResponse>("PATCH", planningPaths.plannedMeal(c.id), { position: 0 });
    expect(moved.status).toBe(200);
    expect(slot()).toEqual([
      [c.id, 0],
      [a.id, 1],
      [b.id, 2],
    ]);
    // to another day: at the end there, and the slot it left closes the gap
    const away = await call<PlannedMealResponse>("PATCH", planningPaths.plannedMeal(a.id), {
      date: "2026-04-03",
      slot: "dinner",
      portionEaten: 1.5,
      portionsCooked: 2,
    });
    expect(away.body.plannedMeal).toMatchObject({
      date: "2026-04-03",
      slot: "dinner",
      position: 0,
      portionEaten: 1.5,
    });
    expect(slot()).toEqual([
      [c.id, 0],
      [b.id, 1],
    ]);
    // a position past the end is the end
    await call("PATCH", planningPaths.plannedMeal(c.id), { position: 50 });
    expect(slot()).toEqual([
      [b.id, 0],
      [c.id, 1],
    ]);
    const noted = await call<PlannedMealResponse>("PATCH", planningPaths.plannedMeal(b.id), {
      note: "mit Reis",
    });
    expect(noted.body.plannedMeal).toMatchObject({ note: "mit Reis", position: 0, slot: "lunch" });
    expect((await call("PATCH", planningPaths.plannedMeal(b.id), { status: "logged" })).status).toBe(400);
  });

  test("skip and unskip are idempotent; skipped ones can't be changed or unplanned, planned ones can", async () => {
    const p = (await plan(recipeId, "2026-04-04", "lunch")).body.plannedMeal;
    const skip = await call<PlannedMealResponse>("POST", planningPaths.skip(p.id));
    expect(skip.body.plannedMeal.status).toBe("skipped");
    const read = await call<PlannedMealResponse>("GET", planningPaths.plannedMeal(p.id));
    expect(read.body.plannedMeal).toMatchObject({ id: p.id, status: "skipped", title: "Kürbis-Curry" });
    expect(read.body.plannedMeal.perPortion.nutrients.energyKcal).toBe(449);
    expect((await call<PlannedMealResponse>("POST", planningPaths.skip(p.id))).body.plannedMeal.status).toBe(
      "skipped",
    );
    expect((await call("PATCH", planningPaths.plannedMeal(p.id), { slot: "dinner" })).status).toBe(409);
    expect((await call("DELETE", planningPaths.plannedMeal(p.id))).status).toBe(409);
    expect(
      (await call("POST", planningPaths.log(p.id), { eatenAt: Date.now() - HOUR, excludeItemIds: [] }))
        .status,
    ).toBe(409);
    expect(
      (await call<PlannedMealResponse>("POST", planningPaths.unskip(p.id))).body.plannedMeal.status,
    ).toBe("planned");
    expect(
      (await call<PlannedMealResponse>("POST", planningPaths.unskip(p.id))).body.plannedMeal.status,
    ).toBe("planned");
    expect((await call("DELETE", planningPaths.plannedMeal(p.id))).status).toBe(204);
    expect(s.repos.plannedMeals.get(p.id)).toBeNull();
    expect((await call("DELETE", planningPaths.plannedMeal(p.id))).status).toBe(404);
    expect((await call("GET", planningPaths.plannedMeal(p.id))).status).toBe(404);
    expect((await call("POST", planningPaths.skip(p.id))).status).toBe(404);
  });
});

describe("ate it", () => {
  const { s, call, curry, plan, feta } = setup();
  const view = curry();
  const recipeId = view.recipe.id;
  const fetaItem = view.items.find((i) => i.foodId === feta)!;

  test("logs the recipe's items for the portion eaten, minus the excluded ones, without a model", async () => {
    const p = (await plan(recipeId, "2026-05-01", "dinner", { portionsCooked: 2 })).body.plannedMeal;
    const id = "0190a0b0-0000-7000-8000-0000000000b1";
    const eatenAt = Date.now() - 2 * HOUR;
    const res = await call<LogPlannedMealResponse>("POST", planningPaths.log(p.id), {
      id,
      eatenAt,
      portionEaten: 1,
      excludeItemIds: [fetaItem.id],
    });
    expect(res.status).toBe(201);
    const { meal, revision, plannedMeal } = res.body;
    expect(meal).toMatchObject({
      id,
      status: "analysed",
      eatenAt,
      eatenAtSource: "user",
      sourcePlannedMealId: p.id,
      sourceMealId: null,
      currentRevisionId: revision.revision.id,
    });
    expect(revision.revision).toMatchObject({
      number: 1,
      kind: "plan",
      runId: null,
      sourceRevisionId: null,
      title: "Kürbis-Curry",
      summary: "Hokkaido, Kichererbsen und Kokosmilch, mild",
      status: "analysed",
    });
    expect(revision.revision.assumptions[0]).toBe(
      "Logged from the plan: Kürbis-Curry, 1 of 2 portions, without Feta",
    );
    expect(revision.items.map((i) => [i.description, i.grams, i.provenance])).toEqual([
      ["½ Hokkaido (ca. 500 g)", 250, "database"],
      ["1 Dose Kichererbsen, abgetropft", 120, "estimate"],
      ["200 ml Kokosmilch light", 100, "database"],
    ]);
    // the snapshots as stored, totals by computeTotals like any meal's
    expect(revision.items.map((i) => i.per100g.energyKcal)).toEqual([40, 120, 75]);
    expect(revision.totals.nutrients.energyKcal).toBe(319);
    expect(revision.questions).toEqual([]);
    expect(plannedMeal).toMatchObject({ status: "logged", loggedMealId: id, portionEaten: 1 });
    expect(s.repos.runs.listForMeal(id)).toEqual([]);
    expect(s.repos.jobs.isOpen(`analyse:${id}`)).toBe(false);

    // the same id again: the stored meal, nothing new
    const again = await call<LogPlannedMealResponse>("POST", planningPaths.log(p.id), {
      id,
      eatenAt,
      excludeItemIds: [],
    });
    expect(again.status).toBe(200);
    expect(again.body.revision.revision.id).toBe(revision.revision.id);
    // a fresh id: already logged
    const twice = await call("POST", planningPaths.log(p.id), { eatenAt, excludeItemIds: [] });
    expect(twice.status).toBe(409);
    expect((await call("PATCH", planningPaths.plannedMeal(p.id), { slot: "lunch" })).status).toBe(409);
    expect((await call("POST", planningPaths.skip(p.id))).status).toBe(409);
    expect((await call("DELETE", planningPaths.plannedMeal(p.id))).status).toBe(409);
    // the database backs it: a logged planned meal is history
    expect(() => s.repos.db.query("DELETE FROM planned_meals WHERE id = ?").run(p.id)).toThrow(
      "only a planned meal",
    );

    // later changes go through captures and an analysis, as with a copy
    const detail = await call<MealDetailResponse>("GET", mealPaths.meal(id));
    expect(detail.body.captures).toEqual([]);
    expect((await call("POST", mealPaths.analyse(id))).status).toBe(409);
  });

  test("scales to the portion eaten (to 0.01 g) and computes what the plan counted", async () => {
    const p = (await plan(recipeId, "2026-05-02", "lunch", { portionEaten: 0.75 })).body.plannedMeal;
    expect(p.eaten.nutrients.energyKcal).toBe(337);
    const res = await call<LogPlannedMealResponse>("POST", planningPaths.log(p.id), {
      eatenAt: Date.now() - HOUR,
    });
    expect(res.status).toBe(201);
    expect(res.body.revision.items.map((i) => i.grams)).toEqual([187.5, 90, 75, 37.5]);
    expect(res.body.revision.totals.nutrients).toEqual(p.eaten.nutrients);
    expect(res.body.revision.revision.assumptions[0]).toBe(
      "Logged from the plan: Kürbis-Curry, 0.75 of 1 portion",
    );

    const q = (await plan(recipeId, "2026-05-02", "dinner")).body.plannedMeal;
    const half = await call<LogPlannedMealResponse>("POST", planningPaths.log(q.id), {
      eatenAt: Date.now() - HOUR,
      portionEaten: 1.5,
    });
    expect(half.body.plannedMeal.portionEaten).toBe(1.5);
    expect(half.body.revision.items.map((i) => i.grams)).toEqual([375, 180, 150, 75]);
  });

  test("refuses unknown items, nothing left, a future time and unknown planned meals", async () => {
    const p = (await plan(recipeId, "2026-05-03", "lunch")).body.plannedMeal;
    const log = (body: unknown) => call("POST", planningPaths.log(p.id), body);
    expect(
      (await log({ eatenAt: Date.now(), excludeItemIds: ["0190a0b0-0000-7000-8000-000000000099"] })).status,
    ).toBe(400);
    expect((await log({ eatenAt: Date.now(), excludeItemIds: view.items.map((i) => i.id) })).status).toBe(
      400,
    );
    expect((await log({ eatenAt: Date.now() + 2 * HOUR })).status).toBe(400);
    expect((await log({ eatenAt: Date.now(), portionEaten: 0 })).status).toBe(400);
    expect((await log({})).status).toBe(400);
    expect(
      (await call("POST", planningPaths.log("0190a0b0-0000-7000-8000-000000000099"), { eatenAt: 1 })).status,
    ).toBe(404);
    // an id of a meal that isn't from this planned meal
    const other = (await call<MealResponse>("POST", mealPaths.meals, {})).body.meal;
    expect((await log({ id: other.id, eatenAt: Date.now() })).status).toBe(409);
    expect(s.repos.plannedMeals.get(p.id)?.status).toBe("planned");
  });

  test("removing the logged meal puts the planned meal back; restoring logs it again", async () => {
    const p = (await plan(recipeId, "2026-05-04", "dinner")).body.plannedMeal;
    const { meal } = (
      await call<LogPlannedMealResponse>("POST", planningPaths.log(p.id), { eatenAt: Date.now() - HOUR })
    ).body;
    expect((await call("POST", mealPaths.remove(meal.id))).status).toBe(200);
    expect(s.repos.plannedMeals.get(p.id)).toMatchObject({ status: "planned", loggedMealId: null });
    expect((await call("POST", mealPaths.restore(meal.id))).status).toBe(200);
    expect(s.repos.plannedMeals.get(p.id)).toMatchObject({ status: "logged", loggedMealId: meal.id });

    // removed again and logged anew: the restored meal stays a meal of its own
    await call("POST", mealPaths.remove(meal.id));
    const fresh = (
      await call<LogPlannedMealResponse>("POST", planningPaths.log(p.id), { eatenAt: Date.now() - HOUR })
    ).body.meal;
    await call("POST", mealPaths.restore(meal.id));
    expect(s.repos.plannedMeals.get(p.id)).toMatchObject({ status: "logged", loggedMealId: fresh.id });
  });
});

describe("the plan", () => {
  const { call, curry, eaten, plan, at, planOn } = setup();
  const recipeId = curry().recipe.id;

  test("projects each day: eaten + planned, logged ones through their meal, skipped ones not at all", async () => {
    await call("POST", goalPaths.goals, { energyKcal: 2000, protein: 150, effectiveFrom: "2026-06-01" });
    // 06-10 is today: breakfast eaten, lunch logged from the plan, dinner planned, a snack skipped
    await eaten(at("2026-06-10", 8), 400, "Porridge");
    const lunch = (await plan(recipeId, "2026-06-10", "lunch")).body.plannedMeal;
    const logged = (
      await call<LogPlannedMealResponse>("POST", planningPaths.log(lunch.id), {
        eatenAt: at("2026-06-10", 13),
      })
    ).body;
    const dinner = (await plan(recipeId, "2026-06-10", "dinner", { portionEaten: 0.5 })).body.plannedMeal;
    const snack = (await plan(recipeId, "2026-06-10", "snack")).body.plannedMeal;
    await call("POST", planningPaths.skip(snack.id));

    const res = planOn("2026-06-10", "2026-06-09", "2026-06-11");
    expect(res.today).toBe("2026-06-10");
    expect(res.days.map((d) => d.date)).toEqual(["2026-06-09", "2026-06-10", "2026-06-11"]);
    const day = res.days[1]!;
    expect(day.plannedMeals.map((p) => [p.slot, p.status])).toEqual([
      ["lunch", "logged"],
      ["dinner", "planned"],
      ["snack", "skipped"],
    ]);
    expect(day.meals.map((m) => [m.title, m.slot, m.plannedMealId])).toEqual([
      ["Porridge", "breakfast", null],
      ["Kürbis-Curry", "lunch", lunch.id],
    ]);
    expect(day.eaten?.nutrients.energyKcal).toBe(400 + logged.revision.totals.nutrients.energyKcal);
    // what was eaten plus the half portion still planned (one computeTotals over all, so ±1 kcal)
    expect(
      Math.abs(
        day.projected!.nutrients.energyKcal -
          day.eaten!.nutrients.energyKcal -
          dinner.eaten.nutrients.energyKcal,
      ),
    ).toBeLessThanOrEqual(1);
    expect(day.goal).toMatchObject({
      targets: { energyKcal: 2000, protein: 150 },
      kind: null,
      label: "Manual targets",
    });
    expect(day.openSlots).toEqual([]);
    expect(day.mostlyKnown).toBe(true);

    // a past day with nothing is known; a future one with nothing is open
    expect(res.days[0]).toMatchObject({ eaten: null, projected: null, mostlyKnown: true, openSlots: MAIN });
    expect(res.days[2]).toMatchObject({ eaten: null, projected: null, mostlyKnown: false, openSlots: MAIN });
  });

  test("mostly known needs breakfast, lunch and dinner eaten or planned; snacks are optional", async () => {
    await plan(recipeId, "2026-07-02", "lunch");
    await plan(recipeId, "2026-07-02", "dinner");
    // a coffee at 9 is a snack: breakfast stays open
    await eaten(at("2026-07-02", 9), 30, "Kaffee");
    let day = planOn("2026-07-01", "2026-07-02", "2026-07-02").days[0]!;
    expect(day.meals[0]!.slot).toBe("snack");
    expect(day.openSlots).toEqual(["breakfast"]);
    expect(day.mostlyKnown).toBe(false);
    expect(day.eaten?.nutrients.energyKcal).toBe(30);
    expect(day.projected?.nutrients.energyKcal).toBe(30 + 2 * 449);

    // a skipped breakfast doesn't make it known; an eaten one does
    const breakfast = (await plan(recipeId, "2026-07-02", "breakfast")).body.plannedMeal;
    await call("POST", planningPaths.skip(breakfast.id));
    expect(planOn("2026-07-01", "2026-07-02", "2026-07-02").days[0]!.mostlyKnown).toBe(false);
    await eaten(at("2026-07-02", 8), 350, "Müsli");
    day = planOn("2026-07-01", "2026-07-02", "2026-07-02").days[0]!;
    expect(day.openSlots).toEqual([]);
    expect(day.mostlyKnown).toBe(true);

    // an unanalysed meal fills the slot of its time but counts nothing
    const draft = (await call<MealResponse>("POST", mealPaths.meals, { eatenAt: at("2026-07-03", 19) })).body
      .meal;
    await call("POST", mealPaths.captures(draft.id), { kind: "text", text: "Pizza" });
    const next = planOn("2026-07-01", "2026-07-03", "2026-07-03").days[0]!;
    expect(next).toMatchObject({
      unanalysed: 1,
      eaten: null,
      projected: null,
      openSlots: ["breakfast", "lunch"],
    });
    expect(next.meals[0]).toMatchObject({ slot: "dinner", totals: null, title: null });
  });

  test("a removed meal counts nothing and fills no slot", async () => {
    const id = await eaten(at("2026-08-01", 12), 600, "Döner");
    expect(planOn("2026-08-01", "2026-08-01", "2026-08-01").days[0]!.eaten?.nutrients.energyKcal).toBe(600);
    await call("POST", mealPaths.remove(id));
    const day = planOn("2026-08-01", "2026-08-01", "2026-08-01").days[0]!;
    expect(day).toMatchObject({ meals: [], eaten: null, openSlots: MAIN });
  });

  test("the API: at most 31 days, in order, in the phone's zone", async () => {
    const ok = await call<PlanResponse>(
      "GET",
      `${planningPaths.plan}?from=2026-06-01&to=2026-07-01&tz=${TZ}`,
    );
    expect(ok.status).toBe(200);
    expect(ok.body.days).toHaveLength(31);
    expect(ok.body.timeZone).toBe(TZ);
    expect((await call("GET", `${planningPaths.plan}?from=2026-06-01&to=2026-07-02`)).status).toBe(400);
    expect((await call("GET", `${planningPaths.plan}?from=2026-06-02&to=2026-06-01`)).status).toBe(400);
    expect((await call("GET", `${planningPaths.plan}?from=2026-06-01`)).status).toBe(400);
    expect(
      (await call("GET", `${planningPaths.plan}?from=2026-06-01&to=2026-06-01&tz=Mars/Olympus`)).status,
    ).toBe(400);
  });
});

const MAIN = ["breakfast", "lunch", "dinner"];

describe("slotOf", () => {
  test("by the local hour, small analysed meals are snacks", () => {
    expect([3, 4, 10, 11, 15, 16, 23].map((h) => slotOf(h, null))).toEqual([
      "snack",
      "breakfast",
      "breakfast",
      "lunch",
      "lunch",
      "dinner",
      "dinner",
    ]);
    expect(slotOf(12, 149)).toBe("snack");
    expect(slotOf(12, 150)).toBe("lunch");
  });
});
