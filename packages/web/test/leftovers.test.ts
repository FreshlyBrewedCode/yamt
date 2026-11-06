import { describe, expect, test } from "bun:test";
import type { LeftoverView, NutrientTotals, PlanDay, PlanningStarterView, ShoppingLine } from "@yamt/shared";
import { keptWords, leftoverLine, leftoverNumber, offersOf } from "../src/lib/leftovers";
import { filterDefaults, resolveDraft, summaryWords } from "../src/lib/plan-request";
import { dayMeta } from "../src/lib/planning";
import { atHomeWords, byAisle, rangeDays } from "../src/lib/shopping";
import { computeStarters, liveNumber, type StarterInput } from "../src/lib/starters";

// Leftovers and the shopping list on the phone (#49) with made-up data. 2026-11-06 is a Friday.

const TODAY = "2026-11-06";
const now = new Date(`${TODAY}T15:00:00`).getTime();

const totals = (energyKcal: number): NutrientTotals => ({
  grams: 0,
  items: 1,
  nutrients: {
    energyKcal,
    protein: 0,
    fat: 0,
    saturatedFat: 0,
    carbohydrate: 0,
    sugars: 0,
    fiber: 0,
    salt: 0,
  },
});

const leftover = (over: Partial<LeftoverView> = {}): LeftoverView => ({
  id: crypto.randomUUID(),
  description: "Hokkaido",
  foodId: null,
  quantity: null,
  grams: null,
  portions: null,
  source: "user",
  plannedMealId: null,
  recipeId: null,
  cookedOn: null,
  roundId: null,
  suggestionId: null,
  note: null,
  status: "open",
  createdAt: 0,
  updatedAt: 0,
  closedAt: null,
  food: null,
  available: null,
  plannedFor: [],
  perPortion: null,
  ...over,
});

const cooked = (over: Partial<LeftoverView> = {}) =>
  leftover({
    description: "Kürbis-Curry",
    source: "cooked",
    portions: 1,
    available: 1,
    cookedOn: "2026-11-05",
    perPortion: totals(871),
    ...over,
  });

const day = (date: string, over: Partial<PlanDay> = {}): PlanDay => ({
  date,
  plannedMeals: [],
  meals: [],
  unanalysed: 0,
  eaten: null,
  projected: null,
  goal: null,
  openSlots: ["breakfast", "lunch", "dinner"],
  mostlyKnown: false,
  leftoverOffers: [],
  ...over,
});

describe("leftovers on the plan view", () => {
  test("where a leftover comes from, and where it is offered or planned", () => {
    const l = cooked();
    expect(leftoverLine(l, undefined, TODAY)).toBe("After Thu");
    expect(leftoverLine(l, { date: "2026-11-07", slot: "lunch" }, TODAY)).toBe(
      "After Thu · offered for lunch tomorrow",
    );
    expect(
      leftoverLine(
        cooked({ plannedFor: [{ plannedMealId: "p", date: "2026-11-09", slot: "dinner", portionEaten: 1 }] }),
        undefined,
        TODAY,
      ),
    ).toBe("After Thu · planned for dinner Mon");
    expect(leftoverLine(leftover({ note: "Bought Saturday" }), undefined, TODAY)).toBe("Bought Saturday");
    expect(leftoverLine(leftover(), undefined, TODAY)).toBe("Added by you");
    expect(leftoverLine(leftover({ source: "pack" }), undefined, TODAY)).toBe("Noted with a suggestion");
  });

  test("the offers by leftover, and a day's strip counts them", () => {
    const d = day("2026-11-07", { leftoverOffers: [{ leftoverId: "a", slot: "lunch" }] });
    expect(offersOf([day(TODAY), d]).get("a")).toEqual({
      leftoverId: "a",
      slot: "lunch",
      date: "2026-11-07",
    });
    expect(dayMeta(d)).toBe("1 leftover");
  });

  test("Ate it's sentence: the plan offers it from the day after, today at the earliest", () => {
    expect(keptWords(1, 871, TODAY, TODAY)).toBe(
      "1 portion (871 kcal) kept as a leftover: the plan offers it from tomorrow.",
    );
    expect(keptWords(1.5, 400, "2026-11-01", TODAY)).toBe(
      "1.5 portions (600 kcal) kept as a leftover: the plan offers it from today.",
    );
    expect(keptWords(1, 500, "2026-11-08", TODAY)).toContain("from Mon");
  });
});

