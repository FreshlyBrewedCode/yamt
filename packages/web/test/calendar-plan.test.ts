import { describe, expect, test } from "bun:test";
import { classifyDay, classifyWeek, rangeWords } from "../src/design/calendar/plan";

const cut = (kcal: number) => classifyDay({ kcal, target: 2000, goalKind: "cut", floor: 1500 });
const maintain = (kcal: number) => classifyDay({ kcal, target: 2000, goalKind: "maintain", floor: 1500 });
const bulk = (kcal: number) => classifyDay({ kcal, target: 2000, goalKind: "bulk", floor: null });

describe("classifyDay", () => {
  test("the on-plan range is asymmetric per goal kind", () => {
    // cut: −15 % … +5 %
    expect(cut(1700).band).toBe("on");
    expect(cut(2100).band).toBe("on");
    expect(cut(2120).band).toBe("just");
    expect(cut(1680).band).toBe("just");
    // maintain: ±10 %
    expect(maintain(1800).band).toBe("on");
    expect(maintain(2200).band).toBe("on");
    expect(maintain(2220).band).toBe("just");
    // bulk: −5 % … +15 %
    expect(bulk(2300).band).toBe("on");
    expect(bulk(1880).band).toBe("just");
  });

  test("beyond 25 % either way is far off", () => {
    expect(cut(2500).band).toBe("just");
    expect(cut(2520).band).toBe("far");
    expect(bulk(1480).band).toBe("far");
  });

  test("direction is a fact outside the 5 % dead zone, whatever the band", () => {
    expect(cut(2000).direction).toBeNull();
    expect(cut(2080).direction).toBeNull();
    expect(cut(1920).direction).toBeNull();
    expect(cut(1880)).toEqual({ band: "on", direction: "under", tooLow: false });
    expect(cut(2120)).toEqual({ band: "just", direction: "over", tooLow: false });
    expect(bulk(2600)).toEqual({ band: "far", direction: "over", tooLow: false });
  });

  test("too low: under the floor, or more than 25 % under on a cut", () => {
    expect(cut(1400).tooLow).toBe(true); // under the 1,500 floor
    expect(cut(1480)).toEqual({ band: "far", direction: "under", tooLow: true }); // −26 %
    expect(maintain(1480)).toEqual({ band: "far", direction: "under", tooLow: true }); // floor only
    expect(maintain(1520).tooLow).toBe(false); // −24 %, above the floor: just far under
    expect(bulk(1000).tooLow).toBe(false); // no floor, not a cut
  });

  test("without a goal there is nothing to classify", () => {
    expect(classifyDay({ kcal: 2400, target: null, goalKind: null, floor: null })).toEqual({
      band: "none",
      direction: null,
      tooLow: false,
    });
  });
});

describe("classifyWeek", () => {
  const day = (kcal: number, target = 2000, goalKind: "cut" | "maintain" = "cut") => ({
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
    // maintain at 2,600 for two days, then a cut at 2,100: each at 95 %, the week is on the cut's plan
    const w = classifyWeek([
      day(2470, 2600, "maintain"),
      day(2470, 2600, "maintain"),
      day(1995, 2100, "cut"),
    ]);
    expect(w).toEqual({ band: "on", direction: null, tooLow: false, days: 3 });
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

test("rangeWords", () => {
  expect(rangeWords("cut")).toBe("on plan from 15 % under to 5 % over the kcal target");
  expect(rangeWords("maintain")).toBe("on plan within 10 % of the kcal target");
  expect(rangeWords("bulk")).toBe("on plan from 5 % under to 15 % over the kcal target");
});
