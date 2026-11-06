import { describe, expect, test } from "bun:test";
import type {
  NutrientTotals,
  PlanDay,
  PlanningRequestDetail,
  PlanningRoundView,
  PlanningStarterView,
  PlanningSuggestionView,
  RepeatableMeal,
} from "@yamt/shared";
import {
  nightlyPickWords,
  nightlyRows,
  nightlyState,
  nightlyStripRow,
  nightlyTitle,
} from "../src/lib/nightly";
import { stripRows } from "../src/lib/plan-request";
import { computeStarters, liveNumber, MAX_SHOWN_STARTERS, type StarterInput } from "../src/lib/starters";

// The nightly run on the phone (#48) with made-up data: which nightly request the section shows
// while one regenerates, its words, the overview's quiet row, and the agent's starters, whose
// numbers are computed here from what they reference. 2026-11-06 is a Friday.

const TODAY = "2026-11-06";
const now = new Date(`${TODAY}T15:00:00`).getTime();

const totals = (energyKcal: number, protein = 0): NutrientTotals => ({
  grams: 0,
  items: 1,
  nutrients: { energyKcal, protein, fat: 0, saturatedFat: 0, carbohydrate: 0, sugars: 0, fiber: 0, salt: 0 },
});

const day: PlanDay = {
  date: TODAY,
  plannedMeals: [],
  meals: [],
  unanalysed: 0,
  eaten: null,
  projected: totals(1100, 78),
  goal: {
    id: "g",
    effectiveFrom: "2026-01-01",
    targets: { energyKcal: 2200, protein: 160, fat: null, carbohydrate: null, fiber: null },
    kind: "cut",
    label: "Cut",
    floorKcal: 1500,
  },
  openSlots: ["breakfast", "lunch", "dinner"],
  mostlyKnown: false,
  leftoverOffers: [],
};

const suggestion = (id: string, over: Partial<PlanningSuggestionView> = {}): PlanningSuggestionView => ({
  id,
  roundId: "r1",
  position: 0,
  status: "ready",
  title: `Gericht ${id}`,
  approach: "",
  sourceMode: "composed",
  sourceUrl: null,
  proposedDate: TODAY,
  proposedSlot: "dinner",
  recipeId: "rec",
  why: [],
  failure: null,
  verdict: null,
  plannedMealId: null,
  createdAt: 0,
  updatedAt: 0,
  recipe: null,
  perPortion: null,
  fit: null,
  ...over,
});

const detail = (
  id: string,
  status: PlanningRoundView["status"],
  suggestions: PlanningSuggestionView[],
  createdAt = now,
): PlanningRequestDetail => ({
  request: {
    id,
    title: "Breakfast, lunch and dinner Fri",
    origin: "nightly",
    filters: {
      days: [TODAY],
      slots: ["breakfast", "lunch", "dinner"],
      timeCapMin: null,
      constraints: [],
      useUp: [],
      sourceMode: "adapted",
      portionsCooked: 1,
      count: 3,
    },
    timeZone: "Europe/Berlin",
    archivedAt: null,
    createdAt,
    updatedAt: createdAt,
  },
  inputs: [],
  transcripts: [],
  rounds: [
    {
      id: "r1",
      requestId: id,
      number: 1,
      kind: "first",
      status,
      count: 3,
      runId: null,
      error: status === "failed" ? "the agent ended its turn without saving a suggestion" : null,
      createdAt,
      startedAt: null,
      endedAt: null,
      suggestions,
    },
  ],
  pendingInputs: 0,
});

describe("the Tonight section", () => {
  const made = new Date(`${TODAY}T03:00:00`).getTime();
  const last = detail("old", "done", [suggestion("a"), suggestion("b", { verdict: "rejected" })], made);

  test("ready: the newest with suggestions; a regenerated one only once one of its own is ready", () => {
    expect(nightlyState([])).toBeNull();
    expect(nightlyState([last])).toMatchObject({ mode: "ready", newer: null });
    const fresh = detail("new", "running", [suggestion("c", { status: "outlined" })]);
    const regen = nightlyState([fresh, last])!;
    expect(regen.mode).toBe("regenerating");
    expect(regen.shown.request.id).toBe("old");
    expect(regen.newer?.request.id).toBe("new");
    // its first suggestion is ready: it takes over, with the outlined rest as placeholders
    const halfway = detail("new", "running", [suggestion("c"), suggestion("d", { status: "outlined" })]);
    expect(nightlyState([halfway, last])).toMatchObject({ mode: "ready", newer: null });
    expect(nightlyRows(halfway).map((s) => [s.id, s.status])).toEqual([
      ["c", "ready"],
      ["d", "outlined"],
    ]);
    // the regenerated one failed: the earlier stay, the failure is told
    const failed = nightlyState([detail("new", "failed", []), last])!;
    expect(failed).toMatchObject({ mode: "ready" });
    expect(failed.newer?.rounds[0]?.status).toBe("failed");
    // alone: suggesting, then failed
    expect(nightlyState([fresh])?.mode).toBe("suggesting");
    expect(nightlyState([detail("new", "failed", [])])?.mode).toBe("failed");
  });

  test("Tonight for dinners only, else Today; Pick says tonight or the slot", () => {
    expect(nightlyTitle(last)).toBe("Tonight");
    expect(
      nightlyTitle(detail("x", "done", [suggestion("a"), suggestion("b", { proposedSlot: "lunch" })])),
    ).toBe("Today");
    expect(nightlyPickWords({ date: TODAY, slot: "dinner" }, TODAY)).toBe("tonight");
    expect(nightlyPickWords({ date: TODAY, slot: "lunch" }, TODAY)).toBe("lunch");
    expect(nightlyPickWords({ date: "2026-11-07", slot: "dinner" }, TODAY)).toBe("Tomorrow dinner");
  });

  test("the overview: a quiet row of its own while suggestions wait; never a waiting request", () => {
    expect(nightlyStripRow([last])).toEqual({
      requestId: "old",
      title: "Tonight",
      waiting: 1,
      titles: ["Gericht a"],
      madeAt: made,
    });
    expect(nightlyStripRow([detail("old", "done", [suggestion("a", { verdict: "picked" })])])).toBeNull();
    expect(nightlyStripRow([detail("new", "running", [])])).toBeNull();
    const summary = {
      request: last.request,
      latestRound: {
        id: "r1",
        number: 1,
        kind: "first" as const,
        status: "done" as const,
        count: 3,
        outlined: 0,
        ready: 2,
        failed: 0,
        picked: 0,
        rejected: 0,
      },
      inputs: 0,
      pendingInputs: 0,
    };
    expect(stripRows([summary], TODAY)).toEqual([]);
  });
});

