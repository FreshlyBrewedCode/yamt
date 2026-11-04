import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  ALGORITHM_VERSION,
  type ApiError,
  type CaptureResponse,
  type CurrentGoalResponse,
  type DayResponse,
  type GoalResponse,
  type GoalsResponse,
  goalInForce,
  goalPaths,
  goalPeriods,
  guidedLabel,
  type MealResponse,
  mealPaths,
  type ProfileResponse,
  profilePaths,
  type WeightEntryResponse,
  type WeightResponse,
  weightPaths,
} from "@yamt/shared";
import { IDENTITY_HEADER } from "../src/auth/identity.ts";
import { openDb } from "../src/db/index.ts";
import { GoalRepo } from "../src/db/repos/goals.ts";
import { dayRange, localDate } from "../src/domain/time.ts";
import { createServer } from "../src/server.ts";
import { tempDir } from "./helpers.ts";

const TZ = "Europe/Berlin";
const app = createServer({
  dataDir: join(tempDir(), "data"),
  port: 0,
  webDist: null,
  auth: { kind: "tailnet", login: "alice@example.com" },
  timeZone: TZ,
});
afterAll(() => app.stop());

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(new URL(path, app.localUrl), {
    method,
    headers: {
      [IDENTITY_HEADER]: "alice@example.com",
      origin: new URL(app.localUrl).origin,
      "content-type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

const targets = (energyKcal: number, protein: number | null = null) => ({ energyKcal, protein });

describe("goal in force", () => {
  // the repo's SQL and the shared function (the web app's) decide alike
  const db = openDb(join(tempDir(), "goals.db"));
  const repo = new GoalRepo(db);
  const t = { energyKcal: null, protein: null, fat: null, carbohydrate: null, fiber: null };
  const a = repo.insert({ effectiveFrom: "2026-10-01", targets: { ...t, energyKcal: 2500 }, note: "" });
  const b = repo.insert({ effectiveFrom: "2026-10-14", targets: { ...t, energyKcal: 2400 }, note: "" });
  // set twice on the same day: the later one wins, the first was never in force
  const c1 = repo.insert({ effectiveFrom: "2026-11-01", targets: { ...t, energyKcal: 2300 }, note: "" });
  const c2 = repo.insert({ effectiveFrom: "2026-11-01", targets: { ...t, energyKcal: 2200 }, note: "" });
  const goals = repo.list();

  test.each([
    ["2026-09-30", null],
    ["2026-10-01", a.id],
    ["2026-10-13", a.id],
    ["2026-10-14", b.id],
    ["2026-10-31", b.id],
    ["2026-11-01", c2.id],
    ["2027-01-01", c2.id],
  ])("on %s", (date, expected) => {
    expect(repo.inForce(date)?.id ?? null).toBe(expected);
    expect(goalInForce(goals, date)?.id ?? null).toBe(expected);
  });

  test("history newest first, with each goal's period", () => {
    expect(goals.map((g) => g.id)).toEqual([c2.id, c1.id, b.id, a.id]);
    expect(goalPeriods(goals).map((g) => [g.until, g.replaced])).toEqual([
      [null, false],
      [null, true],
      ["2026-10-31", false],
      ["2026-10-13", false],
    ]);
  });
});

describe("goals API", () => {
  test("needs the identity, writes our origin", async () => {
    expect((await fetch(new URL(goalPaths.goals, app.localUrl))).status).toBe(401);
    expect((await fetch(new URL(goalPaths.day("2026-11-03"), app.localUrl))).status).toBe(401);
    const cross = await call("POST", goalPaths.goals, targets(2000), { origin: "https://evil.example" });
    expect(cross.status).toBe(403);
  });

  test("new targets add a goal from today; a fix changes only the latest, in place", async () => {
    const today = localDate(Date.now(), TZ);
    expect((await call<CurrentGoalResponse>("GET", goalPaths.current)).body).toEqual({
      date: today,
      goal: null,
    });

    const old = await call<GoalResponse>("POST", goalPaths.goals, {
      ...targets(2500, 150),
      effectiveFrom: "2026-09-01",
    });
    expect(old.status).toBe(201);
    expect(old.body.goal.targets).toEqual({
      energyKcal: 2500,
      protein: 150,
      fat: null,
      carbohydrate: null,
      fiber: null,
    });
    const now = (await call<GoalResponse>("POST", goalPaths.goals, { ...targets(2400, 160), note: "cut" }))
      .body.goal;
    expect(now).toMatchObject({ effectiveFrom: today, note: "cut" });

    const history = (await call<GoalsResponse>("GET", goalPaths.goals)).body.goals;
    expect(history.map((g) => g.id)).toEqual([now.id, old.body.goal.id]);
    expect((await call<CurrentGoalResponse>("GET", goalPaths.current)).body.goal?.id).toBe(now.id);
    const then = await call<CurrentGoalResponse>("GET", `${goalPaths.current}?date=2026-10-01`);
    expect(then.body).toEqual({ date: "2026-10-01", goal: old.body.goal });

    // a typo fix: same row, same start date, new numbers
    const fixed = await call<GoalResponse>("PATCH", goalPaths.goal(now.id), {
      ...targets(2400, 165),
      note: "",
    });
    expect(fixed.status).toBe(200);
    expect(fixed.body.goal).toMatchObject({ id: now.id, effectiveFrom: today, note: "" });
    expect(fixed.body.goal.targets.protein).toBe(165);
    expect((await call<GoalsResponse>("GET", goalPaths.goals)).body.goals).toHaveLength(2);
    // history isn't rewritten
    const refused = await call<ApiError>("PATCH", goalPaths.goal(old.body.goal.id), targets(1));
    expect(refused.status).toBe(409);
    expect((await call("PATCH", goalPaths.goal("01900000-0000-7000-8000-000000000000"), {})).status).toBe(
      404,
    );
  });

  test("validates bodies and queries", async () => {
    for (const body of [
      { energyKcal: 0 },
      { energyKcal: 2000.5 },
      { protein: -1 },
      { energyKcal: "2000" },
      { effectiveFrom: "2026-13-01" },
      { kcal: 2000 },
    ]) {
      expect((await call("POST", goalPaths.goals, body)).status).toBe(400);
    }
    expect((await call("GET", `${goalPaths.current}?date=yesterday`)).status).toBe(400);
    expect((await call("GET", `${goalPaths.current}?tz=Mars/Olympus`)).status).toBe(400);
  });
});

describe("day endpoint", () => {
  test("meals, totals (unanalysed listed, not counted), goal in force, progress and weight", async () => {
    const date = "2026-10-20";
    const { from, to } = dayRange(date, TZ);
    const s = app.services;
    // the goal in force on that date, and a later one that must not apply
    const goal = (
      await call<GoalResponse>("POST", goalPaths.goals, {
        energyKcal: 2000,
        protein: 100,
        fat: 50,
        effectiveFrom: "2026-10-15",
      })
    ).body.goal;
    await call("POST", goalPaths.goals, { energyKcal: 1500, effectiveFrom: "2026-10-21" });

    const meal = async (eatenAt: number, text: string) => {
      const m = (await call<MealResponse>("POST", mealPaths.meals, { eatenAt })).body.meal;
      await call<CaptureResponse>("POST", mealPaths.captures(m.id), { kind: "text", text });
      return m;
    };
    const lunch = await meal(from + 12 * 3_600_000, "Pasta");
    s.revisions.save({
      mealId: lunch.id,
      runId: null,
      title: "Pasta",
      summary: "",
      eatenAt: null,
      assumptions: [],
      items: [
        {
          description: "Pasta",
          grams: 500,
          provenance: "estimate",
          confidence: "medium",
          estimatePer100g: { energyKcal: 300, protein: 12, fat: 12, carbohydrate: 35 },
        },
      ],
      questions: [],
    });
    const snack = await meal(from + 16 * 3_600_000, "Apfel");
    await meal(to, "the next day"); // not this day
    await meal(from - 1, "the day before");

    await call<WeightEntryResponse>("POST", weightPaths.weight, {
      kg: 80.4,
      measuredAt: from + 7 * 3_600_000,
    });
    await call<WeightEntryResponse>("POST", weightPaths.weight, { kg: 79.9, measuredAt: to + 1 });

    const res = await call<DayResponse>("GET", `${goalPaths.day(date)}?tz=${encodeURIComponent(TZ)}`);
    expect(res.status).toBe(200);
    const day = res.body;
    expect(day).toMatchObject({ date, timeZone: TZ, from, to, unanalysed: 1 });
    expect(day.meals.map((m) => m.id)).toEqual([snack.id, lunch.id]);
    expect(day.meals[1]).toMatchObject({ title: "Pasta" });
    expect(day.totals.nutrients).toMatchObject({ energyKcal: 1500, protein: 60, fat: 60 });
    expect(day.goal?.id).toBe(goal.id);
    expect(day.progress.energyKcal).toEqual({ eaten: 1500, target: 2000, left: 500, over: false });
    expect(day.progress.protein).toEqual({ eaten: 60, target: 100, left: 40, over: false });
    expect(day.progress.fat).toEqual({ eaten: 60, target: 50, left: -10, over: true });
    expect(day.progress.fiber).toEqual({ eaten: 0, target: null, left: null, over: false });
    expect(day.weight.map((w) => w.kg)).toEqual([80.4]);
  });

  test("an empty day without a goal; bad dates and zones are 400", async () => {
    const day = (await call<DayResponse>("GET", goalPaths.day("2001-01-01"))).body;
    expect(day).toMatchObject({ meals: [], unanalysed: 0, goal: null, weight: [], timeZone: TZ });
    expect(day.totals.nutrients.energyKcal).toBe(0);
    expect(day.progress.energyKcal).toEqual({ eaten: 0, target: null, left: null, over: false });
    expect((await call("GET", goalPaths.day("2026-02-30"))).status).toBe(400);
    expect((await call("GET", goalPaths.day("today"))).status).toBe(400);
    expect((await call("GET", `${goalPaths.day("2026-10-20")}?tz=Mars/Olympus`)).status).toBe(400);
  });

  test("days follow the zone asked for", async () => {
    // 23:30 in New York on 19 Oct is already the 20th in Berlin
    const eatenAt = Date.parse("2026-10-20T03:30:00Z");
    const m = (await call<MealResponse>("POST", mealPaths.meals, { eatenAt })).body.meal;
    await call("POST", mealPaths.captures(m.id), { kind: "text", text: "Spät" });
    const ny = (await call<DayResponse>("GET", `${goalPaths.day("2026-10-19")}?tz=America/New_York`)).body;
    expect(ny.meals.map((x) => x.id)).toContain(m.id);
    const berlin = (await call<DayResponse>("GET", goalPaths.day("2026-10-19"))).body;
    expect(berlin.meals.map((x) => x.id)).not.toContain(m.id);
  });
});

describe("guided goals and the profile (#24)", () => {
  // the research report's fixture: man, 30 y, 180 cm, 15 % body fat (weight from the log)
  const today = localDate(Date.now(), TZ);
  const profile = {
    sex: "male",
    birthYear: Number(today.slice(0, 4)) - 30,
    heightCm: 180,
    bodyFatPct: 15,
    dailyLife: "some_walking",
    training: { sessionsPerWeek: 3, minutes: 60, type: "strength", intensity: "moderate" },
  };
  const choices = { goal: "cut", pace: "standard", protein: "high", fatPercent: 30 } as const;
  // a server of its own: the weight log must start empty
  const guided = createServer({
    dataDir: join(tempDir(), "data"),
    port: 0,
    webDist: null,
    auth: { kind: "tailnet", login: "alice@example.com" },
    timeZone: TZ,
  });
  afterAll(() => guided.stop());
  async function req<T>(method: string, path: string, body?: unknown) {
    const res = await fetch(new URL(path, guided.localUrl), {
      method,
      headers: {
        [IDENTITY_HEADER]: "alice@example.com",
        origin: new URL(guided.localUrl).origin,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  }

  test("no profile at first; PUT saves one, GET reads it", async () => {
    expect((await req<ProfileResponse>("GET", profilePaths.profile)).body).toEqual({ profile: null });
    const put = await req<ProfileResponse>("PUT", profilePaths.profile, { ...profile, bodyFatPct: null });
    expect(put.status).toBe(200);
    expect(put.body.profile).toMatchObject({ ...profile, bodyFatPct: null });
    expect(typeof put.body.profile?.updatedAt).toBe("number");
    for (const bad of [
      { ...profile, sex: "other" },
      { ...profile, training: { ...profile.training, minutes: 50 } },
      { ...profile, training: { ...profile.training, sessionsPerWeek: 8 } },
      { ...profile, heightCm: 30 },
      { ...profile, extra: 1 },
    ]) {
      expect((await req("PUT", profilePaths.profile, bad)).status).toBe(400);
    }
  });

  test("without a weight in the log or the body: 400; a refusal saves nothing", async () => {
    const none = await req<ApiError>("POST", profilePaths.guidedGoal, { profile, choices });
    expect(none.status).toBe(400);
    expect(none.body.error).toContain("no weight logged");
    const young = await req<ApiError>("POST", profilePaths.guidedGoal, {
      profile: { ...profile, birthYear: Number(today.slice(0, 4)) - 16 },
      choices,
      weightKg: 80,
    });
    expect(young.status).toBe(422);
    expect(young.body).toMatchObject({ hint: "under_18" });
    const pregnant = await req<ApiError>("POST", profilePaths.guidedGoal, {
      profile: { ...profile, sex: "female" },
      choices,
      weightKg: 80,
      pregnantOrBreastfeeding: true,
    });
    expect(pregnant.status).toBe(422);
    // all or nothing: no weight logged, no goal, the profile as it was
    expect((await req<WeightResponse>("GET", weightPaths.weight)).body.entries).toEqual([]);
    expect((await req<GoalsResponse>("GET", goalPaths.goals)).body.goals).toEqual([]);
    expect((await req<ProfileResponse>("GET", profilePaths.profile)).body.profile?.bodyFatPct).toBeNull();
  });

  test("calculated on the server: logs the weight, saves the profile, adds a goal from today with its derivation", async () => {
    const res = await req<GoalResponse>("POST", profilePaths.guidedGoal, {
      profile,
      choices,
      weightKg: 80,
      effectiveFrom: today,
    });
    expect(res.status).toBe(201);
    const goal = res.body.goal;
    expect(goal).toMatchObject({ effectiveFrom: today, note: "" });
    expect(goal.targets).toEqual({ energyKcal: 2660, protein: 160, fat: 90, carbohydrate: 285, fiber: 35 });
    const d = goal.derivation!;
    expect(d.version).toBe(ALGORITHM_VERSION);
    expect(d.weight).toMatchObject({ kg: 80, basis: "latest", count: 1 });
    expect(d.inputs).toMatchObject({ ...profile, weightKg: 80, today, pregnantOrBreastfeeding: false });
    expect(d.choices).toEqual(choices);
    expect(d.result).toMatchObject({
      rmr: { kcal: 1996, equation: "cunningham" },
      maintenance: { kcal: 3100 },
    });
    expect(d.result.lines.protein).toBe("160 g ≈ 2.0 g/kg, protects muscle while cutting (Helms 2014, ISSN)");
    expect(guidedLabel(d)).toBe("Guided · cut, standard pace");

    expect((await req<WeightResponse>("GET", weightPaths.weight)).body.entries.map((e) => e.kg)).toEqual([
      80,
    ]);
    expect((await req<ProfileResponse>("GET", profilePaths.profile)).body.profile).toMatchObject(profile);
    const history = (await req<GoalsResponse>("GET", goalPaths.goals)).body.goals;
    expect(history.map((g) => g.id)).toEqual([goal.id]);
    expect(history[0]?.derivation?.result.targets).toEqual(goal.targets);
  });

  test("the weight comes from the log: the 7-day mean once there are four entries", async () => {
    for (const kg of [81, 82, 83]) await req("POST", weightPaths.weight, { kg });
    const res = await req<GoalResponse>("POST", profilePaths.guidedGoal, {
      profile,
      choices: { ...choices, goal: "maintain" },
    });
    expect(res.status).toBe(201);
    expect(res.body.goal.derivation?.weight).toMatchObject({ kg: 81.5, basis: "average", count: 4 });
  });

  test("validates choices; a typo fix that changes targets drops the derivation, a note-only fix keeps it", async () => {
    for (const bad of [
      { ...choices, fatPercent: 33 },
      { ...choices, fatPercent: 45 },
      { ...choices, protein: "extreme" },
      { ...choices, goal: "recomp" },
    ]) {
      expect((await req("POST", profilePaths.guidedGoal, { profile, choices: bad })).status).toBe(400);
    }
    const goal = (await req<GoalsResponse>("GET", goalPaths.goals)).body.goals[0]!;
    const noteOnly = await req<GoalResponse>("PATCH", goalPaths.goal(goal.id), {
      ...goal.targets,
      note: "from the guide",
    });
    expect(noteOnly.body.goal.derivation).not.toBeNull();
    const changed = await req<GoalResponse>("PATCH", goalPaths.goal(goal.id), {
      ...goal.targets,
      protein: 170,
      note: "",
    });
    expect(changed.body.goal.derivation).toBeNull();
  });
});
