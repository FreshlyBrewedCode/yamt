import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  addDays,
  DEFAULT_PLANNING_PREFERENCES,
  DEFAULT_PLANNING_SETTINGS,
  type PlanDay,
  type PlannedMealView,
  type PlanningPreferences,
} from "@yamt/shared";
import { newId } from "../src/db/index.ts";
import { PLANNING_SETTINGS_KEY } from "../src/domain/planning-settings.ts";
import { localDate } from "../src/domain/time.ts";
import {
  MAIN_MEAL_MAX_SHARE,
  SLOT_WEIGHTS,
  SNACK_MAX_SHARE,
  SNACK_RESERVE_SHARE,
  slotBudget,
} from "../src/planning/budget.ts";
import { implausible, processedWords, stateWords } from "../src/planning/matcher.ts";
import { createServer } from "../src/server.ts";
import { tempDir } from "./helpers.ts";
import { fixtureFetch } from "./nutrition-fixtures.ts";

const TZ = "Europe/Berlin";

// ---- the slot budget -------------------------------------------------------------------------

const TARGETS = { energyKcal: 2200, protein: 160, fat: 70, carbohydrate: 220, fiber: 30 };
const totals = (energyKcal: number, protein: number, fat = 0, carbohydrate = 0, fiber = 0) => ({
  grams: 0,
  items: 1,
  nutrients: { energyKcal, protein, fat, carbohydrate, fiber, saturatedFat: 0, sugars: 0, salt: 0 },
});
function day(over: Partial<PlanDay> = {}): PlanDay {
  return {
    date: "2026-11-10",
    plannedMeals: [],
    meals: [],
    unanalysed: 0,
    eaten: null,
    projected: null,
    goal: {
      id: "g",
      effectiveFrom: "2026-11-01",
      targets: TARGETS,
      kind: "cut",
      label: "Cut",
      floorKcal: null,
    } as unknown as PlanDay["goal"],
    openSlots: ["breakfast", "lunch", "dinner"],
    mostlyKnown: false,
    ...over,
  };
}

describe("slotBudget", () => {
  test("an empty day: dinner's share of what is open after a snack's room, under the cap", () => {
    const b = slotBudget(day(), "dinner");
    const share = SLOT_WEIGHTS.dinner / (SLOT_WEIGHTS.breakfast + SLOT_WEIGHTS.lunch + SLOT_WEIGHTS.dinner);
    expect(b.sharedWith).toEqual(["breakfast", "lunch", "dinner"]);
    expect(b.snackRoomKept).toBe(true);
    expect(b.openForTheDay.energyKcal).toBe(2200);
    expect(b.budget.energyKcal).toBe(Math.round(2200 * (1 - SNACK_RESERVE_SHARE) * share));
    expect(b.budget.protein).toBe(Math.round(160 * (1 - SNACK_RESERVE_SHARE) * share * 10) / 10);
  });

  test("only dinner left on a nearly empty day: capped at the main meal's share of the target, not all of it", () => {
    // spike #38: 1,278 kcal open for one dinner made 330 g of shrimp; the cap keeps it a plate
    const b = slotBudget(
      day({ openSlots: ["dinner"], eaten: totals(900, 70), projected: totals(900, 70) }),
      "dinner",
    );
    expect(b.openForTheDay.energyKcal).toBe(1300);
    expect(b.budget.energyKcal).toBe(Math.round(2200 * MAIN_MEAL_MAX_SHARE));
    expect(b.budget.protein).toBe(Math.round(160 * MAIN_MEAL_MAX_SHARE * 10) / 10);
  });

  test("a planned snack takes no room twice; a snack slot gets at most its own share", () => {
    const planned = { slot: "snack", status: "planned" } as PlannedMealView;
    const withSnack = slotBudget(day({ openSlots: ["dinner"], plannedMeals: [planned] }), "dinner");
    expect(withSnack.snackRoomKept).toBe(false);
    const snack = slotBudget(day(), "snack");
    expect(snack.sharedWith).toEqual([]);
    expect(snack.budget.energyKcal).toBe(Math.round(2200 * SNACK_MAX_SHARE));
  });

  test("an overfull day leaves nothing; without a goal there is no budget", () => {
    const full = slotBudget(day({ projected: totals(2500, 170, 90, 250, 35) }), "dinner");
    expect(full.openForTheDay.energyKcal).toBe(0);
    expect(full.budget.energyKcal).toBe(0);
    const none = slotBudget(day({ goal: null }), "dinner");
    expect(none.targets).toBeNull();
    expect(none.budget.energyKcal).toBeNull();
  });
});

