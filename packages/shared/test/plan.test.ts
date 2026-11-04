import { describe, expect, test } from "bun:test";
import {
  addMonths,
  classifyDay,
  classifyWeek,
  type DayInput,
  dailyWeights,
  dayInput,
  type Goal,
  type GoalDerivation,
  goalPlan,
  monthDays,
  planWords,
  rangeWords,
  weekdayIndex,
} from "../src/index.ts";

// The calendar's classifier (#33, lifted from spike #31 with its tests). Made-up numbers.

const cut = (kcal: number) => classifyDay({ kcal, target: 2000, goalKind: "cut", floor: 1500 });
const maintain = (kcal: number) => classifyDay({ kcal, target: 2000, goalKind: "maintain", floor: 1500 });
const bulk = (kcal: number) => classifyDay({ kcal, target: 2000, goalKind: "bulk", floor: null });

describe("classifyDay", () => {
  test("the on-plan range is asymmetric per goal kind, boundaries inside", () => {
    // cut: −15 % … +5 %
    expect(cut(1700).band).toBe("on");
    expect(cut(2100).band).toBe("on");
    expect(cut(2120).band).toBe("just");
    expect(cut(1680).band).toBe("just");
    // maintain: ±10 %
    expect(maintain(1800).band).toBe("on");
    expect(maintain(2200).band).toBe("on");
    expect(maintain(2220).band).toBe("just");
    expect(maintain(1780).band).toBe("just");
    // bulk: −5 % … +15 %
    expect(bulk(2300).band).toBe("on");
    expect(bulk(1900).band).toBe("on");
    expect(bulk(1880).band).toBe("just");
  });

  test("beyond 25 % either way is far off", () => {
    expect(cut(2500).band).toBe("just");
    expect(cut(2520).band).toBe("far");
    expect(bulk(1500).band).toBe("just");
    expect(bulk(1480).band).toBe("far");
  });

  test("direction is a fact outside the 5 % dead zone, whatever the band", () => {
    expect(cut(2000).direction).toBeNull();
    expect(cut(2100).direction).toBeNull();
    expect(cut(1900).direction).toBeNull();
    expect(cut(1880)).toEqual({ band: "on", direction: "under", tooLow: false });
    expect(cut(2120)).toEqual({ band: "just", direction: "over", tooLow: false });
    expect(bulk(2600)).toEqual({ band: "far", direction: "over", tooLow: false });
  });

  test("too low: under the floor, or more than 25 % under on a cut", () => {
    expect(cut(1400).tooLow).toBe(true); // under the 1,500 floor
    expect(cut(1480)).toEqual({ band: "far", direction: "under", tooLow: true }); // −26 %
    expect(classifyDay({ kcal: 1480, target: 2000, goalKind: "cut", floor: null }).tooLow).toBe(true);
    expect(classifyDay({ kcal: 1500, target: 2000, goalKind: "cut", floor: null }).tooLow).toBe(false);
    expect(maintain(1480)).toEqual({ band: "far", direction: "under", tooLow: true }); // the floor only
    expect(maintain(1520).tooLow).toBe(false); // −24 %, above the floor
    expect(bulk(1000).tooLow).toBe(false); // no floor, not a cut
  });

  test("without a goal or a kcal target there is nothing to classify", () => {
    const none = { band: "none", direction: null, tooLow: false } as const;
    expect(classifyDay({ kcal: 2400, target: null, goalKind: null, floor: null })).toEqual(none);
    expect(classifyDay({ kcal: 2400, target: null, goalKind: "cut", floor: 1500 })).toEqual(none);
    expect(classifyDay(null)).toEqual(none);
  });
});

describe("classifyWeek", () => {
  const day = (kcal: number, target = 2000, goalKind: "cut" | "maintain" = "cut"): DayInput => ({
    kcal,
    target,
    goalKind,
    floor: 1500,
  });

  test("the mean share over the counted days, with the count", () => {
    const w = classifyWeek([day(1800), null, day(2200), undefined, day(2000)]);
    expect(w).toEqual({ band: "on", direction: null, tooLow: false, days: 3 });
  });

  test("one far day does not dominate a week that is otherwise on plan", () => {
    const w = classifyWeek([day(1900), day(1850), day(1900), day(1950), day(2700)]);
    expect(w.band).toBe("on");
    expect(w.days).toBe(5);
  });

  test("a goal change mid-week: each day against its own target, the range from the last goal", () => {
    // maintain at 2,600 for two days, then a cut at 2,100: each at 95 %, on the cut's plan
    const w = classifyWeek([
      day(2470, 2600, "maintain"),
      day(2470, 2600, "maintain"),
      day(1995, 2100, "cut"),
    ]);
    expect(w).toEqual({ band: "on", direction: null, tooLow: false, days: 3 });
    // both days at 112 %, judged by the last day's goal (maintain, ±10 %): just off, over
    const over = classifyWeek([day(2912, 2600, "cut"), day(2352, 2100, "maintain")]);
    expect(over).toEqual({ band: "just", direction: "over", tooLow: false, days: 2 });
  });

  test("a week without counted days", () => {
    expect(classifyWeek([null, { kcal: 2000, target: null, goalKind: null, floor: null }])).toEqual({
      band: "none",
      direction: null,
      tooLow: false,
      days: 0,
    });
  });
});