describe("agent starters (#48)", () => {
  const repeatable: RepeatableMeal[] = [
    { mealId: "m1", title: "Linsen-Dal", eatenAt: now - 86_400_000, times: 4, totals: totals(760, 41) },
  ];
  const input: StarterInput = { today: TODAY, now, days: [day], repeatable, last: null };
  const starter = (over: Partial<PlanningStarterView>): PlanningStarterView => ({
    id: crypto.randomUUID(),
    roundId: "r1",
    position: 0,
    kind: "other",
    text: "Something new",
    detail: "",
    filters: {},
    ref: {},
    createdAt: now,
    meal: null,
    request: null,
    leftover: null,
    ...over,
  });

  test("each number is computed now from the kind and what the reference names", () => {
    expect(liveNumber(starter({ kind: "protein_gap" }), input)).toMatchObject({
      number: "82",
      unit: "g protein open tonight",
    });
    // eaten since: the number follows
    const later = { ...input, days: [{ ...day, projected: totals(1600, 130) }] };
    expect(liveNumber(starter({ kind: "protein_gap" }), later)).toMatchObject({ number: "30" });
    expect(
      liveNumber(
        starter({ kind: "like_meal", meal: { id: "m1", title: "Linsen-Dal", eatenAt: now - 86_400_000 } }),
        input,
      ),
    ).toMatchObject({ number: "4×", unit: "logged in 30 days" });
    const fish = {
      id: "m9",
      title: "Lachs mit Kartoffeln",
      eatenAt: new Date("2026-10-25T19:00:00").getTime(),
    };
    expect(liveNumber(starter({ kind: "variety", meal: fish }), input)).toMatchObject({
      number: "12",
      unit: "days since you had it",
    });
    expect(liveNumber(starter({ kind: "variety" }), input)).toMatchObject({ number: null });
    expect(liveNumber(starter({ kind: "season" }), input)).toMatchObject({ number: "Nov" });
    expect(
      liveNumber(
        starter({
          kind: "last_request",
          request: {
            id: "q",
            title: "Dinners Tue–Thu",
            createdAt: new Date("2026-11-03T12:00:00").getTime(),
          },
        }),
        input,
      ),
    ).toMatchObject({ number: "Tue", why: "Dinners Tue–Thu" });
    expect(liveNumber(starter({ kind: "use_up", filters: { useUp: ["½ Hokkaido"] } }), input)).toMatchObject({
      number: null,
      unit: "use up ½ Hokkaido",
    });
    expect(liveNumber(starter({ kind: "other" }), input).number).toBeNull();
  });

  test("the agent's first, in its order, then code's of other kinds; a tap applies its filters", () => {
    const agent = [
      starter({
        kind: "variety",
        text: "Fish again",
        detail: "Your last fish was Lachs",
        filters: { when: "week", slots: ["dinner"], count: 2 },
      }),
      starter({
        kind: "protein_gap",
        text: "Quark night",
        filters: { when: "today", constraints: ["high_protein"] },
      }),
    ];
    const s = computeStarters({ ...input, agent });
    expect(s.map((x) => [x.by, x.kind])).toEqual([
      ["agent", "variety"],
      ["agent", "protein_gap"],
      ["code", "like_meal"],
      ["code", "season"],
    ]);
    expect(s[0]).toMatchObject({
      text: "Fish again",
      why: "Your last fish was Lachs",
      composerText: "Fish again",
      draft: { when: "week", slots: ["dinner"], count: 2 },
    });
    // the protein one without a detail of its own takes the computed why
    expect(s[1]).toMatchObject({ number: "82", why: "1,100 kcal left of 2,200" });
    // never more than fit the screen
    const many = Array.from({ length: 6 }, (_, i) => starter({ text: `Idee ${i}` }));
    expect(computeStarters({ ...input, agent: many })).toHaveLength(MAX_SHOWN_STARTERS);
    // none: code's alone, as before
    expect(computeStarters(input).map((x) => x.id)).toEqual(["protein", "again", "season"]);
  });
});