describe("matcher ranking words", () => {
  test("state words, processed products for plain ingredients, numbers that don't add up", () => {
    expect(stateWords("Rice, white, long-grain, raw")).toEqual(["raw"]);
    expect(stateWords("Basmatireis gekocht")).toEqual(["cooked"]);
    expect(stateWords("Kichererbsen, abgetropft")).toEqual(["canned"]);
    expect(processedWords("Knoblauch granuliert", "Knoblauch")).toEqual(["granuliert"]);
    expect(processedWords("Rote Zwiebel Salsa", "Rote Zwiebel")).toEqual(["salsa"]);
    // what the ingredient itself says isn't a penalty
    expect(processedWords("Tomatensauce", "Tomatensauce")).toEqual([]);
    expect(processedWords("Hokkaido Kürbis", "Hokkaido-Kürbis")).toEqual([]);
    expect(
      implausible({ energyKcal: 201, protein: 2.6, fat: 0.7, carbohydrate: 2.1, fiber: 1.6 } as never),
    ).toMatch(/^energy 201 kcal vs \d+ from its macros$/);
    expect(
      implausible({ energyKcal: 25, protein: 2.6, fat: 0.7, carbohydrate: 2.1, fiber: 1.6 } as never),
    ).toBeNull();
  });
});

// ---- the MCP tools ---------------------------------------------------------------------------

const fetchFake = fixtureFetch();
const app = createServer({
  dataDir: join(tempDir(), "data"),
  port: 0,
  webDist: null,
  auth: { kind: "off" },
  fetch: fetchFake,
  fdcApiKey: "test-key",
  timeZone: TZ,
});
const s = app.services;
const clients: Client[] = [];
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await app.stop();
});
const today = localDate(Date.now(), TZ);
s.repos.goals.insert({ effectiveFrom: addDays(today, -30), targets: TARGETS, note: "" });

async function connect(token: string) {
  const client = new Client({ name: "yamt-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(app.mcpUrl), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  clients.push(client);
  return client;
}
async function call<T = Record<string, unknown>>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  const text = res.content[0]?.text ?? "";
  return res.isError ? { error: text, data: null } : { error: null, data: JSON.parse(text) as T };
}
const ok = async <T = Record<string, unknown>>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) => {
  const r = await call<T>(client, name, args);
  if (r.error !== null) throw new Error(`${name}: ${r.error}`);
  return r.data as T;
};

/** A request's round, taken by a run as the plan job does, with that run's token. */
function runningRound(filters: Record<string, unknown> = {}, text = "Etwas mit Linsen, kein Ofen") {
  const { request } = s.planningRequests.create({ filters, text, tz: TZ });
  const { round } = s.planningRequests.suggest(request.id);
  const runId = newId();
  s.repos.planningRuns.insert({
    id: runId,
    roundId: round.id,
    jobId: null,
    attempt: 1,
    harness: "custom",
    model: null,
    effort: null,
    startedAt: Date.now(),
  });
  s.planningRequests.startRound(round.id, runId);
  return { request, round, runId, token: s.mcpTokens.mintPlanRun({ runId, roundId: round.id }) };
}

const lentils = () =>
  s.foods.create({
    source: "custom",
    name: "Rote Linsen, trocken",
    per100g: { energyKcal: 350, protein: 24, fat: 1.5, carbohydrate: 50, fiber: 11 },
  }).id;
const ideas = (n: number, date = today) =>
  Array.from({ length: n }, (_, i) => ({
    title: `Idee ${i + 1}`,
    approach: "Mit Linsen.",
    sourceMode: "composed",
    proposedDate: date,
    proposedSlot: "dinner",
  }));
const suggestion = (roundId: string, position: number, foodId: string, grams = 120) => ({
  roundId,
  position,
  title: "Linsen-Dal",
  why: ["Viel Ballaststoffe"],
  sourceMode: "composed",
  sourceName: "Eigenes Rezept",
  servings: 1,
  timeTotalMin: 30,
  steps: ["Kochen."],
  items: [{ foodId, description: `${grams} g Linsen`, grams, provenance: "database", confidence: "high" }],
});

