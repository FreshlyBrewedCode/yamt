import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type ApiError,
  calendarPaths,
  classifyDay,
  classifyWeek,
  type GoalResponse,
  goalPaths,
  type MealResponse,
  type MonthResponse,
  mealPaths,
  profilePaths,
  weightPaths,
} from "@yamt/shared";
import { IDENTITY_HEADER } from "../src/auth/identity.ts";
import { CalendarService } from "../src/domain/calendar.ts";
import { dayRange } from "../src/domain/time.ts";
import { type AppServer, createServer } from "../src/server.ts";
import { tempDir } from "./helpers.ts";

// The calendar's month endpoint (#33). Made-up meals, goals and weights; each describe gets a
// server of its own, since goals apply to every later day.

const TZ = "Europe/Berlin";
const HOUR = 3_600_000;

function server(): AppServer {
  return createServer({
    dataDir: join(tempDir(), "data"),
    port: 0,
    webDist: null,
    auth: { kind: "tailnet", login: "alice@example.com" },
    timeZone: TZ,
  });
}

function client(app: AppServer) {
  return async function call<T>(method: string, path: string, body?: unknown) {
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
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
}

/** Helpers over one server: meals at a local time, analysed with one item of `kcal`. */
function seed(app: AppServer) {
  const call = client(app);
  const at = (date: string, hour: number, tz = TZ) => dayRange(date, tz).from + hour * HOUR;
  async function meal(eatenAt: number, kcal: number | null, text = "Essen") {
    const m = (await call<MealResponse>("POST", mealPaths.meals, { eatenAt })).body.meal;
    await call("POST", mealPaths.captures(m.id), { kind: "text", text });
    if (kcal !== null) {
      app.services.revisions.save({
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
            // 10 % of the kcal as protein, the rest made up
            estimatePer100g: { energyKcal: kcal, protein: kcal / 40, fat: 10, carbohydrate: 50 },
          },
        ],
        questions: [],
      });
    }
    return m.id;
  }
  const goal = async (effectiveFrom: string, energyKcal: number | null, protein: number | null = null) =>
    (await call<GoalResponse>("POST", goalPaths.goals, { energyKcal, protein, effectiveFrom })).body.goal;
  const weight = (measuredAt: number, kg: number) => call("POST", weightPaths.weight, { kg, measuredAt });
  const month = async (m: string, tz?: string) =>
    (
      await call<MonthResponse>(
        "GET",
        `${calendarPaths.month(m)}${tz ? `?tz=${encodeURIComponent(tz)}` : ""}`,
      )
    ).body;
  return { call, at, meal, goal, weight, month };
}

