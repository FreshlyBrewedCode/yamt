import { describe, expect, test } from "bun:test";
import type {
  NutrientTotals,
  PlanDay,
  PlanGoal,
  PlanningRequest,
  PlanningRequestSummary,
  PlanningRoundTally,
  PlanningRoundView,
  PlanningSuggestionView,
  RepeatableMeal,
} from "@yamt/shared";
import {
  askedWords,
  draftDays,
  draftProblem,
  filterDefaults,
  groupStripRows,
  isPastRequest,
  pickTarget,
  requestSentence,
  requestState,
  resolveDraft,
  restOfWeek,
  roundMeta,
  stripRows,
  summaryWords,
} from "../src/lib/plan-request";
import { computeStarters, type LastRequest } from "../src/lib/starters";

// The planning request on the phone (#47) with made-up days: the filters' defaults and summary,
// the sentence the agent reads, where Pick goes, a round's meta, and the code-computed starters.
// 2026-11-06 is a Friday.

const TODAY = "2026-11-06";
const settings = { count: 4, sourceMode: "published" as const, portionsCooked: 2 };
const defaults = filterDefaults(settings);

const totals = (energyKcal: number, protein = 0): NutrientTotals => ({
  grams: 0,
  items: 1,
  nutrients: { energyKcal, protein, fat: 0, saturatedFat: 0, carbohydrate: 0, sugars: 0, fiber: 0, salt: 0 },
});

const goal = (protein: number | null): PlanGoal => ({
  id: "g",
  effectiveFrom: "2026-01-01",
  targets: { energyKcal: 2200, protein, fat: null, carbohydrate: null, fiber: null },
  kind: "cut",
  label: "Cut, standard pace",
  floorKcal: 1500,
});

const day = (more: Partial<PlanDay> = {}): PlanDay => ({
  date: TODAY,
  plannedMeals: [],
  meals: [],
  unanalysed: 0,
  eaten: null,
  projected: null,
  goal: goal(160),
  openSlots: ["breakfast", "lunch", "dinner"],
  mostlyKnown: false,
  ...more,
});