describe("a planning run's token", () => {
  test("its round's planning tools and the food tools; no meal tools, no other round", async () => {
    const own = runningRound();
    const other = runningRound();
    const client = await connect(own.token);
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of ["get_planning_context", "match_ingredients", "save_round_outline", "save_suggestion"]) {
      expect(names).toContain(n);
    }
    for (const n of ["search_foods", "get_food", "create_food", "fetch_recipe"]) expect(names).toContain(n);
    for (const n of ["get_meal", "save_meal_revision", "get_day_summary", "save_recipe", "plan_meal"]) {
      expect(names).not.toContain(n);
    }
    expect((await call(client, "get_planning_context", { roundId: other.round.id })).error).toContain(
      `only use planning round ${own.round.id}`,
    );
    expect(
      (await call(client, "save_round_outline", { roundId: other.round.id, ideas: ideas(3) })).error,
    ).toContain("only use planning round");
    expect((await call(client, "get_meal", { mealId: newId() })).error).toContain("no tool");
    await ok(client, "get_planning_context", { roundId: own.round.id });
    // an analysis run's token doesn't see the planning tools
    const meal = s.meals.create({});
    const runClient = await connect(s.mcpTokens.mintRun({ runId: newId(), mealId: meal.id }));
    const runNames = (await runClient.listTools()).tools.map((t) => t.name);
    expect(runNames).not.toContain("get_planning_context");
    expect(runNames).not.toContain("save_suggestion");
    // revoked: nothing
    s.mcpTokens.revokeRun(own.runId);
    await expect(connect(own.token)).rejects.toThrow();
  });

  test("archiving the request revokes the running round's token at once", async () => {
    const { request, token } = runningRound();
    const client = await connect(token);
    s.planningRequests.archive(request.id);
    await expect(client.listTools()).rejects.toThrow();
  });
});