test("planWords and rangeWords", () => {
  expect(planWords(cut(2000))).toBe("on plan");
  expect(planWords(cut(2120))).toBe("just off, over");
  expect(planWords(cut(1400))).toBe("far off, too low");
  expect(planWords(classifyDay(null))).toBe("");
  expect(rangeWords("cut")).toBe("on plan from 15 % under to 5 % over the kcal target");
  expect(rangeWords("maintain")).toBe("on plan within 10 % of the kcal target");
  expect(rangeWords("bulk")).toBe("on plan from 5 % under to 15 % over the kcal target");
});

describe("goalPlan and dayInput", () => {
  const targets = { energyKcal: 2100, protein: 160, fat: 70, carbohydrate: 210, fiber: 30 };
  const guided = {
    note: "",
    derivation: {
      choices: { goal: "cut", pace: "standard", protein: "high", fatPercent: 30 },
      result: { kcal: { value: 2100, floor: 1790, floorApplied: false } },
    } as unknown as GoalDerivation,
  } satisfies Pick<Goal, "note" | "derivation">;

  test("a guided goal: its kind, its summary and the floor its calculation used", () => {
    expect(goalPlan(guided, "female")).toEqual({ kind: "cut", label: "Cut, standard pace", floorKcal: 1790 });
    expect(goalPlan({ ...guided, note: "Spring cut" }, null).label).toBe("Spring cut");
  });

  test("targets set by hand: no kind, 'Manual targets', the floor for the profile's sex if there is one", () => {
    const manual = { note: "", derivation: null };
    expect(goalPlan(manual, "male")).toEqual({ kind: null, label: "Manual targets", floorKcal: 1500 });
    expect(goalPlan(manual, "female").floorKcal).toBe(1200);
    expect(goalPlan(manual, null).floorKcal).toBeNull();
    expect(goalPlan({ note: "Holiday", derivation: null }, null).label).toBe("Holiday");
  });

  test("dayInput: manual goals read with the maintain range; nothing counted is no input", () => {
    expect(dayInput(1900, { targets, kind: null, label: "Manual targets", floorKcal: 1500 })).toEqual({
      kcal: 1900,
      target: 2100,
      goalKind: "maintain",
      floor: 1500,
    });
    expect(dayInput(1900, { targets, ...goalPlan(guided, null) })?.goalKind).toBe("cut");
    expect(dayInput(1900, null)).toEqual({ kcal: 1900, target: null, goalKind: null, floor: null });
    expect(dayInput(null, null)).toBeNull();
  });
});

test("dailyWeights: a day counts once, the average over the last 7 calendar days", () => {
  const byDay = new Map([
    ["2026-10-10", [82]],
    ["2026-10-01", [84]],
    ["2026-10-03", [83]],
    ["2026-10-07", [82, 83]],
  ]);
  expect(dailyWeights(byDay)).toEqual([
    { date: "2026-10-01", kg: 84, avg: 84 },
    { date: "2026-10-03", kg: 83, avg: 83.5 },
    { date: "2026-10-07", kg: 82.5, avg: 83.17 },
    { date: "2026-10-10", kg: 82, avg: 82.25 },
  ]);
});

test("month arithmetic", () => {
  expect(monthDays("2026-02")).toBe(28);
  expect(monthDays("2028-02")).toBe(29);
  expect(monthDays("2026-10")).toBe(31);
  expect(addMonths("2026-11", 2)).toBe("2027-01");
  expect(addMonths("2026-01", -1)).toBe("2025-12");
  expect(weekdayIndex("2026-10-14")).toBe(2); // a Wednesday
  expect(weekdayIndex("2026-11-01")).toBe(6); // a Sunday
});