describe("filters", () => {
  test("defaults: tonight's dinner with Settings → Planning's count, source and portions", () => {
    const f = resolveDraft({}, defaults, TODAY);
    expect(f).toEqual({
      days: [TODAY],
      slots: ["dinner"],
      timeCapMin: null,
      constraints: [],
      useUp: [],
      sourceMode: "published",
      portionsCooked: 2,
      count: 4,
    });
    // before the settings load: #51's PLANNING_DEFAULTS
    expect(resolveDraft({}, filterDefaults(undefined), TODAY)).toMatchObject({
      count: 3,
      sourceMode: "adapted",
    });
  });

  test("when: today, tomorrow, the rest of the week, or days picked (sorted, none in the past)", () => {
    expect(draftDays({ when: "tomorrow" }, TODAY)).toEqual(["2026-11-07"]);
    expect(draftDays({ when: "week" }, TODAY)).toEqual(["2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(restOfWeek("2026-11-08")).toEqual(["2026-11-08"]); // Sunday
    expect(restOfWeek("2026-11-02")).toHaveLength(7); // Monday
    expect(draftDays({ when: "days", days: ["2026-11-09", "2026-11-05", "2026-11-07"] }, TODAY)).toEqual([
      "2026-11-07",
      "2026-11-09",
    ]);
    const none = resolveDraft({ when: "days", days: [] }, defaults, TODAY);
    expect(draftProblem(none)).toBe("Pick a day in the filters.");
    expect(draftProblem(resolveDraft({}, defaults, TODAY))).toBeNull();
  });

  test("the summary says when and which meals, then only what differs from the defaults", () => {
    expect(summaryWords(resolveDraft({}, defaults, TODAY), defaults, TODAY)).toEqual([
      "Tonight",
      "Dinner",
      "cook 2",
    ]);
    const f = resolveDraft(
      {
        when: "days",
        days: ["2026-11-07", "2026-11-08", "2026-11-09"],
        slots: ["dinner", "lunch"],
        timeCapMin: 30,
        constraints: ["no_oven", "ohne Pilze"],
        useUp: ["½ Hokkaido"],
        sourceMode: "adapted",
        portionsCooked: 1,
        count: 3,
      },
      defaults,
      TODAY,
    );
    expect(summaryWords(f, defaults, TODAY)).toEqual([
      "Sat–Mon",
      "Lunch + Dinner",
      "≤ 30 min",
      "No oven",
      "ohne Pilze",
      "use ½ Hokkaido",
      "based on a real recipe",
      "3 ideas",
    ]);
    expect(summaryWords(resolveDraft({ slots: ["lunch"] }, defaults, TODAY), defaults, TODAY)[0]).toBe(
      "Today",
    );
  });

  test("a request's chips in the thread name weekdays (its days are absolute), the source and count", () => {
    const f = resolveDraft({}, defaults, TODAY);
    expect(askedWords(f, TODAY)).toEqual(["Fri", "Dinner", "cook 2", "real recipes only", "4 per round"]);
    const week = resolveDraft({ when: "week" }, defaults, TODAY);
    expect(askedWords(week, TODAY)[0]).toBe("Fri–Sun");
  });

  test("the sentence the agent reads", () => {
    expect(requestSentence(resolveDraft({}, defaults, TODAY), TODAY)).toBe(
      "Dinner tonight. 4 suggestions, real recipes only, 2 portions each (eat one, keep the rest).",
    );
    const f = resolveDraft(
      {
        when: "week",
        timeCapMin: 45,
        constraints: ["no_oven", "vegetarian"],
        useUp: ["½ Hokkaido", "Feta"],
        sourceMode: "composed",
        portionsCooked: 1,
        count: 2,
      },
      defaults,
      TODAY,
    );
    expect(requestSentence(f, TODAY)).toBe(
      "Dinners Fri–Sun, ≤ 45 min total, no oven, vegetarian, using ½ Hokkaido and Feta. 2 suggestions, free recipes, one portion each.",
    );
    expect(
      requestSentence(resolveDraft({ when: "tomorrow", slots: ["lunch", "dinner"] }, defaults, TODAY), TODAY),
    ).toMatch(/^Lunch and dinner tomorrow\./);
  });
});

describe("pickTarget", () => {
  const request = { filters: resolveDraft({ when: "week" }, defaults, TODAY) };
  const s = (proposedDate: string | null, proposedSlot: "dinner" | "lunch" | null = "dinner") => ({
    proposedDate,
    proposedSlot,
  });

  test("the proposed day and slot, unless the day is past", () => {
    expect(pickTarget(s("2026-11-07"), request, undefined, TODAY)).toEqual({
      date: "2026-11-07",
      slot: "dinner",
    });
    // past: the first of the request's days with that slot open
    const days = [day({ openSlots: ["breakfast", "lunch"] }), day({ date: "2026-11-07" })];
    expect(pickTarget(s("2026-11-05"), request, days, TODAY)).toEqual({ date: "2026-11-07", slot: "dinner" });
  });

  test("without a proposal: the next open slot of the request; all filled, the first", () => {
    const full = [TODAY, "2026-11-07", "2026-11-08"].map((date) => day({ date, openSlots: [] }));
    expect(pickTarget(s(null, null), request, full, TODAY)).toEqual({ date: TODAY, slot: "dinner" });
    const snack = {
      filters: { ...request.filters, slots: ["snack" as const] },
    };
    expect(pickTarget(s(null, null), snack, full, TODAY)).toEqual({ date: TODAY, slot: "snack" });
  });
});

describe("roundMeta", () => {
  const sugg = (status: PlanningSuggestionView["status"]) => ({ status }) as PlanningSuggestionView;
  const round = (status: PlanningRoundView["status"], list: PlanningSuggestionView["status"][]) =>
    ({ status, count: 3, suggestions: list.map(sugg) }) as unknown as PlanningRoundView;
  test("how far a round is", () => {
    expect(roundMeta(round("queued", []))).toBe("Queued");
    expect(roundMeta(round("running", []))).toBe("Outlining…");
    expect(roundMeta(round("running", ["ready", "outlined", "outlined"]))).toBe("1 of 3 ready");
    expect(roundMeta(round("done", ["ready", "ready", "failed"]))).toBe("2 of 3 · 1 couldn't");
    expect(roundMeta(round("done", ["ready", "ready", "ready"]))).toBe("3 suggestions");
    expect(roundMeta(round("failed", ["failed", "failed", "failed"]))).toBe("Failed");
  });
});

describe("the overview strip", () => {
  const req = (id: string, title: string, days: string[]): PlanningRequest => ({
    id,
    title,
    origin: "user",
    filters: {
      days,
      slots: ["dinner"],
      timeCapMin: null,
      constraints: [],
      useUp: [],
      sourceMode: "published",
      portionsCooked: 1,
      count: 2,
    },
    timeZone: "Europe/Berlin",
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
  });
  const round = (over: Partial<PlanningRoundTally> = {}): PlanningRoundTally => ({
    id: "r",
    number: 1,
    kind: "first",
    status: "done",
    count: 2,
    outlined: 2,
    ready: 2,
    failed: 0,
    picked: 0,
    rejected: 0,
    ...over,
  });
  const summary = (
    id: string,
    title: string,
    days: string[],
    over: Partial<Pick<PlanningRequestSummary, "latestRound" | "inputs" | "pendingInputs">> = {},
  ): PlanningRequestSummary => ({
    request: req(id, title, days),
    latestRound: null,
    inputs: 0,
    pendingInputs: 0,
    ...over,
  });

  test("requestState reads a round and pending inputs", () => {
    expect(requestState(summary("a", "Dinner Fri", ["2026-11-06"]))).toBeNull();
    expect(requestState(summary("a", "Dinner Fri", ["2026-11-06"], { pendingInputs: 1 }))).toMatchObject({
      kind: "suggesting",
      label: "Queued",
    });
    expect(
      requestState(
        summary("a", "Dinner Fri", ["2026-11-06"], { latestRound: round({ status: "running", ready: 1 }) }),
      ),
    ).toMatchObject({ kind: "suggesting", label: "Suggesting · 1 of 2 ready" });
    expect(
      requestState(summary("a", "Dinner Fri", ["2026-11-06"], { latestRound: round({ status: "failed" }) })),
    ).toMatchObject({ kind: "failed", label: "Failed" });
    expect(requestState(summary("a", "Dinner Fri", ["2026-11-06"], { latestRound: round() }))).toMatchObject({
      kind: "waiting",
      label: "Suggested · 2 for you",
    });
    expect(
      requestState(
        summary("a", "Dinner Fri", ["2026-11-06"], {
          latestRound: round({ picked: 1, rejected: 1 }),
          pendingInputs: 1,
        }),
      ),
    ).toMatchObject({ kind: "added", label: "1 addition · suggest with it" });
    expect(
      requestState(summary("a", "Dinner Fri", ["2026-11-06"], { latestRound: round({ picked: 2 }) })),
    ).toBeNull();
  });

  test("isPastRequest: every filter day before today", () => {
    expect(isPastRequest(summary("a", "Dinner Thu", ["2026-11-05"]), TODAY)).toBe(true);
    expect(isPastRequest(summary("a", "Dinner Fri", ["2026-11-06"]), TODAY)).toBe(false);
    expect(isPastRequest(summary("a", "Dinners Thu-Fri", ["2026-11-05", "2026-11-06"]), TODAY)).toBe(false);
  });

  test("stripRows drops past requests and ones that want nothing", () => {
    const requests = [
      summary("past", "Dinner Thu", ["2026-11-05"], { latestRound: round() }),
      summary("waiting", "Dinner Fri", ["2026-11-06"], { latestRound: round() }),
      summary("done", "Lunch Fri", ["2026-11-06"], { latestRound: round({ picked: 2 }) }),
    ];
    expect(stripRows(requests, TODAY).map((row) => row.r.request.id)).toEqual(["waiting"]);
  });

  test("groupStripRows keeps a lone state as its own row, folds several", () => {
    const rows = stripRows(
      [
        summary("w1", "Dinner Fri", ["2026-11-06"], { latestRound: round() }),
        summary("w2", "Dinner Sat", ["2026-11-07"], { latestRound: round() }),
        summary("f1", "Lunch Sat", ["2026-11-07"], { latestRound: round({ status: "failed" }) }),
      ],
      TODAY,
    );
    const groups = groupStripRows(rows);
    expect(groups.map((g) => g.kind)).toEqual(["waiting", "failed"]);
    expect(groups[0]!.rows).toHaveLength(2);
    expect(groups[0]!.rows.map((r) => r.r.request.title)).toEqual(["Dinner Fri", "Dinner Sat"]);
    expect(groups[1]!.rows).toHaveLength(1);
  });
});

describe("starters", () => {
  const now = new Date(`${TODAY}T15:00:00`).getTime();
  const repeatable: RepeatableMeal[] = [
    { mealId: "a", title: "Haferbrei", eatenAt: now - 3600_000, times: 3, totals: totals(420, 20) },
    { mealId: "b", title: "Linsen-Dal", eatenAt: now - 86_400_000, times: 3, totals: totals(760, 41) },
    { mealId: "c", title: "Toast", eatenAt: now, times: 1, totals: totals(200, 5) },
  ];

  test("protein open tonight, the meal logged most, the season; each from real data", () => {
    const days = [day({ projected: totals(1100, 78), meals: [] })];
    const s = computeStarters({ today: TODAY, now, days, repeatable, last: null });
    expect(s.map((x) => x.id)).toEqual(["protein", "again", "season"]);
    expect(s[0]).toMatchObject({
      number: "82",
      unit: "g protein open tonight",
      text: "High protein tonight",
      why: "1,100 kcal left of 2,200",
      draft: { when: "today", slots: ["dinner"], constraints: ["high_protein"] },
    });
    // a tie on times: the later one
    expect(s[1]).toMatchObject({ number: "3×", text: "Like Haferbrei, but different" });
    expect(s[2]).toMatchObject({ number: "Nov", unit: "Kürbis, Grünkohl, Rosenkohl, Birnen" });
  });

  test("tonight's dinner taken: tomorrow; no protein target: kcal; no goal: no number at all", () => {
    const today = day({ openSlots: ["breakfast"], projected: totals(2000, 150) });
    const tomorrow = day({ date: "2026-11-07" });
    expect(
      computeStarters({ today: TODAY, now, days: [today, tomorrow], repeatable: [], last: null })[0],
    ).toMatchObject({
      id: "protein",
      unit: "g protein open tomorrow",
      number: "160",
      draft: { when: "tomorrow" },
    });
    const kcal = computeStarters({
      today: TODAY,
      now,
      days: [day({ goal: goal(null), projected: totals(700) })],
      repeatable: [],
      last: null,
    });
    expect(kcal[0]).toMatchObject({ id: "kcal", number: "1,500", unit: "kcal open tonight" });
    const none = computeStarters({
      today: TODAY,
      now,
      days: [day({ goal: null })],
      repeatable: [],
      last: null,
    });
    expect(none.map((x) => x.id)).toEqual(["season"]);
  });

  test("the last request: its filters again from today, its text in the composer", () => {
    const last: LastRequest = {
      request: {
        id: "r",
        title: "Dinners Tue–Thu",
        origin: "user",
        filters: {
          days: ["2026-11-03", "2026-11-04", "2026-11-05"],
          slots: ["dinner"],
          timeCapMin: 40,
          constraints: ["no_oven"],
          useUp: [{ text: "½ Hokkaido" }],
          sourceMode: "adapted",
          portionsCooked: 2,
          count: 3,
        },
        timeZone: "Europe/Berlin",
        archivedAt: null,
        createdAt: new Date("2026-11-03T15:41:00").getTime(),
        updatedAt: 0,
      },
      text: "Irgendwas mit Kürbis",
      picked: 2,
      suggested: 6,
    };
    const s = computeStarters({ today: TODAY, now, days: [], repeatable: [], last }).find(
      (x) => x.id === "last",
    );
    expect(s).toMatchObject({
      number: "Tue",
      text: "Dinners Tue–Thu, like last time",
      why: "2 picked of 6 suggestions · reuses its filters",
      composerText: "Irgendwas mit Kürbis",
      draft: {
        when: "days",
        days: ["2026-11-06", "2026-11-07", "2026-11-08"],
        timeCapMin: 40,
        constraints: ["no_oven"],
        useUp: ["½ Hokkaido"],
        portionsCooked: 2,
      },
    });
  });
});
