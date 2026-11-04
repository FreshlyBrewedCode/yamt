import { describe, expect, test } from "bun:test";
import { dateStart } from "../src/lib/format";
import { kgTicks, weightTrend } from "../src/lib/weight";

const at = (date: string, hour = 7) => dateStart(date) + hour * 3_600_000;

describe("weightTrend", () => {
  test("raw points oldest first; the average is over the last 7 calendar days, a day counting once", () => {
    const { raw, avg } = weightTrend([
      { at: at("2026-10-10"), kg: 82 },
      { at: at("2026-10-01"), kg: 84 },
      { at: at("2026-10-03"), kg: 83 },
      // two weighings on one day: their mean is that day's value
      { at: at("2026-10-07"), kg: 82 },
      { at: at("2026-10-07", 21), kg: 83 },
    ]);
    expect(raw.map((p) => p.kg)).toEqual([84, 83, 82, 83, 82]);
    expect(avg.map((p) => [p.date, p.kg])).toEqual([
      ["2026-10-01", 84],
      ["2026-10-03", 83.5],
      // 1, 3 and 7 Oct are within 7 days of the 7th
      ["2026-10-07", 83.17],
      // the 4th to the 10th: 7 Oct (82.5) and 10 Oct (82)
      ["2026-10-10", 82.25],
    ]);
    expect(avg[0]!.at).toBe(dateStart("2026-10-01") + 12 * 3_600_000);
  });

  test("nothing in, nothing out", () => {
    expect(weightTrend([])).toEqual({ raw: [], avg: [] });
  });
});

test("kgTicks: clean steps, three or four lines", () => {
  expect(kgTicks(80.6, 83.4)).toEqual([81, 82, 83]);
  expect(kgTicks(80, 82)).toEqual([80, 81, 82]);
  expect(kgTicks(79.2, 80.8)).toEqual([79.5, 80, 80.5]);
  expect(kgTicks(70, 82)).toEqual([70, 75, 80]);
});