describe("planning tools", () => {
  test("context: the request, its inputs, the days with a computed budget per slot, recent meals, empty leftovers and default preferences", async () => {
    const tomorrow = addDays(today, 1);
    const { round, token } = runningRound({ days: [today, tomorrow], slots: ["lunch", "dinner"], count: 2 });
    const ctx = await ok<{
      request: { filters: { days: string[] } };
      inputs: { kind: string; text: string; newThisRound: boolean; round: number }[];
      round: { roundId: string; count: number; kind: string };
      days: { date: string; slots: { slot: string; budget: { energyKcal: number } }[] }[];
      goal: { targets: typeof TARGETS };
      recentMeals: unknown[];
      leftovers: unknown[];
      preferences: PlanningPreferences;
    }>(await connect(token), "get_planning_context", { roundId: round.id });
    expect(ctx.request.filters.days).toEqual([today, tomorrow]);
    expect(ctx.inputs).toMatchObject([
      { kind: "text", text: "Etwas mit Linsen, kein Ofen", newThisRound: true, round: 1 },
    ]);
    expect(ctx.round).toMatchObject({ roundId: round.id, count: 2, kind: "first" });
    expect(ctx.days.map((d) => [d.date, d.slots.map((x) => x.slot)])).toEqual([
      [today, ["lunch", "dinner"]],
      [tomorrow, ["lunch", "dinner"]],
    ]);
    const expected = slotBudget(s.planning.plan({ from: tomorrow, to: tomorrow, tz: TZ }).days[0]!, "dinner");
    expect(ctx.days[1]!.slots[1]!.budget.energyKcal).toBe(expected.budget.energyKcal!);
    expect(ctx.goal.targets).toEqual(TARGETS);
    expect(ctx.leftovers).toEqual([]);
    expect(ctx.preferences).toEqual(DEFAULT_PLANNING_PREFERENCES);
  });

  test("context: a saved preference (#46) comes through as the context's preferences", async () => {
    const { round, token } = runningRound();
    const preferences: PlanningPreferences = {
      dislikes: ["Rosenkohl"],
      neverEat: ["Erdnüsse"],
      equipment: ["kein Ofen"],
      weekdayCookingMin: 30,
      favouriteSites: ["chefkoch.de"],
    };
    s.repos.settings.set(PLANNING_SETTINGS_KEY, { ...DEFAULT_PLANNING_SETTINGS, preferences });
    const ctx = await ok<{ preferences: PlanningPreferences }>(await connect(token), "get_planning_context", {
      roundId: round.id,
    });
    expect(ctx.preferences).toEqual(preferences);
  });

  test("outline, save with computed numbers and the slot's fit, replace, fail", async () => {
    const { round, token } = runningRound();
    const client = await connect(token);
    // the outline: exactly the round's count, no day in the past
    expect(
      (await call(client, "save_round_outline", { roundId: round.id, ideas: ideas(2) })).error,
    ).toContain("asks for 3, not 2");
    expect(
      (await call(client, "save_round_outline", { roundId: round.id, ideas: ideas(3, addDays(today, -1)) }))
        .error,
    ).toContain("lies in the past");
    const outline = await ok<{ ideas: { position: number; title: string }[] }>(client, "save_round_outline", {
      roundId: round.id,
      ideas: ideas(3),
      requestTitle: "Linsen heute Abend",
    });
    expect(outline.ideas.map((x) => x.position)).toEqual([0, 1, 2]);
    expect(s.repos.planningRequests.get(round.requestId)!.title).toBe("Linsen heute Abend");

    const food = lentils();
    const saved = await ok<{
      saved: { position: number; title: string; suggestionId: string };
      perPortion: { energyKcal: number; protein: number };
      slotBudget: { energyKcal: number };
      fitToSlot: { energyKcal: { portion: number; budget: number; diff: number } };
      day: { kcalLeftWithIt: number };
      next: string;
    }>(client, "save_suggestion", suggestion(round.id, 0, food));
    expect(saved.saved).toEqual({ position: 0, title: "Linsen-Dal", suggestionId: expect.any(String) });
    expect(saved.perPortion.energyKcal).toBe(420);
    expect(saved.fitToSlot.energyKcal).toEqual({
      portion: 420,
      budget: saved.slotBudget.energyKcal,
      diff: 420 - saved.slotBudget.energyKcal,
    });
    expect(saved.next).toContain("2 still outlined");

    // the same position again replaces it (a new recipe)
    const before = s.repos.planningRounds.suggestionAt(round.id, 0)!.recipeId;
    const again = await ok<{ perPortion: { energyKcal: number } }>(client, "save_suggestion", {
      ...suggestion(round.id, 0, food, 100),
      timeTotalMin: 90,
    });
    expect(again.perPortion.energyKcal).toBe(350);
    expect(s.repos.planningRounds.suggestionAt(round.id, 0)!.recipeId).not.toBe(before);
    // over the request's time cap: saved, with a warning
    const { round: capped, token: cappedToken } = runningRound({ timeCapMin: 30, count: 1 });
    const cc = await connect(cappedToken);
    await ok(cc, "save_round_outline", { roundId: capped.id, ideas: ideas(1) });
    const slow = await ok<{ warnings: string[] }>(cc, "save_suggestion", {
      ...suggestion(capped.id, 0, food),
      timeTotalMin: 45,
    });
    expect(slow.warnings).toEqual(["takes 45 min, the request allows 30"]);

    const failed = await ok<{ failed: { position: number; reason: string } }>(client, "fail_suggestion", {
      roundId: round.id,
      position: 1,
      reason: "Kein Rezept ohne Ofen gefunden",
    });
    expect(failed.failed).toMatchObject({ position: 1, reason: "Kein Rezept ohne Ofen gefunden" });
    expect(
      (await call(client, "fail_suggestion", { roundId: round.id, position: 0, reason: "x" })).error,
    ).toContain("is ready");
    // an estimate needs no food; a save past the outline is refused
    expect((await call(client, "save_suggestion", suggestion(round.id, 5, food))).error).toContain(
      "no idea 5",
    );
    expect(s.repos.planningRounds.suggestions(round.id).map((x) => x.status)).toEqual([
      "ready",
      "failed",
      "outlined",
    ]);
  });

  test("the matcher: history first and a strong hit ends it; then the cache; USDA for generic, OFF for products", async () => {
    const client = await connect(s.mcpTokens.interactiveToken());
    fetchFake.calls.length = 0;
    const first = await ok<{
      ingredients: {
        name: string;
        asked: string[];
        candidates: { foodId: string; foundIn: string; name: string; missing?: string[] }[];
        warnings: string[];
      }[];
      perPortionWithFirstCandidates: { energyKcal: number };
    }>(client, "match_ingredients", {
      servings: 2,
      ingredients: [
        { name: "Skyr", grams: 300, state: "as_sold", kind: "product" },
        { name: "Haferflocken", grams: 80, state: "dry", kind: "generic", fdcQuery: "oats" },
      ],
    });
    expect(first.ingredients.map((i) => i.asked)).toEqual([
      ["history", "cache", "off"],
      ["history", "cache", "fdc"],
    ]);
    expect(first.ingredients[0]!.candidates[0]!.foundIn).toBe("off");
    expect(first.ingredients[1]!.candidates[0]!.foundIn).toBe("fdc");
    expect(fetchFake.calls.some((u) => u.includes("openfoodfacts"))).toBe(true);
    expect(fetchFake.calls.some((u) => u.includes("api.nal.usda.gov"))).toBe(true);
    expect(first.perPortionWithFirstCandidates.energyKcal).toBeGreaterThan(0);

    // eaten once: the Skyr is history now, and a strong history hit asks nothing else
    const skyr = first.ingredients[0]!.candidates[0]!;
    const meal = s.meals.create({});
    s.meals.addJson(meal.id, { kind: "text", text: "Skyr" });
    s.revisions.save({
      mealId: meal.id,
      runId: null,
      title: "Skyr",
      summary: "",
      eatenAt: null,
      assumptions: [],
      items: [
        { foodId: skyr.foodId, description: "Skyr", grams: 150, provenance: "database", confidence: "high" },
      ],
      questions: [],
    });
    fetchFake.calls.length = 0;
    const again = await ok<typeof first>(client, "match_ingredients", {
      ingredients: [{ name: skyr.name, grams: 300, state: "as_sold", kind: "product" }],
    });
    expect(again.ingredients[0]!.asked).toEqual(["history"]);
    expect(again.ingredients[0]!.candidates[0]).toMatchObject({ foodId: skyr.foodId, foundIn: "history" });
    expect(fetchFake.calls).toEqual([]);

    // known to the cache from the search above: no network either
    const oats = first.ingredients[1]!.candidates[0]!;
    const cached = await ok<typeof first>(client, "match_ingredients", {
      ingredients: [{ name: oats.name, grams: 80, state: "dry", kind: "generic" }],
    });
    expect(cached.ingredients[0]!.candidates[0]!.foodId).toBe(oats.foodId);
    expect(fetchFake.calls).toEqual([]);
  });

  test("the matcher ranks a processed product for a plain ingredient below the plain one, and says why", async () => {
    const client = await connect(s.mcpTokens.interactiveToken());
    const per100g = { energyKcal: 149, protein: 6.4, fat: 0.5, carbohydrate: 31, fiber: 2.1 };
    s.foods.create({
      source: "custom",
      name: "Knoblauch granuliert",
      per100g: { ...per100g, energyKcal: 340 },
    });
    const plain = s.foods.create({ source: "custom", name: "Knoblauch frisch", per100g }).id;
    const out = await ok<{
      ingredients: { candidates: { foodId: string; processed?: string[] }[]; warnings: string[] }[];
    }>(client, "match_ingredients", {
      ingredients: [{ name: "Knoblauch", grams: 8, state: "raw", kind: "generic" }],
    });
    const [garlic] = out.ingredients;
    expect(garlic!.candidates[0]!.foodId).toBe(plain);
    expect(garlic!.candidates[1]!.processed).toEqual(["granuliert"]);
  });
});