describe("leftover starters", () => {
  const input = (over: Partial<StarterInput> = {}): StarterInput => ({
    today: TODAY,
    now,
    days: [],
    repeatable: [],
    last: null,
    ...over,
  });

  test("a leftover's number: portions, grams, the quantity as said", () => {
    expect(leftoverNumber(cooked())).toEqual({ number: "1", unit: "portion of Kürbis-Curry left" });
    expect(leftoverNumber(leftover({ grams: 500, quantity: "½" }))).toEqual({
      number: "500",
      unit: "g Hokkaido at home",
    });
    expect(leftoverNumber(leftover({ quantity: "1 Bund", description: "Koriander" }))).toEqual({
      number: "1 Bund",
      unit: "Koriander at home",
    });
    expect(leftoverNumber(leftover())).toEqual({ number: null, unit: "use up Hokkaido" });
  });

  test("code offers the oldest ingredient leftover (not a cooked dish) to use up, with its id in the filters", () => {
    const hokkaido = leftover({ grams: 500, note: "Bought Saturday" });
    const starters = computeStarters(input({ leftovers: [cooked(), hokkaido] }));
    const s = starters.find((x) => x.kind === "use_up")!;
    expect(s).toMatchObject({
      id: "leftover",
      by: "code",
      number: "500",
      unit: "g Hokkaido at home",
      text: "Use up the Hokkaido",
      why: "Bought Saturday",
      draft: { leftovers: [hokkaido.id] },
    });
    expect(computeStarters(input({ leftovers: [cooked()] })).some((x) => x.kind === "use_up")).toBe(false);
  });

  test("an agent's use_up starter reads its leftover now and fills it into the filters", () => {
    const l = leftover({ grams: 200, description: "Feta" });
    const starter: PlanningStarterView = {
      id: "s1",
      roundId: "r1",
      position: 0,
      kind: "use_up",
      text: "Feta aufbrauchen",
      detail: "",
      filters: {},
      ref: { leftoverId: l.id },
      createdAt: now,
      meal: null,
      request: null,
      leftover: l,
    };
    expect(liveNumber(starter, input())).toMatchObject({ number: "200", unit: "g Feta at home" });
    const [first] = computeStarters(input({ agent: [starter], leftovers: [leftover()] }));
    expect(first).toMatchObject({ by: "agent", draft: { leftovers: [l.id] } });
    // the agent wrote a use_up starter: code doesn't add its own
    expect(
      computeStarters(input({ agent: [starter], leftovers: [leftover()] })).filter(
        (x) => x.kind === "use_up",
      ),
    ).toHaveLength(1);
    // used up since: no number, the filters keep only what the agent wrote
    expect(liveNumber({ ...starter, leftover: null, filters: { useUp: ["Feta"] } }, input())).toMatchObject({
      number: null,
      unit: "use up Feta",
    });
  });

  test("a draft's leftovers go into the request by id; the summary names them", () => {
    const l = leftover({ description: "Hokkaido" });
    const f = resolveDraft({ leftovers: [l.id], useUp: ["Spinat"] }, filterDefaults(undefined), TODAY);
    expect(f.useUp).toEqual([{ leftoverId: l.id }, { text: "Spinat" }]);
    const words = summaryWords(f, f, TODAY, new Map([[l.id, "Hokkaido"]]));
    expect(words).toContain("use Hokkaido, Spinat");
    expect(summaryWords(f, f, TODAY)).toContain("use a leftover, Spinat");
  });
});

describe("the shopping list on the phone", () => {
  const line = (over: Partial<ShoppingLine>): ShoppingLine => ({
    key: crypto.randomUUID(),
    name: "x",
    aisle: "other",
    needed: 100,
    grams: 100,
    atHome: [],
    covered: false,
    checked: false,
    own: false,
    needs: [],
    ...over,
  });

  test("by aisle in the aisles' order, counting only the lines to buy", () => {
    const groups = byAisle([
      line({ aisle: "pantry", checked: true }),
      line({ aisle: "produce" }),
      line({ aisle: "produce", checked: true }),
      line({ aisle: "dairy_eggs", covered: true }),
      line({ aisle: "dairy_eggs" }),
    ]);
    expect(groups.map((g) => [g.aisle, g.checked, g.toBuy])).toEqual([
      ["produce", 1, 2],
      ["dairy_eggs", 0, 1],
      ["pantry", 1, 1],
    ]);
  });

  test("what is at home in words", () => {
    expect(
      atHomeWords(
        line({ atHome: [{ leftoverId: "a", description: "Hokkaido", quantity: "½", grams: 500 }] }),
      ),
    ).toBe("½ Hokkaido at home");
    expect(
      atHomeWords(line({ atHome: [{ leftoverId: "a", description: "Feta", quantity: null, grams: 200 }] })),
    ).toBe("200 g Feta at home");
    expect(atHomeWords(line({}))).toBe("");
  });

  test("the range sheet's days: today to the last planned day, a week at least", () => {
    expect(rangeDays(TODAY, null, TODAY, TODAY)).toHaveLength(7);
    const days = rangeDays(TODAY, "2026-11-16", TODAY, "2026-11-08");
    expect([days[0], days.at(-1), days.length]).toEqual([TODAY, "2026-11-16", 11]);
  });
});