describe("a month", () => {
  const app = server();
  afterAll(() => app.stop());
  const { call, at, meal, weight, month } = seed(app);

  test("days: analysed meals counted, unanalysed listed, empty drafts and other months left out", async () => {
    await meal(at("2026-09-08", 8), 600, "Frühstück");
    await meal(at("2026-09-08", 13), 900, "Mittag");
    await meal(at("2026-09-08", 19), null, "Abendessen, noch nicht analysiert");
    await call("POST", mealPaths.meals, { eatenAt: at("2026-09-08", 20) }); // a draft with nothing in it
    await meal(at("2026-09-10", 12), null); // only an unanalysed meal
    await meal(at("2026-10-01", 1), 999); // October

    const m = await month("2026-09", TZ);
    expect(m).toMatchObject({ month: "2026-09", timeZone: TZ });
    expect(m.days).toHaveLength(30);
    expect(m.days[0]!.date).toBe("2026-09-01");
    expect(m.days.at(-1)!.date).toBe("2026-09-30");
    const day8 = m.days.find((d) => d.date === "2026-09-08")!;
    expect(day8).toMatchObject({ meals: 3, unanalysed: 1, goal: null, weightKg: null });
    expect(day8.totals?.nutrients).toMatchObject({ energyKcal: 1500, protein: 37.5 });
    expect(m.days.find((d) => d.date === "2026-09-10")).toMatchObject({
      meals: 1,
      unanalysed: 1,
      totals: null,
    });
    expect(m.days.find((d) => d.date === "2026-09-09")).toMatchObject({
      meals: 0,
      unanalysed: 0,
      totals: null,
    });
    // no goal: the days have kcal but nothing to classify
    expect(classifyDay(m.weeks[1]!.days[1])).toMatchObject({ band: "none" });
    expect(m.weeks[1]!.days[1]).toEqual({ kcal: 1500, target: null, goalKind: null, floor: null });
  });

  test("a copy (logged again) counts like an analysed meal", async () => {
    const source = await meal(at("2026-09-15", 12), 700, "Curry");
    const res = await call("POST", mealPaths.repeat(source), {
      factor: 2,
      eatenAt: at("2026-09-16", 12),
      tz: TZ,
    });
    expect(res.status).toBe(201);
    const m = await month("2026-09", TZ);
    expect(m.days.find((d) => d.date === "2026-09-16")).toMatchObject({ meals: 1, unanalysed: 0 });
    expect(m.days.find((d) => d.date === "2026-09-16")!.totals?.nutrients.energyKcal).toBe(1400);
  });

  test("weeks are whole: Monday to Sunday, the neighbouring months' days included", async () => {
    // September 2026 starts on a Tuesday and ends on a Wednesday
    const m = await month("2026-09", TZ);
    expect(m.weeks.map((w) => w.start)).toEqual([
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
    expect(m.weeks.every((w) => w.days.length === 7)).toBe(true);
    // the last week reaches into October: 1 Oct's meal is in it, though not in the month's days
    expect(m.weeks[4]!.days[3]).toMatchObject({ kcal: 999 });
    expect(m.days.some((d) => d.date === "2026-10-01")).toBe(false);
  });

  test("bad months and zones are 400; the server's zone by default", async () => {
    expect((await call<ApiError>("GET", calendarPaths.month("2026-13"))).status).toBe(400);
    expect((await call<ApiError>("GET", calendarPaths.month("2026-9"))).status).toBe(400);
    expect((await call<ApiError>("GET", calendarPaths.month("2026-09-01"))).status).toBe(400);
    expect((await call<ApiError>("GET", `${calendarPaths.month("2026-09")}?tz=Mars/Olympus`)).status).toBe(
      400,
    );
    // the server's zone by default
    expect((await month("2026-09")).timeZone).toBe(TZ);
  });

  test("weight: the day's mean and the 7-day average, whole from the 1st", async () => {
    await weight(at("2026-09-27", 7), 82); // in the week before October
    await weight(at("2026-10-02", 7), 81);
    await weight(at("2026-10-02", 21), 80); // twice on one day: their mean
    await weight(at("2026-10-12", 7), 79);
    const m = await month("2026-10", TZ);
    expect(m.weight).toEqual([
      { date: "2026-10-02", kg: 80.5, avg: 81.25 },
      { date: "2026-10-12", kg: 79, avg: 79 },
    ]);
    expect(m.days.find((d) => d.date === "2026-10-02")!.weightKg).toBe(80.5);
  });
});

describe("goals in a month", () => {
  const app = server();
  afterAll(() => app.stop());
  const { call, at, meal, goal, month } = seed(app);

  test("a manual goal before a profile: maintain range, 'Manual targets', no floor", async () => {
    await goal("2026-09-07", 2600, 150);
    await meal(at("2026-09-08", 12), 2500);
    const m = await month("2026-09", TZ);
    expect(m.days.find((d) => d.date === "2026-09-06")!.goal).toBeNull();
    expect(m.days.find((d) => d.date === "2026-09-08")!.goal).toMatchObject({
      effectiveFrom: "2026-09-07",
      kind: null,
      label: "Manual targets",
      floorKcal: null,
      targets: { energyKcal: 2600, protein: 150 },
    });
    expect(m.weeks[1]!.days[1]).toEqual({ kcal: 2500, target: 2600, goalKind: "maintain", floor: null });
  });

  test("a guided cut from mid-week: its kind, label and floor; each day against its own goal", async () => {
    const profile = {
      sex: "male",
      birthYear: 1990,
      heightCm: 180,
      bodyFatPct: null,
      dailyLife: "some_walking",
      training: { sessionsPerWeek: 0, minutes: 60, type: "strength", intensity: "moderate" },
    };
    const res = await call<GoalResponse>("POST", profilePaths.guidedGoal, {
      profile,
      choices: { goal: "cut", pace: "standard", protein: "high", fatPercent: 30 },
      pregnantOrBreastfeeding: false,
      weightKg: 82,
      effectiveFrom: "2026-10-14", // a Wednesday
    });
    expect(res.status).toBe(201);
    const cut = res.body.goal;
    const target = cut.targets.energyKcal!;
    await meal(at("2026-10-12", 12), 2600); // Monday: maintain, on target
    await meal(at("2026-10-13", 12), 2860); // Tuesday: maintain, +10 %
    await meal(at("2026-10-14", 12), Math.round(target * 0.9)); // Wednesday: the cut, −10 %

    const m = await month("2026-10", TZ);
    const day = (date: string) => m.days.find((d) => d.date === date)!;
    expect(day("2026-10-13").goal).toMatchObject({ kind: null, label: "Manual targets", floorKcal: 1500 }); // the profile's sex now
    expect(day("2026-10-14").goal).toMatchObject({
      id: cut.id,
      kind: "cut",
      label: "Cut, standard pace",
      floorKcal: cut.derivation!.result.kcal.floor,
    });
    const week = m.weeks.find((w) => w.start === "2026-10-12")!;
    expect(week.days.slice(0, 3).map((d) => [d?.target, d?.goalKind])).toEqual([
      [2600, "maintain"],
      [2600, "maintain"],
      [target, "cut"],
    ]);
    // shares 1.0, 1.1 and 0.9: a mean of 1.0, judged by the cut (the last counted day's goal)
    expect(classifyWeek(week.days)).toMatchObject({ band: "on", direction: null, days: 3 });
    expect(classifyDay(week.days[1])).toMatchObject({ band: "on", direction: "over" });
  });

  test("a goal without a kcal target: the days stay unclassified", async () => {
    await goal("2026-12-01", null, 140);
    await meal(at("2026-12-02", 12), 1800);
    const m = await month("2026-12", TZ);
    expect(m.days.find((d) => d.date === "2026-12-02")!.goal?.targets).toMatchObject({ energyKcal: null });
    expect(classifyDay(m.weeks[0]!.days[1])).toMatchObject({ band: "none" });
  });
});

describe("time zones and today", () => {
  const app = server();
  afterAll(() => app.stop());
  const { meal, month } = seed(app);

  test("a meal late on the last evening of a month in New York is the next month's in Berlin", async () => {
    // 23:30 on 31 Oct in New York is 04:30 on 1 Nov in Berlin
    await meal(Date.parse("2026-11-01T03:30:00Z"), 800, "Spät");
    const ny = await month("2026-10", "America/New_York");
    expect(ny.days.find((d) => d.date === "2026-10-31")!.totals?.nutrients.energyKcal).toBe(800);
    const berlinOct = await month("2026-10", TZ);
    expect(berlinOct.days.find((d) => d.date === "2026-10-31")!.totals).toBeNull();
    const berlinNov = await month("2026-11", TZ);
    expect(berlinNov.days[0]!.totals?.nutrients.energyKcal).toBe(800);
  });

  test("today: later days are the future, left out of weeks and the summary", async () => {
    const calendar = new CalendarService(app.services.repos, TZ, () => Date.parse("2026-11-01T12:00:00Z"));
    const nov = calendar.month("2026-11");
    expect(nov.today).toBe("2026-11-01");
    expect(nov.summary).toMatchObject({ days: 1, tracked: 1, avgKcal: 800, kcalShare: null, goal: null });
    // 1 Nov 2026 is a Sunday: the week before has it last, every later week is all future
    expect(nov.weeks[0]!.days[6]).toMatchObject({ kcal: 800 });
    expect(nov.weeks.slice(1).every((w) => w.days.every((d) => d === null))).toBe(true);
    const later = calendar.month("2027-01");
    expect(later.summary).toMatchObject({ days: 0, tracked: 0, avgKcal: null });
  });
});

describe("the summary", () => {
  const app = server();
  afterAll(() => app.stop());
  const { at, meal, goal, month } = seed(app);

  test("days tracked, the mean kcal share against each day's own target, averages", async () => {
    await meal(at("2026-08-03", 12), 1000); // before any goal: kcal only
    await goal("2026-08-10", 2000, 100);
    await meal(at("2026-08-11", 12), 1800); // 90 %
    await meal(at("2026-08-12", 12), 2200); // 110 %
    await goal("2026-08-20", 2500, 150);
    await meal(at("2026-08-21", 12), 2500); // 100 %
    await meal(at("2026-08-22", 12), null); // tracked, not counted
    const m = await month("2026-08", TZ);
    expect(m.summary).toMatchObject({
      days: 31,
      tracked: 5,
      avgKcal: 1875, // (1000 + 1800 + 2200 + 2500) / 4
      kcalShare: 1, // (0.9 + 1.1 + 1.0) / 3; the day without a goal has no share
      avgProtein: 46.9, // a fortieth of the kcal
    });
    expect(m.summary.goal?.targets).toMatchObject({ energyKcal: 2500, protein: 150 });
  });
});