describe("save_starters (#48)", () => {
  /** A running round of a nightly request, with its run's token. */
  function nightlyRound() {
    const { request } = s.planningRequests.create({ filters: { count: 1 }, tz: TZ }, "nightly");
    const { round } = s.planningRequests.suggest(request.id);
    const runId = newId();
    s.repos.planningRuns.insert({
      id: runId,
      roundId: round.id,
      jobId: null,
      attempt: 1,
      harness: "custom",
      model: null,
      effort: null,
      startedAt: Date.now(),
    });
    s.planningRequests.startRound(round.id, runId);
    return { request, round, token: s.mcpTokens.mintPlanRun({ runId, roundId: round.id }) };
  }
  const starter = (over: Record<string, unknown> = {}) => ({
    kind: "other",
    text: "Something new",
    detail: "Made up",
    ...over,
  });

  test("a nightly round's 4–6 starters, references checked, a second save replacing the set", async () => {
    const meal = s.meals.create({});
    s.meals.addJson(meal.id, { kind: "text", text: "Lachs" });
    s.revisions.save({
      mealId: meal.id,
      runId: null,
      title: "Lachs mit Kartoffeln",
      summary: "",
      eatenAt: null,
      assumptions: [],
      items: [
        {
          description: "Lachs",
          grams: 150,
          estimatePer100g: { energyKcal: 200, protein: 20, fat: 13, carbohydrate: 0 },
          provenance: "estimate",
          confidence: "medium",
        },
      ],
      questions: [],
    });
    const { round, token } = nightlyRound();
    const client = await connect(token);
    // the context of a nightly round says what starters it wants; recent meals carry their ids
    const ctx = await ok<{
      nightly: { starters: { min: number; max: number; kinds: string[] } };
      recentMeals: { mealId: string; title: string }[];
    }>(client, "get_planning_context", { roundId: round.id });
    expect(ctx.nightly.starters).toMatchObject({ min: 4, max: 6 });
    expect(ctx.nightly.starters.kinds).toContain("protein_gap");
    expect(ctx.recentMeals.find((m) => m.title === "Lachs mit Kartoffeln")?.mealId).toBe(meal.id);

    expect((await call(client, "save_starters", { roundId: round.id, starters: [starter()] })).error).toMatch(
      /4|too small/,
    );
    const unknown = newId();
    expect(
      (
        await call(client, "save_starters", {
          roundId: round.id,
          starters: [starter({ kind: "variety", ref: { mealId: unknown } }), starter(), starter(), starter()],
        })
      ).error,
    ).toContain(`starters[0].ref.mealId: nothing has the id ${unknown}`);
    expect(
      (
        await call(client, "save_starters", {
          roundId: round.id,
          starters: [starter({ text: "x", ref: { leftoverId: unknown } }), starter(), starter(), starter()],
        })
      ).error,
    ).toContain("leftoverId");

    const first = await ok<{ saved: { position: number; kind: string }[] }>(client, "save_starters", {
      roundId: round.id,
      starters: [
        starter({ kind: "protein_gap", text: "High protein tonight", filters: { when: "today" } }),
        starter({ kind: "variety", text: "Fish again", ref: { mealId: meal.id } }),
        starter({ kind: "season", text: "Kürbis" }),
        starter(),
        starter(),
      ],
    });
    expect(first.saved.map((x) => x.kind)).toEqual(["protein_gap", "variety", "season", "other", "other"]);
    await ok(client, "save_starters", {
      roundId: round.id,
      starters: [
        starter({ kind: "variety", text: "Fish again", ref: { mealId: meal.id } }),
        starter({ kind: "protein_gap", text: "High protein tonight" }),
        starter({ kind: "season", text: "Kürbis" }),
        starter({ kind: "like_meal", text: "Like Lachs", ref: { mealId: meal.id } }),
      ],
    });
    // the view: the latest set, each reference read now (the app computes the number from it)
    const view = s.nightly.view();
    expect(view.starters.map((x) => [x.position, x.kind])).toEqual([
      [0, "variety"],
      [1, "protein_gap"],
      [2, "season"],
      [3, "like_meal"],
    ]);
    expect(view.starters[0]!.meal).toEqual({
      id: meal.id,
      title: "Lachs mit Kartoffeln",
      eatenAt: meal.eatenAt,
    });
    // removed since: the reference names nothing any more
    s.meals.remove(meal.id);
    expect(s.nightly.view().starters[0]!.meal).toBeNull();
    // older than STARTERS_MAX_AGE_MS: not offered
    s.repos.db.query("UPDATE planning_starters SET created_at = created_at - ?").run(49 * 3_600_000);
    expect(s.nightly.view().starters).toEqual([]);
  });

  test("only a nightly round saves starters", async () => {
    const { round, token } = runningRound();
    const r = await call(await connect(token), "save_starters", {
      roundId: round.id,
      starters: [starter(), starter(), starter(), starter()],
    });
    expect(r.error).toContain("starters come with the nightly run");
  });
});
